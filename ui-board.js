// Board rendering, overlays, mini-boards, sound & confetti
(function () {
  'use strict';
  const { ROWS, COLS, R, C, teamOf, isGK, gkOf, inAttackThird, grid, lineClear } = RF;
  const $ = id => document.getElementById(id);
  const S = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--S')) || 84;
  const px = (r, c) => ({ x: c * S(), y: (ROWS - 1 - r) * S() });
  // DOM placement in CSS units so the board rescales with --S (media queries / window resize)
  const place = (el, r, c) => { el.style.left = `calc(var(--S) * ${c})`; el.style.top = `calc(var(--S) * ${ROWS - 1 - r})`; };
  const NS = 'http://www.w3.org/2000/svg';

  const Board = {
    el: null, cells: [], pieces: [], ball: null, svg: null, svg2: null,
    init(onCell, onPiece, onGoal) {
      const b = this.el = $('board');
      b.innerHTML = '';
      this.cells = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const d = document.createElement('div');
        d.className = 'cell';
        place(d, r, c);
        d.title = `(${r},${c})`;
        d.onclick = () => onCell(r, c);
        b.appendChild(d); this.cells[r * COLS + c] = d;
      }
      document.getElementById('axisRows').innerHTML = Array.from({ length: ROWS }, (_, i) => `<span>${ROWS - 1 - i}</span>`).join('');
      document.getElementById('axisCols').innerHTML = Array.from({ length: COLS }, (_, i) => `<span>${i}</span>`).join('');
      this.svg = document.createElementNS(NS, 'svg'); this.svg.id = 'overlay'; b.appendChild(this.svg);
      this.svg.innerHTML = `<defs>
        <marker id="arw" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0L10,5L0,10z" fill="#fbbf24"/></marker>
        <marker id="arwc" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0L10,5L0,10z" fill="#ffffff"/></marker></defs>`;
      this.svg2 = document.createElementNS(NS, 'svg'); this.svg2.id = 'overlay2'; b.appendChild(this.svg2);
      this.pieces = [];
      for (let id = 0; id < 10; id++) {
        const p = document.createElement('div');
        p.className = 'piece ' + (teamOf(id) ? 'B' : 'A') + (isGK(id) ? ' gk' : '');
        p.innerHTML = `<span class="eyes">••</span>${isGK(id) ? '' : id % 5}`;
        p.title = RF.pieceName(id);
        p.onclick = e => { e.stopPropagation(); onPiece(id); };
        b.appendChild(p); this.pieces.push(p);
      }
      this.ball = document.createElement('div'); this.ball.id = 'ball'; this.ball.textContent = '⚽'; b.appendChild(this.ball);
      for (const [gid, team] of [['goalTop', 0], ['goalBot', 1]]) {
        const g = $(gid);
        g.querySelectorAll('.gcell').forEach(x => x.remove());
        for (let c = 0; c < COLS; c++) { const gc = document.createElement('div'); gc.className = 'gcell'; g.insertBefore(gc, g.querySelector('span')); }
        g.onclick = () => onGoal(team);
      }
    },
    placeBall(s) {
      place(this.ball, R(s, s.carrier), C(s, s.carrier));
    },
    render(s, ui) {
      ui = ui || {};
      const g = grid(s), ct = teamOf(s.carrier);
      for (let id = 0; id < 10; id++) {
        const el = this.pieces[id];
        place(el, R(s, id), C(s, id));
        el.classList.toggle('carrier', id === s.carrier);
        el.classList.toggle('selected', ui.selected === id);
        el.classList.toggle('selectable', !!(ui.selectable && ui.selectable.has(id)));
        el.classList.toggle('passable', !!(ui.passTargets && ui.passTargets.has(id)));
      }
      this.ball.classList.remove('fly');
      this.placeBall(s);
      const danger = new Set();
      if (ui.ovDanger) for (let o = (1 - ct) * 5; o < (1 - ct) * 5 + 5; o++)
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const r = R(s, o) + dr, c = C(s, o) + dc; if (RF.inB(r, c)) danger.add(r * COLS + c);
        }
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const d = this.cells[r * COLS + c], k = r * COLS + c;
        d.className = 'cell';
        if (ui.ovThird) { if (inAttackThird(0, r)) d.classList.add('thirdA'); if (inAttackThird(1, r)) d.classList.add('thirdB'); }
        if (danger.has(k) && g[k] < 0) d.classList.add('danger');
        if (ui.targets && ui.targets.has(k)) { d.classList.add('target'); if (ui.risky && ui.risky.has(k)) d.classList.add('risky'); }
      }
      // keeper coverage on goals
      const cover = (gid, team) => {
        const cells = $(gid).querySelectorAll('.gcell'), kc = C(s, gkOf(team));
        cells.forEach((x, c) => x.classList.toggle('cover', !!ui.ovKeeper && Math.abs(c - kc) <= 1));
      };
      cover('goalTop', 1); cover('goalBot', 0);
      $('goalTop').classList.toggle('shootable', ui.shootable === 0);
      $('goalBot').classList.toggle('shootable', ui.shootable === 1);
      // overlays: lanes + arrows
      [...this.svg.querySelectorAll(':scope > :not(defs)')].forEach(n => n.remove());
      this.svg2.innerHTML = '';
      const ctr = (r, c) => { const p = px(r, c); return [p.x + S() / 2, p.y + S() / 2]; };
      const line = (svg, r0, c0, r1, c1, attrs) => {
        const [x0, y0] = ctr(r0, c0), [x1, y1] = ctr(r1, c1);
        const l = document.createElementNS(NS, 'line');
        l.setAttribute('x1', x0); l.setAttribute('y1', y0); l.setAttribute('x2', x1); l.setAttribute('y2', y1);
        for (const k in attrs) l.setAttribute(k, attrs[k]);
        svg.appendChild(l); return l;
      };
      if (ui.ovLanes) {
        const r = R(s, s.carrier), c = C(s, s.carrier);
        for (let t = ct * 5; t < ct * 5 + 5; t++) {
          if (t === s.carrier) continue;
          const lc = lineClear(s, g, r, c, R(s, t), C(s, t), 1 - ct);
          if (lc === null) continue;
          line(this.svg, r, c, R(s, t), C(s, t), lc === true
            ? { stroke: '#34d399', 'stroke-width': 3, opacity: .45, 'stroke-linecap': 'round' }
            : { stroke: '#f87171', 'stroke-width': 2, 'stroke-dasharray': '4 7', opacity: .45 });
        }
      }
      if (ui.cands) ui.cands.forEach((cm, i) => this.arrow(this.svg, s, cm, { stroke: '#fff', opacity: .55 - i * .12, 'stroke-width': 4 - i, marker: 'arwc' }));
      if (ui.lastEv && ui.lastPrev) this.arrowEv(ui.lastPrev, ui.lastEv);
      if (ui.hint) this.arrow(this.svg2, s, ui.hint, { stroke: '#fbbf24', opacity: 1, 'stroke-width': 5, dash: '2 7', marker: 'arw' });
    },
    arrow(svg, s, m, st) {
      let r0, c0, r1, c1;
      if (m.type === 'dribble' || m.type === 'move') { r0 = R(s, m.id); c0 = C(s, m.id); r1 = m.r; c1 = m.c; }
      else if (m.type === 'pass') { r0 = R(s, m.id); c0 = C(s, m.id); r1 = R(s, m.to); c1 = C(s, m.to); }
      else if (m.type === 'shoot') { r0 = R(s, m.id); c0 = C(s, m.id); r1 = s.turn === 0 ? 5.6 : -0.6; c1 = c0; }
      else return;
      const sz = S(), x0 = c0 * sz + sz / 2, y0 = (ROWS - 1 - r0) * sz + sz / 2, x1 = c1 * sz + sz / 2, y1 = (ROWS - 1 - r1) * sz + sz / 2;
      const l = document.createElementNS(NS, 'line');
      const sh = 0.78; // shorten
      l.setAttribute('x1', x0); l.setAttribute('y1', y0); l.setAttribute('x2', x0 + (x1 - x0) * sh); l.setAttribute('y2', y0 + (y1 - y0) * sh);
      l.setAttribute('stroke', st.stroke); l.setAttribute('stroke-width', st['stroke-width']); l.setAttribute('opacity', st.opacity);
      l.setAttribute('stroke-linecap', 'round'); l.setAttribute('marker-end', `url(#${st.marker || 'arw'})`);
      if (st.dash) l.setAttribute('stroke-dasharray', st.dash);
      svg.appendChild(l);
    },
    arrowEv(prev, ev) {
      if (!ev.move) return;
      this.arrow(this.svg2, prev, ev.move, { stroke: '#fbbf24', opacity: .9, 'stroke-width': 4, dash: ev.move.type === 'pass' ? '8 5' : null });
    },
    popup(r, c, text, color) {
      const p = px(r, c), d = document.createElement('div');
      d.className = 'popup'; d.textContent = text; d.style.color = color || '#fff';
      d.style.left = p.x + 4 + 'px'; d.style.top = p.y + 'px';
      this.el.appendChild(d); setTimeout(() => d.remove(), 1200);
    },
    flash(id) { const el = this.pieces[id]; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); },
    shootBall(fromR, fromC, team) {
      const sz = S();
      this.ball.classList.add('fly');
      this.ball.style.left = fromC * sz + 'px';
      this.ball.style.top = (team === 0 ? -sz * 0.55 : ROWS * sz + sz * 0.1) + 'px';
    },
  };

  function miniBoard(s, label) {
    const g = grid(s);
    let h = `<div class="mini-board">`;
    for (let r = ROWS - 1; r >= 0; r--) for (let c = 0; c < COLS; c++) {
      const id = g[r * COLS + c];
      if (id < 0) h += `<div class="e"></div>`;
      else h += `<div class="${teamOf(id) ? 'b' : 'a'}${id === s.carrier ? ' ball' : ''}">${isGK(id) ? 'G' : id % 5}</div>`;
    }
    h += `</div>`;
    if (label !== false) h += `<small style="color:var(--mute)">turn ${RF.TEAM_NAME[s.turn]} · score ${s.score[0]}-${s.score[1]} · ${s.turnsLeft} left</small>`;
    return h;
  }

  // ---- sound (WebAudio, no files) ----
  let actx = null, gestured = false;
  // Browsers only allow audio after a user gesture: stay silent until the first click/key.
  const unlock = () => { gestured = true; if (actx && actx.state === 'suspended') actx.resume(); };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  const Sound = {
    on: true,
    tone(freq, dur, type, vol, slide) {
      if (!this.on || !gestured) return;
      try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
        o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
        g.gain.setValueAtTime(vol || .12, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
        o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur);
      } catch (e) { /* ignore */ }
    },
    kick() { this.tone(160, .09, 'triangle', .2, 60); },
    pass() { this.tone(520, .08, 'sine', .08, 700); },
    tackle() { this.tone(110, .2, 'sawtooth', .1, 50); },
    save() { this.tone(300, .25, 'square', .07, 150); },
    whistle() { this.tone(2100, .18, 'sine', .07); setTimeout(() => this.tone(2100, .35, 'sine', .07), 220); },
    goal() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, .25, 'triangle', .12), i * 110)); },
  };

  // ---- confetti ----
  function confetti(colors) {
    const cv = $('confetti'), ctx = cv.getContext('2d');
    cv.width = innerWidth; cv.height = innerHeight;
    const parts = Array.from({ length: 160 }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * 300, y: innerHeight / 2, vx: (Math.random() - .5) * 16, vy: -Math.random() * 16 - 4,
      s: 4 + Math.random() * 6, c: colors[Math.floor(Math.random() * colors.length)], r: Math.random() * 6,
    }));
    let f = 0;
    (function tick() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += .45; p.r += .2; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); }
      if (++f < 120) requestAnimationFrame(tick); else ctx.clearRect(0, 0, cv.width, cv.height);
    })();
  }

  window.UIB = { Board, miniBoard, Sound, confetti };
})();
