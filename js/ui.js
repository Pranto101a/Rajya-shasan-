/* =====================================================================
   রাজ্যশাসন — UI + Controller
   Renders from an Engine snapshot. Routes input for Bot / Local / Online.
   ===================================================================== */
(function (root) {
  'use strict';
  const E = root.RajEngine, Bot = root.RajBot;
  const KINGS = E.KINGS, ACTION_REQ = E.ACTION_REQ;
  const KMAP = {}; KINGS.forEach(k => KMAP[k.id] = k);
  const IMG = id => 'assets/img/' + KMAP[id].img;

  const TOKEN_INFO = {
    1: { bn: 'সংরক্ষণ', desc: 'হাত থেকে ১টি কার্ড গোপনে জমা রাখো — খেলা শেষে তোমারই থাকবে।', need: 1 },
    2: { bn: 'ধ্বংস', desc: 'যেকোনো ২টি কার্ড চিরতরে নষ্ট করে দাও।', need: 2 },
    3: { bn: 'ভাগ ৩', desc: '৩টি কার্ড দেখাও — প্রতিপক্ষ ১টি নেবে, বাকি ২টি তোমার।', need: 3 },
    4: { bn: 'ভাগ ৪', desc: '৪টি কার্ডকে ২টি জোড়ায় ভাগ করো — প্রতিপক্ষ ১ জোড়া নেবে।', need: 4 }
  };

  // ---------- tiny DOM helpers ----------
  const $ = s => document.querySelector(s);
  function h(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); }

  // ---------- app/controller state ----------
  const G = {
    mode: null,        // 'bot' | 'local' | 'online'
    difficulty: 'normal',
    engine: null,      // authoritative engine (bot/local/host). null for guest.
    net: null,         // RajNet.Net for online
    isHost: false,
    myPlayer: 0,       // index this client controls (bot:0, online:own, local:dynamic)
    snap: null,        // last snapshot (used by guest; also cached)
    sel: null,         // {token, cards:[], setMode}
    lastActor: null,
    busy: false,
    names: ['তুমি', 'প্রতিপক্ষ']
  };
  root.G = G;

  function snapshot() {
    if (G.mode === 'online' && !G.isHost) return G.snap;
    return G.engine ? G.engine.snapshot() : G.snap;
  }
  function viewer(snap) {
    if (G.mode === 'bot') return 0;
    if (G.mode === 'online') return G.myPlayer;
    // local: show the actor's perspective
    return (snap.actor != null) ? snap.actor : snap.active;
  }
  function other(p) { return p === 0 ? 1 : 0; }

  // ---------- FIXED per-player identity colours ----------
  // Player index 0 (\u0996\u09c7\u09b2\u09cb\u09af\u09bc\u09be\u09a1\u09bc \u09e7) is ALWAYS blue/teal.
  // Player index 1 (\u0996\u09c7\u09b2\u09cb\u09af\u09bc\u09be\u09a1\u09bc \u09e8) is ALWAYS red/crimson.
  // This never flips, even when the local pass-and-play view changes hands.
  function colorOf(p) { return p === 0 ? 'var(--teal)' : 'var(--crimson)'; }
  function pclass(p) { return p === 0 ? 'pc0' : 'pc1'; }

  function legalTokens(snap, p) {
    if (p !== snap.active || snap.phase !== 'turn') return [];
    const hand = snap.hands[p].length, out = [];
    for (const t of [1, 2, 3, 4]) if (!snap.tokensUsed[p][t] && hand >= ACTION_REQ[t]) out.push(t);
    return out;
  }
  function mustPass(snap, p) {
    if (snap.phase !== 'turn' || p !== snap.active) return false;
    const anyUnused = [1, 2, 3, 4].some(t => !snap.tokensUsed[p][t]);
    return anyUnused && legalTokens(snap, p).length === 0;
  }

  /* =================================================================
     START MODES
     ================================================================= */
  function startBot(diff) {
    G.mode = 'bot'; G.difficulty = diff || 'normal'; G.isHost = false; G.net = null;
    G.myPlayer = 0; G.names = ['তুমি', 'বট (' + diffName(diff) + ')'];
    G.engine = new E.Engine({ names: G.names });
    G.sel = null; G.lastActor = null;
    showGame(); drive();
  }
  function startLocal(names) {
    G.mode = 'local'; G.isHost = false; G.net = null;
    const def = ['খেলোয়াড় ১', 'খেলোয়াড় ২'];
    G.names = (Array.isArray(names))
      ? [String(names[0] || '').trim() || def[0], String(names[1] || '').trim() || def[1]]
      : def;
    G.engine = new E.Engine({ names: G.names });
    G.sel = null; G.lastActor = null;
    showGame();
    // show shield for first player
    G.lastActor = -1; drive();
  }
  function startOnline(net, isHost, myName) {
    G.mode = 'online'; G.net = net; G.isHost = isHost;
    G.myPlayer = isHost ? 0 : 1;
    const mine = String(myName || '').trim();
    G.names = isHost ? [mine || 'স্বাগতিক', 'অতিথি'] : ['স্বাগতিক', mine || 'অতিথি'];
    G.sel = null; G.lastActor = null;
    if (isHost) {
      G.engine = new E.Engine({ names: G.names });
      broadcast();
    } else {
      G.engine = null; G.snap = null;
      // tell the host my chosen name so both screens show it
      if (G.net) G.net.send({ kind: 'hello', name: G.names[1] });
    }
    showGame(); render();
    if (isHost) drive();
  }
  function diffName(d) { return d === 'easy' ? 'সহজ' : d === 'hard' ? 'কঠিন' : 'মাঝারি'; }

  /* =================================================================
     SUBMIT / ROUTING
     ================================================================= */
  function submit(player, move) {
    if (G.mode === 'online' && !G.isHost) {
      G.net.send({ kind: 'move', player: player, move: move });
      G.sel = null; render(); // optimistic clear; host will echo snapshot
      return;
    }
    const res = G.engine.apply(player, move);
    if (!res.ok) { toast('চাল গ্রহণযোগ্য নয়: ' + res.error); return; }
    G.sel = null;
    afterChange();
  }
  function requestNextRound() {
    if (G.mode === 'online' && !G.isHost) { G.net.send({ kind: 'next' }); return; }
    const r = G.engine.nextRound();
    if (r.ok) { G.lastActor = (G.mode === 'local') ? -1 : null; closeOverlay(); afterChange(); }
  }
  function afterChange() {
    if (G.mode === 'online' && G.isHost) broadcast();
    render(); drive();
  }
  function broadcast() { if (G.net) G.net.send({ kind: 'snap', snap: G.engine.snapshot() }); }

  // host receives messages from guest; guest receives from host
  function onNetData(d) {
    if (!d || !d.kind) return;
    if (d.kind === 'snap') { G.snap = d.snap; const prev = G._prevPhase; handleRemoteSnap(prev); G._prevPhase = d.snap.phase; render(); return; }
    if (d.kind === 'hello' && G.isHost) {
      const nm = String(d.name || '').trim() || 'অতিথি';
      G.names[1] = nm; if (G.engine) G.engine.names[1] = nm;
      broadcast(); render(); return;
    }
    if (d.kind === 'move' && G.isHost) {
      const res = G.engine.apply(d.player, d.move);
      if (res.ok) afterChange();
      return;
    }
    if (d.kind === 'next' && G.isHost) { const r = G.engine.nextRound(); if (r.ok) { closeOverlay(); afterChange(); } return; }
  }
  function handleRemoteSnap(prevPhase) {
    // guest: open overlays when phase changes
    const s = G.snap; if (!s) return;
    if (s.phase === 'roundOver') showRoundOverlay(s);
    else if (s.phase === 'gameover') showGameOverlay(s);
    else closeOverlay();
  }

  /* =================================================================
     DRIVE: bot turns, local pass-and-play shields, auto-pass, overlays
     ================================================================= */
  function drive() {
    if (G.mode === 'online' && !G.isHost) return; // guest just renders snapshots
    const snap = G.engine.snapshot();

    if (snap.phase === 'gameover') { showGameOverlay(snap); return; }
    if (snap.phase === 'roundOver') { showRoundOverlay(snap); return; }

    const actor = snap.actor;

    // BOT mode automation
    if (G.mode === 'bot') {
      if (snap.phase === 'await' && snap.pending.responder === 1) { botRespond(); return; }
      if (snap.phase === 'turn' && snap.active === 1) { botMove(); return; }
      if (snap.phase === 'turn' && snap.active === 0 && mustPass(snap, 0)) { autoPass(0); return; }
      render(); return;
    }

    // LOCAL pass-and-play
    if (G.mode === 'local') {
      if (snap.phase === 'turn' && mustPass(snap, snap.active)) { autoPass(snap.active); return; }
      if (actor !== G.lastActor) { showShield(actor); return; }
      render(); return;
    }

    // ONLINE host
    if (G.mode === 'online') {
      // host auto-passes only for itself (player 0); guest passes handled on guest side via its own UI? 
      if (snap.phase === 'turn' && snap.active === 0 && mustPass(snap, 0)) { autoPass(0); return; }
      render(); return;
    }
  }

  function autoPass(p) {
    G.busy = true;
    setTimeout(() => { G.busy = false; const r = G.engine.apply(p, { type: 'pass' }); afterChange(); }, 650);
    toast(nameOf(p) + ' পাস করল (খেলার মতো কার্ড নেই)');
  }
  function botMove() {
    G.busy = true; render();
    setTimeout(() => {
      const mv = Bot.chooseMove(G.engine, 1, G.difficulty);
      G.engine.apply(1, mv);
      G.busy = false; afterChange();
    }, 850);
  }
  function botRespond() {
    G.busy = true; render();
    setTimeout(() => {
      const r = Bot.chooseResponse(G.engine, 1);
      G.engine.apply(1, r);
      G.busy = false; afterChange();
    }, 800);
  }

  function nameOf(p) { const s = snapshot(); return (s && s.names && s.names[p]) || G.names[p] || ('খেলোয়াড় ' + (p + 1)); }

  /* =================================================================
     RENDER
     ================================================================= */
  function showGame() { showScreen('game'); }
  function showScreen(name) {
    ['menu', 'game'].forEach(s => { const e = $('#' + s); if (e) e.classList.toggle('hidden', s !== name); });
  }

  function render() {
    const snap = snapshot();
    const gv = $('#game'); if (!gv) return;
    if (!snap) { gv.innerHTML = '<div class="stage"><div class="message">সংযোগের অপেক্ষায়…</div></div>'; return; }
    const me = viewer(snap), op = other(me);
    clear(gv);

    // ---- top bar ----
    const top = h('div', 'topbar');
    const left = h('div', 'who', '🏛️ রাজ্যশাসন · রাউন্ড ' + snap.round);
    const sc = snap.score;
    const pill = h('div', 'scorepill');
    pill.innerHTML = '<span style="color:' + colorOf(me) + ';font-weight:700">' + esc(nameOf(me)) + '</span> <b>' + sc[me].points + '</b>★ · ' + sc[me].kings + '👑' +
      ' &nbsp;|&nbsp; <span style="color:' + colorOf(op) + ';font-weight:700">' + esc(nameOf(op)) + '</span> <b>' + sc[op].points + '</b>★ · ' + sc[op].kings + '👑';
    const menuBtn = h('button', 'btn ghost sm', '⮜ মেনু'); menuBtn.onclick = confirmQuit;
    top.appendChild(left); top.appendChild(pill); top.appendChild(menuBtn);
    gv.appendChild(top);

    // ---- kings strip ----
    const kings = h('div', 'kings');
    const cmeRound = roundCounts(snap, me), copRound = roundCounts(snap, op);
    KINGS.forEach(k => {
      const ownerVal = snap.owner[k.id];
      const cls = 'king' + (ownerVal === 0 ? ' owned-0' : ownerVal === 1 ? ' owned-1' : '');
      const d = h('div', cls);
      d.dataset.king = k.id;
      
      let opCardsHtml = '';
      for(let i=0; i<copRound[k.id]; i++) opCardsHtml += '<div class="mini-kcard ' + pclass(op) + '"></div>';
      
      let meCardsHtml = '';
      for(let i=0; i<cmeRound[k.id]; i++) meCardsHtml += '<div class="mini-kcard ' + pclass(me) + '"></div>';

      d.innerHTML =
        '<div class="king-op-cards">' + opCardsHtml + '</div>' +
        '<div class="king-img-wrap">' +
          '<img src="' + IMG(k.id) + '" alt="' + esc(k.bn) + '">' +
          '<span class="kval">' + k.value + '★</span>' +
          (ownerVal != null ? '<span class="owner-flag">👑</span>' : '') +
          '<span class="kname">' + esc(k.bn) + '</span>' +
        '</div>' +
        '<div class="king-me-cards">' + meCardsHtml + '</div>';
      kings.appendChild(d);
    });
    gv.appendChild(kings);

    // ---- opponent row ----
    const oppRow = h('div', 'opp');
    const oh = h('div', 'mini-hand');
    const n = snap.hands[op].length;
    for (let i = 0; i < n; i++) oh.appendChild(h('div', 'cb'));
    const oinfo = h('div', 'who'); oinfo.innerHTML = '<b style="color:' + colorOf(op) + '">' + esc(nameOf(op)) + '</b> · 🂠' + n + ' · জমা ' + snap.reserveCount[op];
    const otoks = renderTokens(snap, op, false);
    oppRow.appendChild(otoks); oppRow.appendChild(oh); oppRow.appendChild(oinfo);
    gv.appendChild(oppRow);

    // ---- center stage ----
    const stage = h('div', 'stage');
    const inner = h('div', 'stage-inner');
    stage.appendChild(inner);
    gv.appendChild(stage);

    renderStage(inner, snap, me, op);

    // ---- player row ----
    const player = h('div', 'player');
    const phead = h('div', 'phead');
    const turnTxt = (snap.phase === 'turn' && snap.active === me) ? '🟢 তোমার চাল' :
      (snap.phase === 'await' && snap.pending && snap.pending.responder === me) ? '🟡 তোমার সিদ্ধান্ত' :
        '⏳ অপেক্ষা…';
    phead.innerHTML = '<span><b style="color:' + colorOf(me) + '">' + esc(nameOf(me)) + '</b> · জমা ' + snap.reserveCount[me] + '</span><span>' + turnTxt + '</span>';
    player.appendChild(phead);
    player.appendChild(renderTokens(snap, me, true));
    player.appendChild(renderHand(snap, me));
    gv.appendChild(player);

    maybeOnlineGuestPass(snap);
  }

  // Guest is not driven by drive(); if it's the guest's turn with no legal
  // action, auto-send a pass so the game never deadlocks.
  function maybeOnlineGuestPass(snap) {
    if (G.mode !== 'online' || G.isHost) return;
    if (G._passSent) return;
    if (snap.phase === 'turn' && snap.active === G.myPlayer && mustPass(snap, G.myPlayer)) {
      G._passSent = true;
      toast('তোমার খেলার মতো কার্ড নেই — পাস');
      setTimeout(() => { G._passSent = false; submit(G.myPlayer, { type: 'pass' }); }, 700);
    }
  }

  function renderTokens(snap, p, interactive) {
    const wrap = h('div', 'tokens');
    const legal = legalTokens(snap, p);
    const isMine = interactive && canActAs(snap, p) && snap.phase === 'turn' && snap.active === p && !G.busy;
    for (const t of [1, 2, 3, 4]) {
      const used = !!snap.tokensUsed[p][t];
      let cls = 'tok' + (used ? ' used' : '');
      if (isMine && legal.includes(t)) cls += ' legal';
      if (G.sel && G.sel.token === t && isMine) cls += ' sel';
      const e = h('div', cls, '' + t);
      e.title = TOKEN_INFO[t].bn + ' — ' + TOKEN_INFO[t].desc;
      if (isMine && legal.includes(t)) e.onclick = () => pickToken(t);
      wrap.appendChild(e);
    }
    return wrap;
  }

  function canActAs(snap, p) {
    if (G.mode === 'bot') return p === 0;
    if (G.mode === 'online') return p === G.myPlayer;
    if (G.mode === 'local') return p === snap.actor;
    return false;
  }

  function renderHand(snap, p) {
    const hand = h('div', 'hand');
    const cards = snap.hands[p];
    const mine = canActAs(snap, p);
    const selecting = G.sel && snap.phase === 'turn' && snap.active === p && mine;
    cards.forEach(c => {
      const k = KMAP[c.king];
      const card = h('div', 'card ' + pclass(p));
      const selIdx = selecting ? G.sel.cards.indexOf(c.uid) : -1;
      if (selIdx >= 0) {
        card.classList.add('sel');
        if (G.sel.token === 4) { card.classList.add(selIdx < 2 ? 'setA' : 'setB'); }
      }
      card.innerHTML = '<img src="' + IMG(c.king) + '" alt="' + esc(k.bn) + '">' +
        '<span class="cv">' + k.value + '★</span>' +
        '<span class="ctag">' + esc(k.bn) + '</span>' +
        (selIdx >= 0 && G.sel.token === 4 ? '<span class="setbadge">' + (selIdx < 2 ? 'ক' : 'খ') + '</span>' : '');
      if (selecting) { card.classList.add('selectable'); card.onclick = () => toggleCard(c.uid); }
      hand.appendChild(card);
    });
    if (cards.length === 0) hand.appendChild(h('div', 'prompt', 'হাত খালি'));
    return hand;
  }

  function renderStage(inner, snap, me, op) {
    // deck info
    const deck = h('div', 'deck-info');
    deck.innerHTML = '<div class="deck-pile"></div><span>ডেক: ' + snap.deckCount + '</span>';
    inner.appendChild(deck);

    // destroyed pile — the cards removed by power-2 are visible to BOTH players (face-up)
    if (snap.destroyed && snap.destroyed.length) {
      const dz = h('div', 'destroy-zone');
      dz.appendChild(h('div', 'dz-title', '🗑️ ধ্বংস হওয়া কার্ড (' + snap.destroyed.length + ')'));
      const row = h('div', 'dz-row');
      snap.destroyed.forEach(c => {
        const k = KMAP[c.king];
        const card = h('div', 'dz-card');
        card.innerHTML = '<img src="' + IMG(c.king) + '"><span class="dzv">' + k.value + '★</span>';
        card.title = k.bn;
        row.appendChild(card);
      });
      dz.appendChild(row);
      inner.appendChild(dz);
    }

    // GAME states
    if (snap.phase === 'await' && snap.pending) {
      const pend = snap.pending;
      const amResponder = canActAs(snap, pend.responder);
      const amProposer = canActAs(snap, pend.from);
      if (amResponder) {
        if (pend.type === 'pick') {
          inner.appendChild(h('div', 'message', 'প্রতিপক্ষ ৩টি কার্ড দিল — ১টি বেছে নাও'));
          inner.appendChild(h('div', 'prompt', 'তুমি যেটা নেবে, বাকি ২টি প্রতিপক্ষের কাছে থাকবে।'));
          const pool = h('div', 'pool');
          pend.pool.forEach(c => { const card = poolCard(c, true); card.onclick = () => submit(me, { type: 'pick', uid: c.uid }); pool.appendChild(card); });
          inner.appendChild(pool);
        } else {
          inner.appendChild(h('div', 'message', 'প্রতিপক্ষ ২টি জোড়া বানাল — ১ জোড়া নাও'));
          const wrap = h('div', 'confirm-bar');
          pend.sets.forEach((s, i) => {
            const setbox = h('div', 'panel'); setbox.style.padding = '10px'; setbox.style.display = 'flex'; setbox.style.flexDirection = 'column'; setbox.style.gap = '8px'; setbox.style.alignItems = 'center';
            const row = h('div', 'pool'); s.forEach(c => row.appendChild(poolCard(c, false))); setbox.appendChild(row);
            const b = h('button', 'btn primary sm', 'এই জোড়া নাও'); b.onclick = () => submit(me, { type: 'pickSet', index: i }); setbox.appendChild(b);
            wrap.appendChild(setbox);
          });
          inner.appendChild(wrap);
        }
      } else {
        inner.appendChild(h('div', 'message', esc(nameOf(pend.responder)) + ' সিদ্ধান্ত নিচ্ছে…'));
        if (amProposer && pend.pool) { const pool = h('div', 'pool'); pend.pool.forEach(c => pool.appendChild(poolCard(c, false))); inner.appendChild(pool); }
        if (amProposer && pend.sets) { const pool = h('div', 'pool'); pend.sets.flat().forEach(c => pool.appendChild(poolCard(c, false))); inner.appendChild(pool); }
      }
      return;
    }

    if (snap.phase === 'turn') {
      const myTurn = snap.active === me && canActAs(snap, me);
      if (!myTurn) { inner.appendChild(h('div', 'message', esc(nameOf(snap.active)) + ' এর চাল…')); return; }
      // my turn: selection flow
      if (!G.sel) {
        inner.appendChild(h('div', 'message', 'একটি টোকেন বেছে নাও (১–৪)'));
        const tip = h('div', 'prompt'); tip.innerHTML = 'টোকেনে ট্যাপ করো · ' +
          [1, 2, 3, 4].map(t => '<b style="color:var(--gold)">' + t + '</b>=' + TOKEN_INFO[t].bn).join(' · ');
        inner.appendChild(tip);
      } else {
        const t = G.sel.token, need = ACTION_REQ[t], have = G.sel.cards.length;
        inner.appendChild(h('div', 'message', 'টোকেন ' + t + ' · ' + TOKEN_INFO[t].bn));
        inner.appendChild(h('div', 'prompt', TOKEN_INFO[t].desc + ' — ' + have + '/' + need + ' কার্ড বাছা হয়েছে'));
        const bar = h('div', 'confirm-bar');
        const confirm = h('button', 'btn primary', 'নিশ্চিত করো ✓'); confirm.disabled = (have !== need);
        confirm.onclick = doConfirm;
        const cancel = h('button', 'btn ghost sm', 'বাতিল'); cancel.onclick = () => { G.sel = null; render(); };
        if (t === 4 && have === 4) { const sw = h('button', 'btn ghost sm', '⇄ জোড়া বদল'); sw.onclick = swapPair; bar.appendChild(sw); }
        bar.appendChild(confirm); bar.appendChild(cancel);
        inner.appendChild(bar);
      }
    }
  }

  function poolCard(c, selectable) {
    const k = KMAP[c.king];
    const card = h('div', 'card' + (selectable ? ' selectable' : ''));
    card.innerHTML = '<img src="' + IMG(c.king) + '"><span class="cv">' + k.value + '★</span><span class="ctag">' + esc(k.bn) + '</span>';
    return card;
  }

  // live committed counts (face-up played item cards) for the king strip.
  // Only committed cards are shown — secret reserve stays hidden until round end.
  function roundCounts(snap, p) {
    const c = {}; KINGS.forEach(k => c[k.id] = 0);
    (snap.committed[p] || []).forEach(x => c[x.king]++);
    return c;
  }

  /* =================================================================
     SELECTION HANDLERS
     ================================================================= */
  function pickToken(t) { G.sel = { token: t, cards: [] }; render(); }
  function toggleCard(uid) {
    if (!G.sel) return;
    const t = G.sel.token, need = ACTION_REQ[t], arr = G.sel.cards;
    const i = arr.indexOf(uid);
    if (i >= 0) arr.splice(i, 1);
    else { if (arr.length >= need) arr.shift(); arr.push(uid); }
    render();
  }
  function swapPair() {
    // rotate the 4 selected so pairing changes: [a,b,c,d]->[a,c,b,d]
    const a = G.sel.cards; if (a.length === 4) { const t = a[1]; a[1] = a[2]; a[2] = t; render(); }
  }
  function doConfirm() {
    const snap = snapshot(); const me = viewer(snap);
    const t = G.sel.token, cards = G.sel.cards.slice();
    let move;
    if (t === 4) move = { type: 'action', token: 4, sets: [[cards[0], cards[1]], [cards[2], cards[3]]] };
    else move = { type: 'action', token: t, cards: cards };
    submit(me, move);
  }

  /* =================================================================
     OVERLAYS
     ================================================================= */
  function overlayHost() { let o = $('#overlay'); if (!o) { o = h('div', 'overlay hidden'); o.id = 'overlay'; document.body.appendChild(o); } return o; }
  function closeOverlay() { const o = $('#overlay'); if (o) { o.classList.add('hidden'); clear(o); } }
  function showOverlay(node) { const o = overlayHost(); clear(o); o.appendChild(node); o.classList.remove('hidden'); }

  function showShield(actor) {
    const sheet = h('div', 'sheet panel');
    sheet.innerHTML = '<div class="big">🔒 ' + esc(nameOf(actor)) + ' এর পালা</div>' +
      '<div class="prompt">ডিভাইসটি ' + esc(nameOf(actor)) + ' কে দাও। অন্যজন যেন হাত না দেখে।</div>';
    const b = h('button', 'btn primary', 'প্রস্তুত — দেখাও'); b.onclick = () => { G.lastActor = actor; closeOverlay(); render(); drive(); };
    sheet.appendChild(b);
    const wrap = h('div', ''); wrap.id = 'shield'; wrap.appendChild(sheet);
    showOverlay(wrap);
  }

  function crownIcon() { return '👑'; }
  function showRoundOverlay(snap) {
    const me = (G.mode === 'online') ? G.myPlayer : 0;
    const op = other(me);
    const lr = snap.lastRound; const sc = snap.score;
    const sheet = h('div', 'sheet panel');
    sheet.appendChild(h('h2', '', 'রাউন্ড ' + snap.round + ' শেষ'));
    const sub = h('div', 'prompt'); sub.style.textAlign = 'center';
    sub.innerHTML = 'প্রতিটি রাজার পক্ষে যার বেশি কার্ড, সে রাজা জেতে। সমান হলে আগের মালিকের কাছেই থাকে।';
    sheet.appendChild(sub);

    const grid = h('div', 'result-grid');
    KINGS.forEach(k => {
      const r = lr.results[k.id];
      const cell = h('div', 'rg' + (r.owner === 0 ? ' win-0' : r.owner === 1 ? ' win-1' : ''));
      const aMe = r[me === 0 ? 'a' : 'b'], aOp = r[op === 0 ? 'a' : 'b'];
      cell.innerHTML = '<img src="' + IMG(k.id) + '">' +
        (r.owner != null ? '<span class="crown">' + (r.owner === 0 ? '🔵' : '🔴') + '</span>' : '') +
        '<span class="tally"><span style="color:' + colorOf(me) + '">' + aMe + '</span><span style="color:' + colorOf(op) + '">' + aOp + '</span></span>';
      grid.appendChild(cell);
    });
    sheet.appendChild(grid);

    // ---- reveal hidden cards: the set-aside card + each player's secret reserve ----
    const reveal = h('div', 'reveal-row');
    function miniCard(c, label, cls) {
      const box = h('div', 'reveal-box ' + (cls || ''));
      box.innerHTML = '<img src="' + IMG(c.king) + '">' +
        '<span class="rv-val">' + KMAP[c.king].value + '★</span>' +
        '<span class="rv-lbl">' + label + '</span>';
      return box;
    }
    if (lr.setAside) {
      reveal.appendChild(miniCard(lr.setAside, 'সরানো কার্ড', 'aside'));
    }
    if (lr.reserves && lr.reserves[me]) lr.reserves[me].forEach(c => reveal.appendChild(miniCard(c, esc(nameOf(me)) + ' গোপন', 'sec-' + me)));
    if (lr.reserves && lr.reserves[op]) lr.reserves[op].forEach(c => reveal.appendChild(miniCard(c, esc(nameOf(op)) + ' গোপন', 'sec-' + op)));
    if (reveal.childNodes.length) {
      sheet.appendChild(h('div', 'reveal-title', '🔍 লুকানো কার্ড উন্মোচন'));
      sheet.appendChild(reveal);
    }

    const bs = h('div', 'bigscore');
    bs.innerHTML =
      '<div><div class="s" style="color:' + colorOf(me) + '">' + sc[me].points + '★</div><div class="lbl">' + esc(nameOf(me)) + ' · ' + sc[me].kings + '👑</div></div>' +
      '<div class="lbl">লক্ষ্য<br>১১★ বা ৪👑</div>' +
      '<div><div class="s" style="color:' + colorOf(op) + '">' + sc[op].points + '★</div><div class="lbl">' + esc(nameOf(op)) + ' · ' + sc[op].kings + '👑</div></div>';
    sheet.appendChild(bs);

    const bar = h('div', 'confirm-bar');
    const canAdvance = (G.mode !== 'online') || G.isHost || true;
    const nb = h('button', 'btn primary', 'পরের রাউন্ড ▶'); nb.onclick = requestNextRound;
    bar.appendChild(nb);
    sheet.appendChild(bar);
    showOverlay(sheet);
  }

  function showGameOverlay(snap) {
    const me = (G.mode === 'online') ? G.myPlayer : 0;
    const win = snap.winner;
    const iWon = win === me;
    const sheet = h('div', 'sheet panel');
    sheet.appendChild(h('div', 'winner-title', iWon ? '🎉 তুমি জিতেছ!' : (G.mode === 'local' ? esc(nameOf(win)) + ' জিতেছে!' : 'প্রতিপক্ষ জিতেছে')));
    const sc = snap.score; const op = other(me);
    const bs = h('div', 'bigscore');
    bs.innerHTML =
      '<div><div class="s" style="color:' + colorOf(me) + '">' + sc[me].points + '★</div><div class="lbl">' + esc(nameOf(me)) + ' · ' + sc[me].kings + '👑</div></div>' +
      '<div class="lbl">vs</div>' +
      '<div><div class="s" style="color:' + colorOf(op) + '">' + sc[op].points + '★</div><div class="lbl">' + esc(nameOf(op)) + ' · ' + sc[op].kings + '👑</div></div>';
    sheet.appendChild(bs);
    const reason = (sc[win].kings >= E.WIN_KINGS) ? (E.WIN_KINGS + 'টি রাজা জয়') : (E.WIN_POINTS + '★ পয়েন্ট অর্জন');
    sheet.appendChild(h('div', 'prompt', 'জয়ের কারণ: ' + reason));
    const bar = h('div', 'confirm-bar');
    if (G.mode !== 'online' || G.isHost) {
      const again = h('button', 'btn primary', '🔄 আবার খেলো'); again.onclick = () => { closeOverlay(); restart(); };
      bar.appendChild(again);
    }
    const menu = h('button', 'btn ghost', 'মেনু'); menu.onclick = () => { closeOverlay(); quitToMenu(); };
    bar.appendChild(menu);
    sheet.appendChild(bar);
    showOverlay(sheet);
    if (iWon || G.mode === 'local') root.RajVFX && root.RajVFX.confetti();
  }

  function restart() {
    if (G.mode === 'bot') startBot(G.difficulty);
    else if (G.mode === 'local') startLocal();
    else if (G.mode === 'online' && G.isHost) { G.engine = new E.Engine({ names: G.names }); G.lastActor = null; broadcast(); render(); drive(); }
  }

  function confirmQuit() {
    if (confirm('মেনুতে ফিরে যাবে? চলতি খেলা শেষ হয়ে যাবে।')) quitToMenu();
  }
  function quitToMenu() {
    if (G.net) { try { G.net.close(); } catch (e) {} }
    G.engine = null; G.net = null; G.snap = null; G.sel = null;
    closeOverlay(); showScreen('menu');
  }

  /* =================================================================
     TOAST
     ================================================================= */
  let toastTimer = null;
  function toast(msg) {
    let t = $('#toast'); if (!t) { t = h('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---------- expose ----------
  root.RajUI = { startBot, startLocal, startOnline, onNetData, render, toast, quitToMenu, G };
})(typeof window !== 'undefined' ? window : globalThis);
