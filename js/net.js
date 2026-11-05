// Muckshot — online rooms over WebRTC using PeerJS (loaded globally from lib/).
// The host's browser runs the real game; friends connect peer-to-peer using a
// 4-letter room code. PeerJS's free public broker only introduces the peers, so
// no server of our own is needed — the game can be hosted as static files.

const PREFIX = 'muckshot-v1-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  return s;
}
export function cleanCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

function peerAvailable() { return typeof window.Peer === 'function'; }

// Uses PeerJS's free public broker by default. To use your own broker
// (npx peer --port 9000), open the game with ?peer=yourhost:9000
function peerOpts() {
  const o = { debug: 0 };
  const custom = new URLSearchParams(location.search).get('peer');
  if (custom) {
    const [host, port] = custom.split(':');
    o.host = host;
    o.port = +(port || 443);
    o.path = '/';
    o.secure = location.protocol === 'https:';
  }
  return o;
}

function errText(err) {
  const t = err && err.type;
  if (t === 'peer-unavailable') return 'Room not found. Check the code.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Can\'t reach the matchmaking server. Check your connection.';
  if (t === 'browser-incompatible') return 'This browser doesn\'t support online play.';
  return (err && err.message) || 'Connection problem.';
}

export class HostNet {
  constructor() {
    this.peer = null;
    this.code = '';
    this.conns = new Set();
    this.onJoin = () => {};
    this.onLeave = () => {};
    this.onMsg = () => {};
    this.onError = () => {};
  }
  open() {
    if (!peerAvailable()) return Promise.reject(new Error('Online play could not load.'));
    return new Promise((resolve, reject) => {
      let tries = 0;
      const attempt = () => {
        tries++;
        const code = makeCode();
        const peer = new window.Peer(PREFIX + code, peerOpts());
        let opened = false;
        peer.on('open', () => {
          opened = true;
          this.peer = peer;
          this.code = code;
          peer.on('connection', (conn) => this.accept(conn));
          resolve(code);
        });
        peer.on('error', (err) => {
          if (!opened && err.type === 'unavailable-id' && tries < 6) { peer.destroy(); attempt(); return; }
          if (!opened) { peer.destroy(); reject(new Error(errText(err))); return; }
          if (err.type !== 'peer-unavailable') this.onError(errText(err));
        });
        peer.on('disconnected', () => { if (opened && !peer.destroyed) { try { peer.reconnect(); } catch (e) { /* ignore */ } } });
      };
      attempt();
    });
  }
  accept(conn) {
    conn.on('open', () => {
      this.conns.add(conn);
      conn._hello = false;
    });
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello' && !conn._hello) { conn._hello = true; this.onJoin(conn, String(msg.name || 'Stranger').slice(0, 14)); return; }
      if (conn._hello) this.onMsg(conn, msg);
    });
    const gone = () => {
      if (!this.conns.has(conn)) return;
      this.conns.delete(conn);
      if (conn._hello) this.onLeave(conn);
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }
  send(conn, msg) { try { if (conn && conn.open) conn.send(msg); } catch (e) { /* ignore */ } }
  kick(conn, reason) {
    this.send(conn, { t: 'reject', reason });
    setTimeout(() => { try { conn.close(); } catch (e) { /* ignore */ } }, 300);
  }
  close() {
    for (const c of this.conns) this.send(c, { t: 'closed' });
    const p = this.peer;
    this.peer = null;
    this.conns.clear();
    setTimeout(() => { try { p && p.destroy(); } catch (e) { /* ignore */ } }, 300);
  }
}

export class ClientNet {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.onMsg = () => {};
    this.onClose = () => {};
    this.closedByUs = false;
  }
  join(code, name) {
    if (!peerAvailable()) return Promise.reject(new Error('Online play could not load.'));
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(peerOpts());
      this.peer = peer;
      let done = false;
      const fail = (msg) => { if (done) return; done = true; try { peer.destroy(); } catch (e) { /* ignore */ } reject(new Error(msg)); };
      const timer = setTimeout(() => fail('Timed out. Check the code and try again.'), 15000);
      peer.on('error', (err) => { clearTimeout(timer); fail(errText(err)); });
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        this.conn = conn;
        conn.on('open', () => conn.send({ t: 'hello', name }));
        conn.on('data', (msg) => {
          if (!msg || typeof msg !== 'object') return;
          if (!done) {
            if (msg.t === 'reject') { clearTimeout(timer); fail(msg.reason || 'The room said no.'); return; }
            if (msg.t === 'welcome') { clearTimeout(timer); done = true; resolve(msg); return; }
          }
          this.onMsg(msg);
        });
        conn.on('close', () => { if (done && !this.closedByUs) this.onClose(); });
        conn.on('error', () => { if (done && !this.closedByUs) this.onClose(); });
      });
    });
  }
  send(msg) { try { if (this.conn && this.conn.open) this.conn.send(msg); } catch (e) { /* ignore */ } }
  close() {
    this.closedByUs = true;
    try { this.conn && this.conn.close(); } catch (e) { /* ignore */ }
    try { this.peer && this.peer.destroy(); } catch (e) { /* ignore */ }
  }
}
