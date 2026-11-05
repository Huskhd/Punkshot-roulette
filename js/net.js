// Muckshot — online rooms with a 4-letter code. No server of our own.
//
// Every connection is tried two ways at once, and whichever works first wins:
//  1. direct  — WebRTC peer-to-peer via PeerJS (its free public broker only
//               introduces the players). Fast, but some networks (mobile data,
//               strict routers) can't connect two devices directly.
//  2. relay   — messages pass through free public MQTT brokers over secure
//               WebSockets. Works from almost any network, since each device
//               only connects *out* to the broker.
// The host's browser runs the real game either way.
//
// URL options (mostly for testing or self-hosting):
//   ?p2p=0                   relay only        ?relay=0   direct only
//   ?relay=wss://host:port/path[,wss://...]   use your own MQTT broker(s)
//   ?peer=host:port                            use your own PeerJS broker

const PREFIX = 'muckshot-v1-';
const TOPIC = 'muckshot-7f3a/v1';
const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HEARTBEAT_MS = 4000;
const SILENCE_MS = 16000;

const params = new URLSearchParams(location.search);

export function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  return s;
}
export function cleanCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}
function randomId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

function p2pEnabled() { return params.get('p2p') !== '0' && typeof window.Peer === 'function'; }
function relayEnabled() { return params.get('relay') !== '0' && window.mqtt && typeof window.mqtt.connect === 'function'; }
function relayUrls() {
  const r = params.get('relay');
  if (r && r !== '1' && r !== '0') return r.split(',').map((s) => s.trim()).filter(Boolean);
  return BROKERS;
}
function peerOpts() {
  const o = { debug: 0 };
  const custom = params.get('peer');
  if (custom) {
    const [host, port] = custom.split(':');
    o.host = host;
    o.port = +(port || 443);
    o.path = '/';
    o.secure = location.protocol === 'https:';
  }
  return o;
}
function mqttConnect(url, will) {
  return window.mqtt.connect(url, {
    clientId: 'ms_' + randomId(),
    clean: true,
    keepalive: 20,
    connectTimeout: 9000,
    reconnectPeriod: 2500,
    protocolVersion: 4,
    will: will ? { topic: will.topic, payload: JSON.stringify(will.msg), qos: 0, retain: false } : undefined,
  });
}
function parse(buf) {
  try { return JSON.parse(typeof buf === 'string' ? buf : new TextDecoder().decode(buf)); } catch (e) { return null; }
}

// One host <-> client connection, whichever transport it runs over.
class Link {
  constructor(via, send, close) {
    this.via = via; // 'direct' | 'relay'
    this._send = send;
    this._close = close;
    this.open = true;
    this.onMsg = () => {};
    this.onClose = () => {};
  }
  send(msg) { if (this.open) { try { this._send(msg); } catch (e) { /* ignore */ } } }
  close() { if (!this.open) return; this.open = false; try { this._close && this._close(); } catch (e) { /* ignore */ } }
  ended() { if (!this.open) return; this.open = false; this.onClose(); } // the other side went away
}

// ======================= host =======================
export class HostNet {
  constructor() {
    this.code = '';
    this.peer = null;
    this.brokers = [];
    this.links = new Set();
    this.byCid = new Map();
    this.relayLinks = new Map(); // cid -> link
    this.timers = [];
    this.onJoin = () => {};
    this.onLeave = () => {};
    this.onMsg = () => {};
    this.onError = () => {};
  }

  open() {
    if (!p2pEnabled() && !relayEnabled()) return Promise.reject(new Error('Online play could not load.'));
    return new Promise((resolve, reject) => {
      let tries = 0;
      const attempt = () => {
        tries++;
        const code = makeCode();
        let settled = false;
        const state = { p2pOpen: false, p2pFailed: !p2pEnabled(), relayUp: false, relayFailed: !relayEnabled() };
        const finish = () => {
          if (settled) return;
          if (state.p2pOpen || (state.relayUp && (state.p2pFailed || waited))) { settled = true; this.code = code; this.startHeartbeat(); resolve(code); return; }
          if (state.p2pFailed && state.relayFailed) { settled = true; this.shutdown(); reject(new Error('Can\'t reach the online servers. Check your connection.')); }
        };
        let waited = false;
        // Give the direct broker a moment to confirm the code is unique.
        this.timers.push(setTimeout(() => { waited = true; finish(); }, 5000));
        if (p2pEnabled()) {
          const peer = new window.Peer(PREFIX + code, peerOpts());
          this.peer = peer;
          peer.on('open', () => { state.p2pOpen = true; finish(); });
          peer.on('connection', (conn) => this.acceptDirect(conn));
          peer.on('error', (err) => {
            if (err.type === 'unavailable-id') {
              if (!settled && tries < 6) { this.shutdown(); attempt(); return; }
              try { peer.destroy(); } catch (e) { /* ignore */ }
              this.peer = null;
            }
            if (err.type === 'peer-unavailable') return;
            if (!state.p2pOpen) { state.p2pFailed = true; finish(); }
          });
          peer.on('disconnected', () => { if (state.p2pOpen && !peer.destroyed) { try { peer.reconnect(); } catch (e) { /* ignore */ } } });
        }
        if (relayEnabled()) {
          this.startRelay(code, () => { state.relayUp = true; finish(); });
          this.timers.push(setTimeout(() => { if (!state.relayUp) { state.relayFailed = true; finish(); } }, 11000));
        }
      };
      attempt();
    });
  }

  startRelay(code, onUp) {
    const base = `${TOPIC}/${code}`;
    this.base = base;
    for (const url of relayUrls()) {
      let c;
      try { c = mqttConnect(url, { topic: `${base}/all`, msg: { t: 'closed' } }); } catch (e) { continue; }
      c.on('connect', () => { c.subscribe(`${base}/h`, { qos: 0 }); onUp(); });
      c.on('message', (topic, buf) => this.fromRelay(c, buf));
      c.on('error', () => {});
      this.brokers.push(c);
    }
  }

  fromRelay(broker, buf) {
    const env = parse(buf);
    if (!env || typeof env.cid !== 'string' || !env.m || typeof env.m !== 'object') return;
    let link = this.relayLinks.get(env.cid);
    if (!link) {
      if (env.m.t !== 'hello') return;
      const topic = `${this.base}/c/${env.cid}`;
      link = new Link('relay', (msg) => broker.publish(topic, JSON.stringify(msg)), () => { this.relayLinks.delete(env.cid); });
      link.broker = broker;
      link.onClose = () => this.linkGone(link);
      this.relayLinks.set(env.cid, link);
      this.links.add(link);
    }
    if (link.broker !== broker || !link.open) return; // same hello arriving via a second broker
    link.lastSeen = Date.now();
    if (env.m.t === 'ping') return;
    if (env.m.t === 'bye') { link.ended(); this.relayLinks.delete(env.cid); return; }
    this.incoming(link, env.m);
  }

  acceptDirect(conn) {
    const link = new Link('direct', (msg) => conn.send(msg), () => conn.close());
    link.onClose = () => this.linkGone(link);
    this.links.add(link);
    conn.on('data', (msg) => { if (msg && typeof msg === 'object') this.incoming(link, msg); });
    conn.on('close', () => link.ended());
    conn.on('error', () => link.ended());
  }

  incoming(link, msg) {
    if (!link.joined) {
      if (msg.t !== 'hello') return;
      const cid = String(msg.cid || randomId());
      if (this.byCid.has(cid)) { // the same friend got through on the other transport first
        if (link.via === 'direct') link.close();
        this.links.delete(link);
        return;
      }
      link.joined = true;
      link.cid = cid;
      this.byCid.set(cid, link);
      this.onJoin(link, String(msg.name || 'Stranger').slice(0, 14));
      return;
    }
    this.onMsg(link, msg);
  }

  linkGone(link) {
    this.links.delete(link);
    if (link.via === 'relay') this.relayLinks.delete(link.cid);
    if (!link.joined) return;
    if (this.byCid.get(link.cid) === link) this.byCid.delete(link.cid);
    this.onLeave(link);
  }

  startHeartbeat() {
    this.timers.push(setInterval(() => {
      const hb = JSON.stringify({ t: 'hb' });
      for (const b of this.brokers) if (b.connected) b.publish(`${this.base}/all`, hb);
      const now = Date.now();
      for (const link of [...this.relayLinks.values()]) if (now - (link.lastSeen || now) > SILENCE_MS) link.ended();
    }, HEARTBEAT_MS));
  }

  send(link, msg) { if (link) link.send(msg); }
  kick(link, reason) {
    this.send(link, { t: 'reject', reason });
    setTimeout(() => {
      if (link.joined && this.byCid.get(link.cid) === link) this.byCid.delete(link.cid);
      this.links.delete(link);
      link.close();
    }, 300);
  }
  shutdown() {
    this.timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
    this.timers = [];
    try { this.peer && this.peer.destroy(); } catch (e) { /* ignore */ }
    this.peer = null;
    for (const b of this.brokers) { try { b.end(true); } catch (e) { /* ignore */ } }
    this.brokers = [];
  }
  close() {
    for (const l of this.links) l.send({ t: 'closed' });
    const bye = JSON.stringify({ t: 'closed' });
    for (const b of this.brokers) { try { if (b.connected) b.publish(`${this.base}/all`, bye); } catch (e) { /* ignore */ } }
    this.links.clear();
    this.byCid.clear();
    setTimeout(() => this.shutdown(), 400);
  }
}

// ======================= client =======================
export class ClientNet {
  constructor() {
    this.link = null;
    this.peer = null;
    this.brokers = [];
    this.timers = [];
    this.queue = [];
    this._onMsg = null;
    this.onClose = () => {};
    this.closedByUs = false;
    this.via = '';
  }
  // Messages that arrive before the app attaches its handler are held, not lost.
  set onMsg(fn) { this._onMsg = fn; const q = this.queue; this.queue = []; q.forEach((m) => fn(m)); }
  get onMsg() { return this._onMsg; }
  deliver(m) { if (this._onMsg) this._onMsg(m); else this.queue.push(m); }

  join(code, name) {
    if (!p2pEnabled() && !relayEnabled()) return Promise.reject(new Error('Online play could not load.'));
    const cid = randomId();
    return new Promise((resolve, reject) => {
      let done = false;
      let reached = false; // got through to at least one server
      let missing = false; // the direct broker says no such room
      const win = (link, msg) => {
        if (done) { if (link !== this.link) link.close(); return; }
        done = true;
        this.timers.forEach((t) => clearTimeout(t));
        this.timers = [];
        this.link = link;
        this.via = link.via;
        // drop the transport that lost the race
        if (link.via === 'relay') {
          try { this.peer && this.peer.destroy(); } catch (e) { /* ignore */ }
          this.peer = null;
          for (const b of this.brokers) if (b !== link.broker) { try { b.end(true); } catch (e) { /* ignore */ } }
          this.brokers = [link.broker];
        } else {
          for (const b of this.brokers) { try { b.end(true); } catch (e) { /* ignore */ } }
          this.brokers = [];
        }
        link.onMsg = (m) => this.deliver(m);
        link.onClose = () => { if (!this.closedByUs) this.onClose(); };
        if (link.via === 'relay') this.startHeartbeat(link);
        resolve(msg);
      };
      const lose = (text) => {
        if (done) return;
        done = true;
        this.close();
        reject(new Error(text));
      };
      const handshake = (link) => (m) => {
        if (m.t === 'welcome') win(link, m);
        else if (m.t === 'reject' && !done) lose(m.reason || 'The room said no.');
      };
      this.timers.push(setTimeout(() => lose(missing || reached ? 'Room not found. Check the code — and that the host is still on the lobby screen.' : 'Can\'t reach the online servers. Check your connection.'), 15000));
      this.timers.push(setTimeout(() => { if (missing && this.brokers.some((b) => b.connected)) lose('Room not found. Check the code.'); }, 8000));

      if (p2pEnabled()) {
        const peer = new window.Peer(peerOpts());
        this.peer = peer;
        peer.on('error', (err) => { if (err.type === 'peer-unavailable') { missing = true; reached = true; } });
        peer.on('open', () => {
          reached = true;
          const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
          const link = new Link('direct', (m) => conn.send(m), () => conn.close());
          link.onMsg = handshake(link);
          conn.on('open', () => link.send({ t: 'hello', name, cid }));
          conn.on('data', (m) => { if (m && typeof m === 'object') link.onMsg(m); });
          conn.on('close', () => link.ended());
          conn.on('error', () => link.ended());
        });
      }
      if (relayEnabled()) {
        const base = `${TOPIC}/${code}`;
        for (const url of relayUrls()) {
          let b;
          try { b = mqttConnect(url, { topic: `${base}/h`, msg: { cid, m: { t: 'bye' } } }); } catch (e) { continue; }
          const link = new Link('relay', (m) => b.publish(`${base}/h`, JSON.stringify({ cid, m })), () => { try { b.end(true); } catch (e) { /* ignore */ } });
          link.broker = b;
          link.onMsg = handshake(link);
          b.on('connect', () => {
            reached = true;
            b.subscribe([`${base}/c/${cid}`, `${base}/all`], { qos: 0 }, () => {
              if (done) return;
              link.send({ t: 'hello', name, cid });
              // the host may not be listening on this broker yet: knock again until answered
              const knock = setInterval(() => { if (done || !b.connected) clearInterval(knock); else link.send({ t: 'hello', name, cid }); }, 2500);
              this.timers.push(knock);
            });
          });
          b.on('message', (topic, buf) => {
            const m = parse(buf);
            if (!m || typeof m !== 'object') return;
            link.lastHost = Date.now();
            if (m.t === 'hb') return;
            if (topic.endsWith('/all') && m.t !== 'closed') return;
            link.onMsg(m);
          });
          b.on('error', () => {});
          this.brokers.push(b);
        }
      }
    });
  }

  startHeartbeat(link) {
    link.lastHost = Date.now();
    this.timers.push(setInterval(() => {
      link.send({ t: 'ping' });
      if (Date.now() - link.lastHost > SILENCE_MS) link.ended();
    }, HEARTBEAT_MS));
  }

  send(msg) { if (this.link) this.link.send(msg); }
  close() {
    this.closedByUs = true;
    this.timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
    this.timers = [];
    if (this.link && this.link.via === 'relay') this.link.send({ t: 'bye' });
    const brokers = this.brokers;
    setTimeout(() => brokers.forEach((b) => { try { b.end(true); } catch (e) { /* ignore */ } }), 150);
    this.brokers = [];
    try { this.peer && this.peer.destroy(); } catch (e) { /* ignore */ }
    this.peer = null;
  }
}
