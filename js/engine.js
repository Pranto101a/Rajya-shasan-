/* =====================================================================
   রাজ্যশাসন — Rajjosashon  •  Core Game Engine (pure, deterministic)
   ---------------------------------------------------------------------
   No DOM here. Runs in the browser AND in Node (for tests).
   The HOST is authoritative in online play: it owns the engine and
   broadcasts state snapshots. Bot/local play also drive this engine.
   ===================================================================== */
(function (root) {
  'use strict';

  // ---- The seven kings -------------------------------------------------
  // value  = points it is worth AND number of cards of its colour in deck
  const KINGS = [
    { id: 'harvest',  bn: 'শস্যরাজ',      en: 'Harvest',  value: 2, color: '#e8b22e', img: 'king_harvest.jpeg'  },
    { id: 'textiles', bn: 'বস্ত্ররাজ',     en: 'Textiles', value: 2, color: '#22b3c4', img: 'king_textiles.jpeg' },
    { id: 'feast',    bn: 'খাদ্যরাজ',      en: 'Feast',    value: 2, color: '#f08a24', img: 'king_feast.jpeg'    },
    { id: 'poetry',   bn: 'কবিরাজ',        en: 'Poetry',   value: 3, color: '#9b5de5', img: 'king_poetry.jpeg'   },
    { id: 'medicine', bn: 'চিকিৎসারাজ',    en: 'Medicine', value: 3, color: '#2bb673', img: 'king_medicine.jpeg' },
    { id: 'treasure', bn: 'গুপ্তধনরাজ',    en: 'Treasure', value: 4, color: '#c8962c', img: 'king_treasure.jpeg' },
    { id: 'war',      bn: 'যুদ্ধরাজ',      en: 'War',      value: 5, color: '#d6324a', img: 'king_war.jpeg'      }
  ];
  const TOTAL_POINTS = KINGS.reduce((s, k) => s + k.value, 0); // 21
  const WIN_POINTS = 11;
  const WIN_KINGS = 4;
  const HAND_START = 6;
  const ACTION_REQ = { 1: 1, 2: 2, 3: 3, 4: 4 }; // cards needed per token

  // ---- Seedable RNG (mulberry32) so games are reproducible/testable ----
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildDeck() {
    const deck = [];
    let uid = 0;
    for (const k of KINGS) {
      for (let i = 0; i < k.value; i++) {
        deck.push({ uid: 'c' + (uid++), king: k.id, color: k.color });
      }
    }
    return deck;
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---- Engine ----------------------------------------------------------
  class Engine {
    /* opts: { seed, names:[p0,p1] } */
    constructor(opts = {}) {
      this.seed = (opts.seed != null) ? opts.seed : (Math.floor(Math.random() * 1e9));
      this.rng = makeRng(this.seed);
      this.names = opts.names || ['খেলোয়াড় ১', 'খেলোয়াড় ২'];
      this.owner = {};                 // kingId -> 0|1|null  (persistent across rounds)
      KINGS.forEach(k => { this.owner[k.id] = null; });
      this.round = 0;
      this.starter = 0;                // who starts the round (alternates)
      this.phase = 'idle';
      this.log = [];
      this.winner = null;
      this.lastRound = null;           // summary of most recent round result
      this.newRound();
    }

    emit(type, data) { this.log.push(Object.assign({ t: type, round: this.round }, data || {})); }

    newRound() {
      this.round += 1;
      const deck = shuffle(buildDeck(), this.rng);
      this.setAside = deck.pop();      // 1 card removed, unknown -> unpredictability
      this.hands = [[], []];
      for (let i = 0; i < HAND_START; i++) { this.hands[0].push(deck.pop()); this.hands[1].push(deck.pop()); }
      this.deck = deck;                // remaining draw pile (8 cards)
      this.reserve = [[], []];         // face-down reserved cards (token 1, secret)
      this.committed = [[], []];       // face-up committed item cards (token 3 & 4) -> count toward kings
      this.destroyed = [];
      this.tokensUsed = [{}, {}];      // {tokenNum:true}
      this.active = this.starter;      // whose turn
      this.pending = null;             // {type:'pick'|'pickSet', from, payload} awaiting opponent
      this.phase = 'turn';
      this.drawForTurn();              // active player draws at start of their turn
      this.emit('roundStart', { starter: this.starter });
    }

    drawForTurn() {
      // draw 1 from deck into the active player's hand (if any left)
      if (this.deck.length > 0) {
        const c = this.deck.pop();
        this.hands[this.active].push(c);
        this.emit('draw', { player: this.active, uid: c.uid });
      }
    }

    other(p) { return p === 0 ? 1 : 0; }

    /* whose input is expected right now (turn player, or opponent if a pick pends) */
    actor() {
      if (this.phase === 'await') return this.pending.responder;
      if (this.phase === 'turn') return this.active;
      return null;
    }

    legalTokens(player) {
      if (player !== this.active || this.phase !== 'turn') return [];
      const hand = this.hands[player].length;
      const out = [];
      for (const t of [1, 2, 3, 4]) {
        if (!this.tokensUsed[player][t] && hand >= ACTION_REQ[t]) out.push(t);
      }
      return out;
    }

    /* Returns true if the current player simply cannot act (no token playable) */
    mustPass() {
      if (this.phase !== 'turn') return false;
      // any unused token at all?
      const anyUnused = [1, 2, 3, 4].some(t => !this.tokensUsed[this.active][t]);
      if (!anyUnused) return false; // round will end normally
      return this.legalTokens(this.active).length === 0;
    }

    /* ---- apply a move ----
       move types:
         {type:'action', token, cards:[uid...]}        (token 1,2,3)
         {type:'action', token:4, sets:[[uid,uid],[uid,uid]]}
         {type:'pick', uid}            (responder picks 1 of 3)
         {type:'pickSet', index}       (responder picks a set)
         {type:'pass'}
       returns {ok:true} or {ok:false, error}
    */
    apply(player, move) {
      try {
        if (this.phase === 'await') return this._applyResponse(player, move);
        if (this.phase !== 'turn') return { ok: false, error: 'not in turn phase' };
        if (player !== this.active) return { ok: false, error: 'not your turn' };

        if (move.type === 'pass') {
          // consume lowest unused token, no effect
          const t = [1, 2, 3, 4].find(x => !this.tokensUsed[player][x]);
          if (t != null) this.tokensUsed[player][t] = true;
          this.emit('pass', { player });
          return this._endTurn();
        }

        if (move.type !== 'action') return { ok: false, error: 'bad move' };
        const t = move.token;
        if (![1, 2, 3, 4].includes(t)) return { ok: false, error: 'bad token' };
        if (this.tokensUsed[player][t]) return { ok: false, error: 'token used' };

        const hand = this.hands[player];
        const need = ACTION_REQ[t];
        if (hand.length < need) return { ok: false, error: 'not enough cards' };

        if (t === 1) {
          const c = this._takeFromHand(player, move.cards[0]);
          if (!c) return { ok: false, error: 'card not in hand' };
          this.reserve[player].push(c);
          this.tokensUsed[player][t] = true;
          this.emit('reserve', { player, uid: c.uid });
          return this._endTurn();
        }

        if (t === 2) {
          const ids = move.cards.slice(0, 2);
          if (ids.length !== 2 || ids[0] === ids[1]) return { ok: false, error: 'pick two distinct cards' };
          const cs = [];
          for (const id of ids) { const c = this._takeFromHand(player, id); if (!c) { cs.forEach(x => hand.push(x)); return { ok: false, error: 'card not in hand' }; } cs.push(c); }
          this.destroyed.push(...cs);
          this.tokensUsed[player][t] = true;
          this.emit('destroy', { player, uids: cs.map(c => c.uid) });
          return this._endTurn();
        }

        if (t === 3) {
          const ids = move.cards.slice(0, 3);
          if (new Set(ids).size !== 3) return { ok: false, error: 'pick three distinct cards' };
          const cs = [];
          for (const id of ids) { const c = this._takeFromHand(player, id); if (!c) { cs.forEach(x => hand.push(x)); return { ok: false, error: 'card not in hand' }; } cs.push(c); }
          this.tokensUsed[player][t] = true;
          this.pending = { type: 'pick', from: player, responder: this.other(player), pool: cs, token: t };
          this.phase = 'await';
          this.emit('offer3', { player, uids: cs.map(c => c.uid) });
          return { ok: true };
        }

        if (t === 4) {
          const sets = move.sets;
          if (!Array.isArray(sets) || sets.length !== 2) return { ok: false, error: 'need two sets' };
          const flat = sets.flat();
          if (new Set(flat).size !== 4) return { ok: false, error: 'four distinct cards' };
          const cs = [];
          for (const id of flat) { const c = this._takeFromHand(player, id); if (!c) { cs.forEach(x => hand.push(x)); return { ok: false, error: 'card not in hand' }; } cs.push(c); }
          const byId = {}; cs.forEach(c => byId[c.uid] = c);
          const realSets = sets.map(s => s.map(id => byId[id]));
          this.tokensUsed[player][t] = true;
          this.pending = { type: 'pickSet', from: player, responder: this.other(player), sets: realSets, token: t };
          this.phase = 'await';
          this.emit('split4', { player, sets: realSets.map(s => s.map(c => c.uid)) });
          return { ok: true };
        }
        return { ok: false, error: 'unhandled' };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
    }

    _applyResponse(player, move) {
      const pend = this.pending;
      if (!pend) return { ok: false, error: 'nothing pending' };
      if (player !== pend.responder) return { ok: false, error: 'not the responder' };

      if (pend.type === 'pick') {
        const idx = pend.pool.findIndex(c => c.uid === move.uid);
        if (idx < 0) return { ok: false, error: 'card not in pool' };
        const taken = pend.pool.splice(idx, 1)[0];
        this.committed[pend.responder].push(taken);       // opponent commits 1 to their side
        this.committed[pend.from].push(...pend.pool);      // proposer commits the rest to their side
        this.emit('pickResolved', { responder: pend.responder, taken: taken.uid, kept: pend.pool.map(c => c.uid) });
      } else if (pend.type === 'pickSet') {
        const i = move.index;
        if (i !== 0 && i !== 1) return { ok: false, error: 'bad set index' };
        const taken = pend.sets[i];
        const kept = pend.sets[i === 0 ? 1 : 0];
        this.committed[pend.responder].push(...taken);     // opponent commits chosen pair
        this.committed[pend.from].push(...kept);           // proposer commits remaining pair
        this.emit('setResolved', { responder: pend.responder, taken: taken.map(c => c.uid), kept: kept.map(c => c.uid) });
      } else {
        return { ok: false, error: 'bad pending' };
      }
      const from = pend.from;
      this.pending = null;
      this.phase = 'turn';
      // turn ends for the proposer
      this.active = from;
      return this._endTurn();
    }

    _takeFromHand(player, uid) {
      const h = this.hands[player];
      const i = h.findIndex(c => c.uid === uid);
      if (i < 0) return null;
      return h.splice(i, 1)[0];
    }

    _allTokensUsed() {
      return [0, 1].every(p => [1, 2, 3, 4].every(t => this.tokensUsed[p][t]));
    }

    _endTurn() {
      if (this._allTokensUsed()) { return this._endRound(); }
      // pass turn to the other player, then they draw
      this.active = this.other(this.active);
      // if next player has unused tokens but cannot legally act, they pass automatically later via UI/mustPass.
      this.drawForTurn();
      // auto-pass loop guard: if a player has unused tokens but 0 cards & all remaining need >=1
      this.emit('turn', { player: this.active });
      return { ok: true };
    }

    _count(player) {
      // committed cards = face-up committed (token 3 & 4) + secret reserve (token 1).
      // Unplayed cards remaining in hand do NOT count (true Hanamikoji rule).
      const counts = {};
      KINGS.forEach(k => counts[k.id] = 0);
      this.committed[player].forEach(c => counts[c.king]++);
      this.reserve[player].forEach(c => counts[c.king]++);
      return counts;
    }

    _endRound() {
      const cA = this._count(0), cB = this._count(1);
      const results = {};
      KINGS.forEach(k => {
        const a = cA[k.id], b = cB[k.id];
        let win = null, changed = false, prev = this.owner[k.id];
        if (a > b) win = 0; else if (b > a) win = 1; else win = null; // tie
        if (win !== null && win !== prev) { this.owner[k.id] = win; changed = true; }
        results[k.id] = { a, b, win, prev, owner: this.owner[k.id], changed };
      });
      this.lastRound = { counts: [cA, cB], results, reserves: [this.reserve[0].slice(), this.reserve[1].slice()], setAside: this.setAside };
      this.emit('roundEnd', { results });

      // win check
      const score = this.score();
      let gw = null;
      for (const p of [0, 1]) {
        if (score[p].kings >= WIN_KINGS || score[p].points >= WIN_POINTS) gw = p;
      }
      if (gw !== null) {
        // if both qualify (rare), higher points then kings wins
        if (score[0].points >= WIN_POINTS || score[0].kings >= WIN_KINGS) {
          if (score[1].points >= WIN_POINTS || score[1].kings >= WIN_KINGS) {
            gw = (score[0].points !== score[1].points) ? (score[0].points > score[1].points ? 0 : 1)
               : (score[0].kings >= score[1].kings ? 0 : 1);
          } else gw = 0;
        } else gw = 1;
        this.winner = gw;
        this.phase = 'gameover';
        this.emit('gameOver', { winner: gw });
        return { ok: true, roundEnded: true, gameOver: true, winner: gw };
      }
      this.phase = 'roundOver';
      return { ok: true, roundEnded: true };
    }

    nextRound() {
      if (this.phase !== 'roundOver') return { ok: false, error: 'round not over' };
      this.starter = this.other(this.starter);
      this.newRound();
      return { ok: true };
    }

    score() {
      const s = [{ points: 0, kings: 0, list: [] }, { points: 0, kings: 0, list: [] }];
      KINGS.forEach(k => {
        const o = this.owner[k.id];
        if (o === 0 || o === 1) { s[o].points += k.value; s[o].kings += 1; s[o].list.push(k.id); }
      });
      return s;
    }

    /* serialisable snapshot for online sync / rendering (full info; UI hides opp hand) */
    snapshot() {
      return {
        seed: this.seed, round: this.round, starter: this.starter, phase: this.phase,
        active: this.active, actor: this.actor(), names: this.names,
        owner: Object.assign({}, this.owner),
        hands: [this.hands[0].slice(), this.hands[1].slice()],
        committed: [this.committed[0].slice(), this.committed[1].slice()],
        destroyed: this.destroyed.slice(),
        reserveCount: [this.reserve[0].length, this.reserve[1].length],
        deckCount: this.deck.length,
        tokensUsed: [Object.assign({}, this.tokensUsed[0]), Object.assign({}, this.tokensUsed[1])],
        pending: this.pending ? {
          type: this.pending.type, from: this.pending.from, responder: this.pending.responder,
          pool: this.pending.pool ? this.pending.pool.slice() : null,
          sets: this.pending.sets ? this.pending.sets.map(s => s.slice()) : null
        } : null,
        winner: this.winner, lastRound: this.lastRound, score: this.score()
      };
    }
  }

  const API = { Engine, KINGS, TOTAL_POINTS, WIN_POINTS, WIN_KINGS, HAND_START, ACTION_REQ, makeRng };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.RajEngine = API;
})(typeof window !== 'undefined' ? window : globalThis);
