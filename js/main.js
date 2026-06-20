/* =====================================================================
   রাজ্যশাসন — bootstrap: VFX, menu wiring, online dialogs, rules
   ===================================================================== */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  function h(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  /* ---------------- VFX: embers + parallax + confetti ---------------- */
  const VFX = (function () {
    let pc, pctx, parts = [], W = 0, H = 0, raf = 0;
    function init() {
      pc = $('#particles'); if (!pc) return;
      pctx = pc.getContext('2d'); resize();
      window.addEventListener('resize', resize);
      for (let i = 0; i < 70; i++) parts.push(newP(true));
      loop();
      // parallax
      window.addEventListener('pointermove', e => {
        const bx = (e.clientX / window.innerWidth - 0.5), by = (e.clientY / window.innerHeight - 0.5);
        const img = $('#bg-img'); if (img) img.style.transform = 'scale(1.08) translate(' + (-bx * 16) + 'px,' + (-by * 16) + 'px)';
      }, { passive: true });
    }
    function resize() { if (!pc) return; W = pc.width = window.innerWidth; H = pc.height = window.innerHeight; }
    function newP(rand) {
      return { x: Math.random() * W, y: rand ? Math.random() * H : H + 10,
        r: Math.random() * 2.2 + 0.6, s: Math.random() * 0.5 + 0.15,
        d: Math.random() * 0.6 - 0.3, a: Math.random() * 0.5 + 0.25, hue: 35 + Math.random() * 18 };
    }
    function loop() {
      raf = requestAnimationFrame(loop);
      if (!pctx) return;
      pctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.y -= p.s; p.x += p.d + Math.sin(p.y * 0.01) * 0.2;
        if (p.y < -10) Object.assign(p, newP(false));
        pctx.beginPath();
        pctx.fillStyle = 'hsla(' + p.hue + ',90%,60%,' + p.a + ')';
        pctx.shadowBlur = 8; pctx.shadowColor = 'hsla(' + p.hue + ',90%,55%,.8)';
        pctx.arc(p.x, p.y, p.r, 0, 7); pctx.fill();
      }
      pctx.shadowBlur = 0;
    }
    function confetti() {
      let cc = $('#confetti'); if (!cc) { cc = h('canvas'); cc.id = 'confetti'; document.body.appendChild(cc); }
      const ctx = cc.getContext('2d'); cc.width = window.innerWidth; cc.height = window.innerHeight;
      const cols = ['#e8c46a', '#2bd0d8', '#e0455c', '#37c98a', '#f0a93a', '#fff3cf'];
      const ps = []; for (let i = 0; i < 160; i++) ps.push({ x: Math.random() * cc.width, y: -20 - Math.random() * cc.height * 0.5, vx: (Math.random() - 0.5) * 4, vy: Math.random() * 3 + 2, r: Math.random() * 7 + 3, c: cols[i % cols.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3 });
      let t = 0;
      (function run() {
        t++; ctx.clearRect(0, 0, cc.width, cc.height);
        ps.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.rot += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6); ctx.restore(); });
        if (t < 240) requestAnimationFrame(run); else ctx.clearRect(0, 0, cc.width, cc.height);
      })();
    }
    return { init, confetti };
  })();
  window.RajVFX = VFX;

  /* ---------------- overlays helper ---------------- */
  function overlayHost() { let o = $('#overlay'); if (!o) { o = h('div', 'overlay hidden'); o.id = 'overlay'; document.body.appendChild(o); } return o; }
  function closeOverlay() { const o = $('#overlay'); if (o) { o.classList.add('hidden'); o.innerHTML = ''; } }
  function showOverlay(node) { const o = overlayHost(); o.innerHTML = ''; o.appendChild(node); o.classList.remove('hidden'); }

  /* ---------------- local 2-player name entry ---------------- */
  function chooseLocal() {
    const d = h('div', 'dialog panel');
    d.appendChild(h('h2', '', '👥 একই ডিভাইসে ২ জন'));
    d.appendChild(h('div', 'prompt', 'দুজন খেলোয়াড়ের নাম লেখো। খেলোয়াড় ১ সবসময় নীল, খেলোয়াড় ২ সবসময় লাল।'));

    const f1 = h('div', 'field');
    f1.appendChild(h('label', '', '<span class="pc-dot p0"></span>খেলোয়াড় ১ (নীল)'));
    const i1 = h('input'); i1.className = 'nameinput'; i1.maxLength = 18; i1.placeholder = 'খেলোয়াড় ১'; i1.value = 'খেলোয়াড় ১'; i1.autocomplete = 'off';
    f1.appendChild(i1); d.appendChild(f1);

    const f2 = h('div', 'field');
    f2.appendChild(h('label', '', '<span class="pc-dot p1"></span>খেলোয়াড় ২ (লাল)'));
    const i2 = h('input'); i2.className = 'nameinput'; i2.maxLength = 18; i2.placeholder = 'খেলোয়াড় ২'; i2.value = 'খেলোয়াড় ২'; i2.autocomplete = 'off';
    f2.appendChild(i2); d.appendChild(f2);

    i1.addEventListener('focus', () => i1.select());
    i2.addEventListener('focus', () => i2.select());

    const start = h('button', 'btn primary', '▶ খেলা শুরু');
    start.onclick = () => { closeOverlay(); window.RajUI.startLocal([i1.value, i2.value]); };
    d.appendChild(start);
    const back = h('button', 'btn ghost sm', '← পিছনে'); back.onclick = closeOverlay; d.appendChild(back);
    showOverlay(d);
    i1.focus();
    i2.addEventListener('keydown', e => { if (e.key === 'Enter') start.click(); });
  }

  /* ---------------- difficulty dialog ---------------- */
  function chooseBot() {
    const d = h('div', 'dialog panel');
    d.appendChild(h('h2', '', '🤖 বটের সাথে খেলো'));
    d.appendChild(h('div', 'prompt', 'কঠিনতা বেছে নাও:'));
    const row = h('div', 'row');
    [['easy', 'সহজ'], ['normal', 'মাঝারি'], ['hard', 'কঠিন']].forEach(([k, label]) => {
      const b = h('button', 'btn' + (k === 'normal' ? ' primary' : ''), label);
      b.onclick = () => { closeOverlay(); window.RajUI.startBot(k); };
      row.appendChild(b);
    });
    d.appendChild(row);
    const back = h('button', 'btn ghost sm', '← পিছনে'); back.onclick = closeOverlay; d.appendChild(back);
    showOverlay(d);
  }

  /* ---------------- online dialog ---------------- */
  function chooseOnline() {
    const d = h('div', 'dialog panel');
    d.appendChild(h('h2', '', '🌐 অনলাইনে খেলো'));
    d.appendChild(h('div', 'prompt', 'একজন রুম তৈরি করো, অন্যজন কোড দিয়ে যোগ দাও।'));
    const row = h('div', 'row');
    const host = h('button', 'btn primary', '➕ রুম তৈরি করো');
    const join = h('button', 'btn', '🔑 কোড দিয়ে যোগ দাও');
    row.appendChild(host); row.appendChild(join); d.appendChild(row);
    const back = h('button', 'btn ghost sm', '← পিছনে'); back.onclick = closeOverlay; d.appendChild(back);
    host.onclick = hostFlow; join.onclick = joinFlow;
    showOverlay(d);
  }

  function wireNet(net, isHost) {
    net.on({
      status: m => setStatus(m, ''),
      code: c => { const cd = $('#codeDisp'); if (cd) cd.textContent = c; },
      error: m => setStatus(m, 'err'),
      close: () => { setStatus('সংযোগ বিচ্ছিন্ন হয়েছে।', 'err'); window.RajUI.toast('প্রতিপক্ষের সংযোগ চলে গেছে'); },
      data: d => window.RajUI.onNetData(d),
      open: () => {
        setStatus('সংযুক্ত! খেলা শুরু…', 'ok');
        const nmEl = $('#myName'); const nm = nmEl ? nmEl.value : '';
        setTimeout(() => { closeOverlay(); window.RajUI.startOnline(net, isHost, nm); }, 500);
      }
    });
  }
  function setStatus(msg, cls) { const s = $('#netStatus'); if (s) { s.textContent = msg; s.className = 'status ' + (cls || ''); } }

  function hostFlow() {
    const net = window.RajNet.create();
    const d = h('div', 'dialog panel');
    d.appendChild(h('h2', '', '➕ রুম তৈরি'));
    const nf = h('div', 'field');
    nf.appendChild(h('label', '', '<span class="pc-dot p0"></span>তোমার নাম (নীল)'));
    const ni = h('input'); ni.id = 'myName'; ni.className = 'nameinput'; ni.maxLength = 18; ni.placeholder = 'স্বাগতিক'; ni.value = 'স্বাগতিক'; ni.autocomplete = 'off';
    nf.appendChild(ni); d.appendChild(nf);
    d.appendChild(h('div', 'prompt', net.transport === 'socket' ? 'সার্ভার-রুম তৈরি হচ্ছে — এই কোডটি বন্ধুকে দাও:' : 'এই কোডটি বন্ধুকে দাও:'));
    const cd = h('div', 'code-display'); cd.id = 'codeDisp'; cd.textContent = '·····'; d.appendChild(cd);
    const copy = h('button', 'btn ghost sm', '📋 কোড কপি করো');
    copy.onclick = () => { const t = $('#codeDisp').textContent; navigator.clipboard && navigator.clipboard.writeText(t); window.RajUI.toast('কোড কপি হয়েছে: ' + t); };
    d.appendChild(copy);
    const st = h('div', 'status'); st.id = 'netStatus'; d.appendChild(st);
    const back = h('button', 'btn ghost sm', '← বাতিল'); back.onclick = () => { net.close(); closeOverlay(); }; d.appendChild(back);
    showOverlay(d);
    wireNet(net, true);
    net.createRoom();
  }

  function joinFlow() {
    const net = window.RajNet.create();
    const d = h('div', 'dialog panel');
    d.appendChild(h('h2', '', '🔑 রুমে যোগ দাও'));
    const nf = h('div', 'field');
    nf.appendChild(h('label', '', '<span class="pc-dot p1"></span>তোমার নাম (লাল)'));
    const ni = h('input'); ni.id = 'myName'; ni.className = 'nameinput'; ni.maxLength = 18; ni.placeholder = 'অতিথি'; ni.value = 'অতিথি'; ni.autocomplete = 'off';
    nf.appendChild(ni); d.appendChild(nf);
    const field = h('div', 'field');
    field.appendChild(h('label', '', 'রুম কোড'));
    const inp = h('input'); inp.id = 'joinCode'; inp.maxLength = 6; inp.placeholder = 'XXXXX'; inp.autocomplete = 'off';
    field.appendChild(inp); d.appendChild(field);
    const go = h('button', 'btn primary', 'যোগ দাও ▶');
    go.onclick = () => { const c = inp.value.trim().toUpperCase(); if (c.length < 4) { setStatus('সঠিক কোড দাও।', 'err'); return; } wireNet(net, false); net.joinRoom(c); };
    d.appendChild(go);
    const st = h('div', 'status'); st.id = 'netStatus'; d.appendChild(st);
    const back = h('button', 'btn ghost sm', '← বাতিল'); back.onclick = () => { net.close(); closeOverlay(); }; d.appendChild(back);
    showOverlay(d);
    inp.focus();
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });
  }

  /* ---------------- rules ---------------- */
  function showRules() {
    const d = h('div', 'sheet panel rules');
    d.innerHTML =
      '<h2 style="color:var(--gold);text-align:center">📜 রাজ্যশাসনের নিয়ম</h2>' +
      '<p>এটি ২ জনের একটি কৌশলের কার্ড গেম। লক্ষ্য — ৭ জন রাজার মন জয় করা। যে রাজার পক্ষে তুমি বেশি কার্ড দেবে, সেই রাজা তোমার।</p>' +
      '<h3>🏆 জয়ের শর্ত</h3><ul><li><b>৪টি রাজা</b> জয় করো, <b>অথবা</b></li><li><b>১১★ পয়েন্ট</b> জমাও (রাজাদের মান যোগ করে)। যেটা আগে হবে।</li></ul>' +
      '<h3>🎴 কার্ড ও রাজা</h3><p>প্রতিটি রাজার একটি রঙ আছে এবং তার মান (★) যত, ডেকে তার তত কার্ড। শুরুতে ১টি কার্ড গোপনে সরিয়ে রাখা হয় (অনিশ্চয়তার জন্য), প্রত্যেকে ৬টি কার্ড পায়।</p>' +
      '<h3>🪙 প্রতি চালে</h3><p>নিজের পালায় আগে ডেক থেকে ১টি কার্ড নাও, তারপর ৪টি টোকেনের যেকোনো একটি ব্যবহার করো (প্রতিটি টোকেন রাউন্ডে একবার):</p>' +
      tok(1) + tok(2) + tok(3) + tok(4) +
      '<h3>🧮 রাউন্ড শেষে</h3><p>সবার টোকেন শেষ হলে জমা কার্ডসহ প্রতিটি রঙ গোনা হয়। যার বেশি, সেই রাজা তার। সমান হলে রাজা <b>আগের মালিকের</b> কাছেই থাকে — পরের রাউন্ডে বেশি কার্ড দিয়ে রাজা <b>চুরি</b> করা যায়!</p>' +
      '<p style="color:var(--muted);font-size:.8rem;margin-top:10px">ভিডিও দেখে রূপান্তরিত · Diceymio চ্যানেলের "রাজ্যশাসন" থেকে অনুপ্রাণিত।</p>';
    const b = h('button', 'btn primary', 'বুঝেছি'); b.onclick = closeOverlay; b.style.width = '100%'; b.style.marginTop = '12px';
    d.appendChild(b);
    showOverlay(d);
  }
  function tok(t) {
    const info = { 1: ['সংরক্ষণ', 'হাত থেকে ১টি কার্ড গোপনে জমা রাখো — খেলা শেষে সেটি তোমারই গোনা হবে।'],
      2: ['ধ্বংস', 'যেকোনো ২টি কার্ড চিরতরে নষ্ট করে দাও (কেউ পাবে না)।'],
      3: ['ভাগ ৩', '৩টি কার্ড দেখাও; প্রতিপক্ষ ১টি নেবে, বাকি ২টি তোমার হাতে থাকবে।'],
      4: ['ভাগ ৪', '৪টি কার্ডকে ২টি জোড়ায় ভাগ করো; প্রতিপক্ষ ১ জোড়া নেবে, অন্যটি তোমার।'] }[t];
    return '<div class="tokrow"><div class="tok">' + t + '</div><div><b style="color:var(--gold)">' + info[0] + '</b><br><span style="font-size:.86rem;color:#ddd6c0">' + info[1] + '</span></div></div>';
  }

  /* ---------------- boot ---------------- */
  function boot() {
    VFX.init();
    $('#btn-bot').onclick = chooseBot;
    $('#btn-local').onclick = chooseLocal;
    $('#btn-online').onclick = chooseOnline;
    $('#btn-rules').onclick = showRules;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
