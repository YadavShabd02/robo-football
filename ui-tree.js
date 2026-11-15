// Generic, step-through visualiser for minimax / alpha-beta on any tree
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const fmt = v => (v === Infinity ? '+∞' : v === -Infinity ? '−∞' : v === undefined ? '' : (Math.round(v * 100) / 100).toString());

  function nameTree(t, useLabels) {
    const all = [];
    (function walk(n, parent, path, d) {
      n.parent = parent; all[n.id] = n;
      n.name = d === 0 ? 'Root' : path;
      (n.children || []).forEach((c, i) => {
        const seg = d % 2 === 0 ? String.fromCharCode(65 + i) : String(i + 1);
        walk(c, n, (d === 0 ? '' : path) + (d >= 2 && d % 2 === 0 ? String.fromCharCode(97 + i) : seg), d + 1);
      });
      if (useLabels && n.label && d > 0) n.title = n.label;
    })(t, null, '', 0);
    return all;
  }

  class TreeView {
    constructor(o) { Object.assign(this, o); this.step = -1; this.guess = new Set(); this.timer = null; }
    load(tree, trace, rootMax, useAB, opts = {}) {
      this.tree = tree; this.trace = trace; this.rootMax = rootMax; this.useAB = useAB; this.opts = opts;
      this.nodes = nameTree(tree, opts.game);
      this.guess = new Set(); this.revealed = !opts.quiz;
      this.layout();
      this.buildStepper();
      this.stopAuto();
      this.go(opts.quiz || opts.startAt === 'begin' ? -1 : this.trace.events.length - 1);
    }
    layout() {
      let leaves = 0; (function cnt(n) { if (!n.children || !n.children.length) leaves++; else n.children.forEach(cnt); })(this.tree);
      const sp = this.opts.game ? (leaves > 16 ? 44 : 58) : (leaves > 20 ? 42 : 50), lv = this.opts.game ? 100 : 86;
      let leaf = 0, maxD = 0;
      (function walk(n) {
        maxD = Math.max(maxD, n.depth);
        if (!n.children || !n.children.length) { n.x = 40 + leaf++ * sp; }
        else { n.children.forEach(walk); n.x = (n.children[0].x + n.children[n.children.length - 1].x) / 2; }
        n.y = 40 + n.depth * lv;
      })(this.tree);
      this.W = 40 + leaf * sp + 20; this.H = 40 + maxD * lv + 70;
    }
    buildStepper() {
      const st = this.stepperEl, n = this.trace.events.length;
      st.innerHTML = `<button data-a="first">⏮</button><button data-a="prev">◀</button><button data-a="play">▶ Auto</button><button data-a="next">▶</button><button data-a="last">⏭</button>
        <input type="range" min="-1" max="${n - 1}" value="${n - 1}"><span class="lbl"></span>`;
      st.querySelectorAll('button').forEach(b => b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'play') return this.toggleAuto(b);
        this.stopAuto();
        this.go(a === 'first' ? -1 : a === 'last' ? n - 1 : this.step + (a === 'next' ? 1 : -1));
      });
      st.querySelector('input').oninput = e => { this.stopAuto(); this.go(+e.target.value); };
    }
    toggleAuto(b) {
      if (this.timer) return this.stopAuto();
      if (this.step >= this.trace.events.length - 1) this.go(-1);
      b.textContent = '⏸ Pause';
      this.timer = setInterval(() => { if (this.step >= this.trace.events.length - 1) this.stopAuto(); else this.go(this.step + 1); }, 650);
    }
    stopAuto() { clearInterval(this.timer); this.timer = null; const b = this.stepperEl.querySelector('[data-a=play]'); if (b) b.textContent = '▶ Auto'; }
    go(i) {
      const n = this.trace.events.length;
      this.step = Math.max(-1, Math.min(n - 1, i));
      this.stepperEl.querySelector('input').value = this.step;
      this.stepperEl.querySelector('.lbl').textContent = `step ${this.step + 1}/${n}`;
      // replay events
      const S = this.nodes.map(() => ({ visited: false, v: undefined, a: undefined, b: undefined, done: false, pruned: false }));
      let cur = null;
      const prune = id => { S[id].pruned = true; (this.nodes[id].children || []).forEach(c => prune(c.id)); };
      for (let k = 0; k <= this.step; k++) {
        const e = this.trace.events[k], s = S[e.id];
        if (e.t === 'enter') { s.visited = true; s.a = e.a; s.b = e.b; cur = e.id; }
        else if (e.t === 'leaf') { s.v = e.v; s.done = true; cur = e.id; }
        else if (e.t === 'update') { s.v = e.v; s.a = e.a; s.b = e.b; cur = e.id; }
        else if (e.t === 'prune') { e.ids.forEach(prune); cur = e.id; }
        else if (e.t === 'exit') { s.done = true; s.v = e.v; cur = e.id; }
      }
      this.S = S; this.cur = cur;
      this.draw();
      this.explain();
    }
    explain() {
      const e = this.trace.events[this.step];
      const N = id => `<b>${this.nodes[id].name}</b>${this.nodes[id].title ? ` <small>(${this.nodes[id].title})</small>` : ''}`;
      let h = '';
      if (!e) h = this.opts.quiz && !this.revealed ? 'Quiz mode: work it out on paper, click the leaves you think are pruned, enter the root value, then press <b>Check my answer</b>.' : 'Press <b>▶</b> to take one step, or <b>▶ Auto</b> to watch the whole trace.<br><b>α</b> = the best value MAX is already guaranteed on this path (starts at −∞).<br><b>β</b> = the best value MIN is already guaranteed (starts at +∞).<br>A branch is cut as soon as α ≥ β.';
      else if (e.t === 'enter') {
        const nd = this.nodes[e.id], isLeaf = !nd.children || !nd.children.length;
        h = isLeaf ? `Reach leaf ${N(e.id)} (window [α=${fmt(e.a)}, β=${fmt(e.b)}]). It is at the depth limit, so it is scored by the evaluation function instead of being expanded.`
          : e.id === this.tree.id ? `Start at the ${N(e.id)}, a <b>${e.isMax ? 'MAX' : 'MIN'}</b> node, with the widest window [α=−∞, β=+∞]: nothing is guaranteed yet.`
            : `Visit ${N(e.id)}, a <b>${e.isMax ? 'MAX' : 'MIN'}</b> node, with window [α=${fmt(e.a)}, β=${fmt(e.b)}] inherited from its parent. ${e.isMax ? 'MAX picks the largest child value.' : 'MIN picks the smallest child value.'}`;
      }
      else if (e.t === 'leaf') h = `Leaf ${N(e.id)} is evaluated by the heuristic: <b>${fmt(e.v)}</b>.`;
      else if (e.t === 'update') h = e.isMax
        ? `MAX ${N(e.id)}: child ${N(e.child)} returned ${fmt(e.cv)} → v = max(…) = <b>${fmt(e.v)}</b>${this.useAB ? `; α = max(α, v) = ${fmt(e.a)}` : ''}.`
        : `MIN ${N(e.id)}: child ${N(e.child)} returned ${fmt(e.cv)} → v = min(…) = <b>${fmt(e.v)}</b>${this.useAB ? `; β = min(β, v) = ${fmt(e.b)}` : ''}.`;
      else if (e.t === 'prune') h = e.isMax
        ? `✂️ <b>PRUNE</b> at MAX ${N(e.id)}: v = ${fmt(e.v)} ≥ β = ${fmt(e.b)}. The MIN node above already has an option worth ≤ ${fmt(e.b)}, so MIN will never let play reach this node — its remaining ${e.ids.length} child subtree(s) cannot change the decision.`
        : `✂️ <b>PRUNE</b> at MIN ${N(e.id)}: v = ${fmt(e.v)} ≤ α = ${fmt(e.a)}. MAX above can already guarantee ${fmt(e.a)} elsewhere, so MAX will never choose this branch — skip its remaining ${e.ids.length} child subtree(s).`;
      else if (e.t === 'exit') h = `${N(e.id)} is finished and returns <b>${fmt(e.v)}</b> to its parent.`;
      this.explainEl.innerHTML = h;
      if (this.logEl) {
        this.logEl.innerHTML = this.trace.events.map((ev, k) => `<li class="${k === this.step ? 'cur' : ''}" data-k="${k}">${this.short(ev)}</li>`).join('');
        const c = this.logEl.querySelector('.cur'); if (c) c.scrollIntoView({ block: 'nearest' });
        this.logEl.querySelectorAll('li').forEach(li => li.onclick = () => this.go(+li.dataset.k));
      }
      if (this.summaryEl) this.summary();
    }
    short(e) {
      const n = this.nodes[e.id].name;
      switch (e.t) {
        case 'enter': return `enter ${n} [${fmt(e.a)}, ${fmt(e.b)}]`;
        case 'leaf': return `leaf ${n} = ${fmt(e.v)}`;
        case 'update': return `${n}: v=${fmt(e.v)} α=${fmt(e.a)} β=${fmt(e.b)}`;
        case 'prune': return `✂ ${n} prunes ${e.ids.map(i => this.nodes[i].name).join(', ')}`;
        case 'exit': return `${n} returns ${fmt(e.v)}`;
      }
    }
    summary() {
      const t = this.trace, hidden = this.opts.quiz && !this.revealed;
      if (hidden) { this.summaryEl.innerHTML = `${t.totalLeaves} leaves in total. Your guesses: ${this.guess.size} leaves marked as pruned.`; return; }
      if (this.opts.startAt === 'begin' && this.step < t.events.length - 1) { this.summaryEl.innerHTML = `<span class="mute">Trace it yourself first. The answer (root value, leaves pruned) appears when the trace reaches the last step, or press ⏭.</span>`; return; }
      const best = this.tree.children.find(c => c.result === t.value && c.visited);
      this.summaryEl.innerHTML = `
        <table><tr><td>Root value</td><td class="num"><b>${fmt(t.value)}</b></td></tr>
        <tr><td>Best root move</td><td class="num">${best ? best.name + (best.title ? ' · ' + best.title : '') : ''}</td></tr>
        <tr><td>Leaves evaluated</td><td class="num">${t.leavesEval} / ${t.totalLeaves}</td></tr>
        <tr><td>Leaves pruned</td><td class="num">${t.totalLeaves - t.leavesEval} (${Math.round(100 * (t.totalLeaves - t.leavesEval) / t.totalLeaves)}%)</td></tr>
        <tr><td>Nodes visited</td><td class="num">${this.nodes.filter(n => n.visited).length} / ${this.nodes.length}</td></tr></table>
        ${this.extraSummary || ''}`;
    }
    draw() {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', this.W); svg.setAttribute('height', this.H);
      const S = this.S, hidden = this.opts.quiz && !this.revealed;
      const pathSet = new Set();
      if (this.cur !== null && this.cur !== undefined) { let n = this.nodes[this.cur]; while (n) { pathSet.add(n.id); n = n.parent; } }
      let h = '';
      for (const n of this.nodes) for (const c of n.children || []) {
        const pr = S[c.id].pruned, vis = S[c.id].visited;
        const col = pr ? '#64748b' : pathSet.has(c.id) ? '#fbbf24' : vis ? '#93c5fd' : '#334155';
        h += `<line x1="${n.x}" y1="${n.y + 14}" x2="${c.x}" y2="${c.y - 14}" stroke="${col}" stroke-width="${pathSet.has(c.id) ? 3 : 1.6}" ${pr ? 'stroke-dasharray="4 4"' : ''}/>`;
        if (pr && !S[n.id].pruned) h += `<text x="${(n.x + c.x) / 2}" y="${(n.y + c.y) / 2}" font-size="15" text-anchor="middle" fill="#f87171">✂</text>`;
        if (this.opts.game && n.depth === 0 && c.title) h += `<text x="${(n.x * .35 + c.x * .65)}" y="${(n.y * .35 + c.y * .65) - 4}" font-size="9.5" text-anchor="middle" fill="#cbd5e1">${c.title.slice(0, 18)}</text>`;
      }
      for (const n of this.nodes) {
        const s = S[n.id], leaf = !n.children || !n.children.length, isMax = (n.depth % 2 === 0) === this.rootMax;
        let fill = '#1e293b', stroke = '#475569';
        if (s.visited) { fill = isMax ? '#0e7490' : '#9f1239'; stroke = '#e2e8f0'; }
        if (s.done) stroke = '#94a3b8';
        if (s.pruned) { fill = '#0f172a'; stroke = '#334155'; }
        if (n.id === this.cur) stroke = '#fbbf24';
        if (hidden && leaf && this.guess.has(n.id)) { fill = '#7f1d1d'; stroke = '#f87171'; }
        const sw = n.id === this.cur ? 3.5 : 1.8;
        h += `<g class="tnode" data-id="${n.id}"><title>${n.name}${n.title ? ': ' + n.title : ''}</title>`;
        if (leaf) h += `<rect x="${n.x - 17}" y="${n.y - 13}" width="34" height="26" rx="5" fill="${s.visited ? '#334155' : fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
        else if (isMax) h += `<polygon points="${n.x},${n.y - 17} ${n.x + 19},${n.y + 13} ${n.x - 19},${n.y + 13}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
        else h += `<polygon points="${n.x},${n.y + 17} ${n.x + 19},${n.y - 13} ${n.x - 19},${n.y - 13}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
        // Game trees: a leaf's value only exists once α-β actually evaluates it.
        // Textbook trees (trainer): leaf values are given, so always show them.
        const gameLeafHidden = leaf && this.opts.game && !s.done;
        const showV = leaf ? n.value !== undefined && !gameLeafHidden : s.v !== undefined && !hidden;
        const val = leaf ? n.value : s.v;
        if (gameLeafHidden) h += `<text x="${n.x}" y="${n.y + 4}" font-size="11" text-anchor="middle" fill="#64748b">${s.pruned ? '✂' : '?'}</text>`;
        if (showV) h += `<text x="${n.x}" y="${n.y + (leaf ? 4 : isMax ? 8 : -1)}" font-size="${Math.abs(val) >= 1000 ? 8.5 : 11}" text-anchor="middle" fill="${s.pruned ? '#64748b' : '#fff'}" font-weight="700">${fmt(val)}</text>`;
        if (!leaf) h += `<text x="${n.x + 22}" y="${n.y - 8}" font-size="10" fill="#94a3b8">${n.name}</text>`;
        else h += `<text x="${n.x}" y="${n.y + 26}" font-size="9" text-anchor="middle" fill="#64748b">${n.name}</text>`;
        if (this.useAB && s.visited && !leaf && !hidden && !s.pruned)
          h += `<text x="${n.x}" y="${n.y + (isMax ? 28 : 27)}" font-size="9.5" text-anchor="middle" fill="#fde68a">[${fmt(s.a)}, ${fmt(s.b)}]</text>`;
        if (s.pruned && leaf) h += `<line x1="${n.x - 14}" y1="${n.y - 10}" x2="${n.x + 14}" y2="${n.y + 10}" stroke="#f87171" stroke-width="2"/>`;
        h += `</g>`;
      }
      h += `<text x="8" y="16" font-size="11" fill="#64748b" xml:space="preserve">▲ MAX   ▼ MIN   ■ leaf   [α, β] window   ✂ pruned${this.opts.game ? '   ? not evaluated yet' : ''}</text>`;
      svg.innerHTML = h;
      this.boxEl.innerHTML = ''; this.boxEl.appendChild(svg);
      svg.querySelectorAll('.tnode').forEach(g => {
        const n = this.nodes[+g.dataset.id];
        g.onmouseenter = () => this.onHover && this.onHover(n);
        g.onclick = () => {
          if (this.opts.quiz && !this.revealed && (!n.children || !n.children.length)) {
            this.guess.has(n.id) ? this.guess.delete(n.id) : this.guess.add(n.id);
            this.draw(); this.summary();
          } else this.onHover && this.onHover(n);
        };
      });
    }
    checkQuiz(rootGuess) {
      const actual = new Set(this.nodes.filter(n => (!n.children || !n.children.length) && !n.visited).map(n => n.id));
      const right = [...this.guess].filter(i => actual.has(i)).length;
      const wrong = [...this.guess].filter(i => !actual.has(i)).length;
      const missed = [...actual].filter(i => !this.guess.has(i)).length;
      this.revealed = true;
      this.go(this.trace.events.length - 1);
      const vOk = rootGuess !== '' && +rootGuess === this.trace.value;
      return { right, wrong, missed, vOk, total: actual.size, value: this.trace.value };
    }
  }
  window.TreeView = TreeView;
  window.fmtV = fmt;
})();
