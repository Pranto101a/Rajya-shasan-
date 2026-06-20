/* =====================================================================
   রাজ্যশাসন — Bot / AI opponent
   Greedy heuristic player. Difficulty: 'easy' | 'normal' | 'hard'.
   Works directly on a live Engine instance (local & host side).
   ===================================================================== */
(function (root) {
  'use strict';
  const E = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.RajEngine;
  const KINGS = E.KINGS;
  const KMAP = {}; KINGS.forEach(k => KMAP[k.id] = k);

  function committed(engine, p) {
    const c = {}; KINGS.forEach(k => c[k.id] = 0);
    engine.committed[p].forEach(x => c[x.king]++);
    engine.reserve[p].forEach(x => c[x.king]++);
    return c;
  }

  // How much do I care about keeping ONE more card of king k right now?
  function kingImportance(engine, me, kid) {
    const opp = engine.other(me);
    const cm = committed(engine, me)[kid];
    const co = committed(engine, opp)[kid];
    const k = KMAP[kid];
    const ownsMe = engine.owner[kid] === me;
    const ownsOpp = engine.owner[kid] === opp;
    let imp = k.value;                      // base = points at stake
    const margin = cm - co;                 // >0 I'm ahead this round
    if (margin === 0) imp *= 2.2;           // a card here flips a tie -> very valuable
    else if (margin === 1) imp *= 1.6;      // protect a thin lead
    else if (margin === -1) imp *= 1.8;     // one card to catch up
    else if (margin > 1) imp *= 0.6;        // already comfortably ahead
    else imp *= 0.9;                         // far behind, still some hope
    if (ownsOpp) imp *= 1.3;                // stealing back is good
    if (ownsMe && margin >= 1) imp *= 0.8;  // safe-ish hold
    return imp;
  }

  // importance of a specific card in my hand (higher = keep)
  function cardImportance(engine, me, card) {
    return kingImportance(engine, me, card.king);
  }

  function rankHand(engine, me) {
    return engine.hands[me]
      .map(c => ({ c, w: cardImportance(engine, me, c) }))
      .sort((a, b) => a.w - b.w); // ascending: front = least important
  }

  function chooseMove(engine, me, difficulty) {
    difficulty = difficulty || 'normal';
    const legal = engine.legalTokens(me);
    if (legal.length === 0) return { type: 'pass' };

    const ranked = rankHand(engine, me);          // ascending importance
    const least = ranked.map(r => r.c);
    const most = ranked.slice().reverse().map(r => r.c);

    if (difficulty === 'easy') {
      // mostly random but still legal
      const t = legal[Math.floor(Math.random() * legal.length)];
      return buildMove(t, least, most, /*smart*/ false);
    }

    // normal / hard: pick the token that loses the least / protects the most
    // priority: reserve a truly valuable card when available; otherwise shed via 2/3/4
    const topW = ranked.length ? ranked[ranked.length - 1].w : 0;
    const wantReserve = legal.includes(1) && topW >= 4; // worth protecting

    let token;
    if (wantReserve && (difficulty === 'hard' || engine.hands[me].length <= 5 || !hasShed(legal))) {
      token = 1;
    } else {
      // shed cards: prefer to use the biggest "loss" token while hand is large
      const shedOrder = [4, 2, 3, 1];
      token = shedOrder.find(t => legal.includes(t));
      // but if hand is small, avoid token4 (needs 4 good-ish cards)
      if (token === 4 && engine.hands[me].length <= 4 && legal.includes(2)) token = 2;
    }
    return buildMove(token, least, most, true);
  }

  function hasShed(legal) { return [2, 3, 4].some(t => legal.includes(t)); }

  function buildMove(token, least, most, smart) {
    if (token === 1) {
      // reserve the MOST important card
      const c = (most[0] || least[0]);
      return { type: 'action', token: 1, cards: [c.uid] };
    }
    if (token === 2) {
      // destroy two least important
      return { type: 'action', token: 2, cards: [least[0].uid, least[1].uid] };
    }
    if (token === 3) {
      // offer three least important (opp will take one; we keep two low ones)
      return { type: 'action', token: 3, cards: [least[0].uid, least[1].uid, least[2].uid] };
    }
    if (token === 4) {
      // four least important, split into two low pairs
      const four = least.slice(0, 4);
      return { type: 'action', token: 4, sets: [[four[0].uid, four[1].uid], [four[2].uid, four[3].uid]] };
    }
    return { type: 'pass' };
  }

  // responding to opponent's offer3 / split4
  function chooseResponse(engine, me) {
    const pend = engine.pending;
    if (!pend) return null;
    if (pend.type === 'pick') {
      // take the most useful card for me
      let best = pend.pool[0], bw = -Infinity;
      for (const c of pend.pool) {
        const w = kingImportance(engine, me, c.king);
        if (w > bw) { bw = w; best = c; }
      }
      return { type: 'pick', uid: best.uid };
    }
    if (pend.type === 'pickSet') {
      const w = s => s.reduce((a, c) => a + kingImportance(engine, me, c.king), 0);
      const i = w(pend.sets[0]) >= w(pend.sets[1]) ? 0 : 1;
      return { type: 'pickSet', index: i };
    }
    return null;
  }

  const API = { chooseMove, chooseResponse, committed, kingImportance };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.RajBot = API;
})(typeof window !== 'undefined' ? window : globalThis);
