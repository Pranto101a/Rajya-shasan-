/* =====================================================================
   রাজ্যশাসন — Online multiplayer (dual transport)
   ---------------------------------------------------------------------
   Two ways to play online, auto-selected by RajNet.create():

     1. SOCKET  — when the page is opened FROM the bundled Node server
                  (http/https + socket.io client loaded). Rooms live on
                  YOUR server, so it works on a LAN / self-hosted box even
                  without the public PeerJS broker. Best for "নিজের সার্ভার".

     2. PEER    — fallback when opened as a static file / GitHub Pages
                  (no server). Uses the free PeerJS broker for signalling;
                  gameplay is peer-to-peer, zero backend.

   In BOTH transports the HOST is player 0 and authoritative; the guest is
   player 1. The two classes expose the SAME interface so ui.js/main.js
   don't care which one is in use:
       on(cbs) · createRoom() · joinRoom(code) · send(obj) · close()
   and emit:  status · code · error · open · data · close
   ===================================================================== */
(function (root) {
  'use strict';

  const PREFIX = 'rajjosashon-v1-';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars

  function randomCode(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return s;
  }

  /* ============================= PEER (PeerJS) ============================= */
  class PeerNet {
    constructor() {
      this.transport = 'peer';
      this.peer = null; this.conn = null; this.isHost = false;
      this.code = null; this.cbs = {};
      this.connected = false;
    }
    on(cbs) { this.cbs = Object.assign(this.cbs, cbs); return this; }
    _emit(name, data) { if (this.cbs[name]) try { this.cbs[name](data); } catch (e) { console.error(e); } }

    _ensurePeerLib() {
      if (typeof Peer === 'undefined') { this._emit('error', 'PeerJS লোড হয়নি — ইন্টারনেট সংযোগ দরকার।'); return false; }
      return true;
    }

    createRoom() {
      if (!this._ensurePeerLib()) return;
      this.isHost = true;
      this.code = randomCode(5);
      this._emit('status', 'রুম তৈরি হচ্ছে…');
      this.peer = new Peer(PREFIX + this.code, { debug: 1 });
      this.peer.on('open', () => {
        this._emit('code', this.code);
        this._emit('status', 'কোড শেয়ার করো — বন্ধুর যোগ দেওয়ার অপেক্ষায়…');
      });
      this.peer.on('connection', (c) => { this._bindConn(c); });
      this.peer.on('error', (e) => this._handlePeerError(e, true));
    }

    joinRoom(code) {
      if (!this._ensurePeerLib()) return;
      this.isHost = false;
      this.code = (code || '').trim().toUpperCase();
      if (this.code.length < 4) { this._emit('error', 'সঠিক কোড দাও।'); return; }
      this._emit('status', 'সংযোগ হচ্ছে…');
      this.peer = new Peer(undefined, { debug: 1 });
      this.peer.on('open', () => {
        const c = this.peer.connect(PREFIX + this.code, { reliable: true });
        this._bindConn(c);
      });
      this.peer.on('error', (e) => this._handlePeerError(e, false));
    }

    _bindConn(c) {
      this.conn = c;
      c.on('open', () => {
        this.connected = true;
        this._emit('status', 'সংযুক্ত!');
        this._emit('open', { isHost: this.isHost });
      });
      c.on('data', (d) => this._emit('data', d));
      c.on('close', () => { this.connected = false; this._emit('close'); });
      c.on('error', (e) => this._emit('error', String(e)));
    }

    _handlePeerError(e, isHost) {
      const t = (e && e.type) || '';
      let msg = 'সংযোগে সমস্যা: ' + (e && e.message ? e.message : t);
      if (t === 'unavailable-id') msg = 'এই কোড ব্যবহৃত হচ্ছে, আবার চেষ্টা করো।';
      if (t === 'peer-unavailable') msg = 'এই কোডের রুম পাওয়া যায়নি। কোড যাচাই করো।';
      if (t === 'network' || t === 'server-error') msg = 'নেটওয়ার্ক সমস্যা। আবার চেষ্টা করো।';
      this._emit('error', msg);
    }

    send(obj) {
      if (this.conn && this.connected) { try { this.conn.send(obj); } catch (e) { console.error(e); } }
    }

    close() {
      try { if (this.conn) this.conn.close(); } catch (e) {}
      try { if (this.peer) this.peer.destroy(); } catch (e) {}
      this.peer = this.conn = null; this.connected = false;
    }
  }

  /* ============================ SOCKET (Socket.IO) ============================ */
  class SocketNet {
    constructor() {
      this.transport = 'socket';
      this.socket = null; this.isHost = false;
      this.code = null; this.cbs = {};
      this.connected = false;
    }
    on(cbs) { this.cbs = Object.assign(this.cbs, cbs); return this; }
    _emit(name, data) { if (this.cbs[name]) try { this.cbs[name](data); } catch (e) { console.error(e); } }

    _connect() {
      if (typeof io === 'undefined') { this._emit('error', 'সকেট সার্ভার পাওয়া যায়নি।'); return null; }
      // same-origin connection (the server that served this page)
      return io({ transports: ['websocket', 'polling'], reconnection: false });
    }

    _commonHandlers() {
      const s = this.socket;
      s.on('relay', (d) => this._emit('data', d));
      s.on('peer-left', () => { this.connected = false; this._emit('close'); });
      s.on('connect_error', () => this._emit('error', 'সার্ভারে সংযোগ ব্যর্থ। সার্ভার চালু আছে কিনা দেখো।'));
      s.on('disconnect', () => { if (this.connected) { this.connected = false; this._emit('close'); } });
    }

    createRoom() {
      this.isHost = true;
      this._emit('status', 'সার্ভারে রুম তৈরি হচ্ছে…');
      this.socket = this._connect(); if (!this.socket) return;
      this._commonHandlers();
      this.socket.on('connect', () => this.socket.emit('create'));
      this.socket.on('created', (code) => {
        this.code = code; this._emit('code', code);
        this._emit('status', 'কোড শেয়ার করো — বন্ধুর যোগ দেওয়ার অপেক্ষায়…');
      });
      this.socket.on('peer-joined', () => {
        this.connected = true; this._emit('status', 'সংযুক্ত!');
        this._emit('open', { isHost: true });
      });
    }

    joinRoom(code) {
      this.isHost = false;
      this.code = (code || '').trim().toUpperCase();
      if (this.code.length < 4) { this._emit('error', 'সঠিক কোড দাও।'); return; }
      this._emit('status', 'সংযোগ হচ্ছে…');
      this.socket = this._connect(); if (!this.socket) return;
      this._commonHandlers();
      this.socket.on('connect', () => this.socket.emit('join', this.code));
      this.socket.on('joined', () => {
        this.connected = true; this._emit('status', 'সংযুক্ত!');
        this._emit('open', { isHost: false });
      });
      this.socket.on('no-room', () => this._emit('error', 'এই কোডের রুম পাওয়া যায়নি। কোড যাচাই করো।'));
      this.socket.on('room-full', () => this._emit('error', 'রুম ভর্তি — অন্য রুম চেষ্টা করো।'));
    }

    send(obj) { if (this.socket && this.connected) { try { this.socket.emit('relay', obj); } catch (e) { console.error(e); } } }

    close() { try { if (this.socket) this.socket.disconnect(); } catch (e) {} this.socket = null; this.connected = false; }
  }

  /* ============================ transport picker ============================ */
  // Use the server-backed socket transport when this page was served over
  // http/https AND the socket.io client is present (it is served by our own
  // Node server at /socket.io/socket.io.js). Otherwise fall back to PeerJS.
  function create() {
    const httpish = (location.protocol === 'http:' || location.protocol === 'https:');
    if (!root.RAJ_FORCE_PEER && httpish && typeof io !== 'undefined') return new SocketNet();
    return new PeerNet();
  }

  // Back-compat: RajNet.Net resolves to the auto-picked transport class type
  // is not meaningful, so expose a thin wrapper too.
  function Net() { return create(); }

  root.RajNet = { create, Net, PeerNet, SocketNet, randomCode };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.RajNet;
})(typeof window !== 'undefined' ? window : globalThis);
