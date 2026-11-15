// Experiments lab (Part 3): runs in the browser, async, seeded.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const yieldUI = () => new Promise(r => setTimeout(r, 0));
  const pct = x => (100 * x).toFixed(0) + '%';
  const f1 = x => (Math.round(x * 10) / 10).toLocaleString();
  const f2 = x => (x < 1 ? x.toFixed(2) : f1(x));
  const fint = x => Math.round(x).toLocaleString();

  const ROSTER = {
    random: { kind: 'random' },
    greedyH1: { kind: 'greedy', heuristic: 'H1' },
    greedyH2: { kind: 'greedy', heuristic: 'H2' },
    greedyH3: { kind: 'greedy', heuristic: 'H3' },
    mm2H3: { kind: 'minimax', depth: 2, heuristic: 'H3' },
    ab2H1: { kind: 'alphabeta', depth: 2, heuristic: 'H1', ordering: true },
    ab3H1: { kind: 'alphabeta', depth: 3, heuristic: 'H1', ordering: true },
    ab3H2: { kind: 'alphabeta', depth: 3, heuristic: 'H2', ordering: true },
    ab3H3: { kind: 'alphabeta', depth: 3, heuristic: 'H3', ordering: true },
    ab4H3: { kind: 'alphabeta', depth: 4, heuristic: 'H3', ordering: true },
    mcts300: { kind: 'mcts', iterations: 300, rolloutDepth: 8, heuristic: 'H3' },
    mcts300full: { kind: 'mcts', iterations: 300, rolloutDepth: 0, heuristic: 'H3' },
  };
  const rosterLabel = k => RFAI.makeAgent(ROSTER[k]).label;

  async function playMatchAsync(agents, opts, ctx) {
    const rand = RF.rng(opts.seed || 1);
    let s = RF.initialState(opts.budget);
    const st = [0, 1].map(() => ({ time: 0, moves: 0, nodes: 0, shots: 0, att: 0, tk: 0, poss: 0 }));
    let ply = 0;
    while (!RF.isTerminal(s)) {
      if (ctx.stopped) throw new Error('stopped');
      let m;
      const t = s.turn;
      if (ply < (opts.randomOpening || 0)) { const ms = RF.legalMoves(s); m = ms[Math.floor(rand() * ms.length)]; }
      else {
        const r = agents[t].choose(s, rand);
        st[t].time += r.timeMs; st[t].moves++; st[t].nodes += r.nodes; m = r.move;
      }
      s = RF.applyMove(s, m); ply++;
      if (s.event.kind === 'goal' || s.event.kind === 'save') st[t].shots++;
      if (s.event.kind === 'tackle') st[1 - t].tk++; // tackles WON
      const ct = RF.teamOf(s.carrier);
      st[ct].poss++;
      if (RF.inAttackThird(ct, RF.R(s, s.carrier))) st[ct].att++; // plies with the ball in the attacking third
      if (ply % 4 === 0) await yieldUI();
    }
    return { score: s.score, stats: st, plies: ply };
  }

  // X vs Y, N games; X plays Team A in even games (sides alternate)
  async function pairing(cfgX, cfgY, N, opts, ctx, onGame) {
    const X = RFAI.makeAgent(cfgX), Y = RFAI.makeAgent(cfgY);
    const r = { X: X.label, Y: Y.label, n: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, tX: 0, mX: 0, nX: 0, tY: 0, mY: 0, nY: 0, shX: 0, shY: 0, attX: 0, attY: 0, tkX: 0, tkY: 0, possX: 0, possY: 0, plies: 0, ss: 0 };
    for (let i = 0; i < N; i++) {
      const xa = i % 2 === 0;
      const m = await playMatchAsync(xa ? [X, Y] : [Y, X], { ...opts, seed: (opts.seed || 1000) + Math.floor(i / 2) }, ctx);
      const ix = xa ? 0 : 1, iy = 1 - ix;
      const gx = m.score[ix], gy = m.score[iy], sx = m.stats[ix], sy = m.stats[iy];
      r.n++; r.gf += gx; r.ga += gy; r.plies += m.plies;
      const g = gx > gy ? 1 : gx < gy ? 0 : 0.5;
      if (g === 1) r.w++; else if (g === 0) r.l++; else r.d++;
      r.ss += g * g;
      r.tX += sx.time; r.mX += sx.moves; r.nX += sx.nodes; r.tY += sy.time; r.mY += sy.moves; r.nY += sy.nodes;
      r.shX += sx.shots; r.shY += sy.shots; r.attX += sx.att; r.attY += sy.att; r.tkX += sx.tk; r.tkY += sy.tk; r.possX += sx.poss; r.possY += sy.poss;
      if (onGame) onGame(r, i + 1);
    }
    r.score = (r.w + 0.5 * r.d) / r.n;
    // 95% CI from the sample variance of per-game scores (0, ½, 1)
    const variance = r.n > 1 ? Math.max(0, (r.ss - r.n * r.score * r.score) / (r.n - 1)) : 0.25;
    r.ci = 1.96 * Math.sqrt(variance / r.n);
    r.msX = r.tX / Math.max(1, r.mX); r.msY = r.tY / Math.max(1, r.mY);
    r.nodesX = r.nX / Math.max(1, r.mX); r.nodesY = r.nY / Math.max(1, r.mY);
    r.attPX = r.attX / Math.max(1, r.plies); r.attPY = r.attY / Math.max(1, r.plies);
    return r;
  }
  const scoreTxt = r => `${pct(r.score)} ±${pct(r.ci)}`;

  // ---------- tiny SVG charts ----------
  const PAL = ['#22d3ee', '#fb7185', '#fbbf24', '#34d399', '#a78bfa', '#f472b6'];
  function barChart(groups, series, opts = {}) {
    const W = 560, H = 230, pl = 50, pb = 50, pt = 22;
    const all = groups.flatMap(g => g.values).filter(v => v > 0);
    const log = opts.log;
    const tr = v => (log ? Math.log10(Math.max(v, 1)) : v);
    const maxV = Math.max(...all.map(tr), 1e-9) * 1.08;
    const gw = (W - pl - 10) / groups.length, bw = Math.min(22, (gw - 6) / series.length);
    let h = `<svg viewBox="0 0 ${W} ${H}" width="100%">`;
    for (let k = 0; k <= 4; k++) {
      const y = pt + (H - pt - pb) * (1 - k / 4), v = maxV * k / 4;
      h += `<line x1="${pl}" x2="${W - 6}" y1="${y}" y2="${y}" stroke="#253256"/><text x="${pl - 4}" y="${y + 3}" font-size="9" fill="#8d9bc4" text-anchor="end">${log ? fint(Math.pow(10, v)) : f1(v)}</text>`;
    }
    groups.forEach((g, i) => {
      const x0 = pl + i * gw + (gw - bw * series.length) / 2;
      g.values.forEach((v, j) => {
        const bh = (H - pt - pb) * (tr(v) / maxV);
        h += `<rect x="${x0 + j * bw}" y="${H - pb - bh}" width="${bw - 2}" height="${Math.max(bh, 0)}" fill="${PAL[j % PAL.length]}" rx="2"><title>${g.label} · ${series[j]}: ${fint(v)}</title></rect>`;
      });
      h += `<text x="${pl + i * gw + gw / 2}" y="${H - pb + 12}" font-size="9" fill="#cbd5e1" text-anchor="middle">${g.label}</text>`;
      if (g.sub) h += `<text x="${pl + i * gw + gw / 2}" y="${H - pb + 23}" font-size="8" fill="#8d9bc4" text-anchor="middle">${g.sub}</text>`;
    });
    series.forEach((s, j) => { h += `<rect x="${pl + j * 150}" y="${H - 14}" width="10" height="10" fill="${PAL[j]}"/><text x="${pl + j * 150 + 14}" y="${H - 5}" font-size="10" fill="#cbd5e1">${s}</text>`; });
    if (opts.title) h += `<text x="${pl}" y="13" font-size="11" fill="#8d9bc4">${opts.title}</text>`;
    return h + `</svg>`;
  }
  function lineChart(xs, series, opts = {}) {
    const W = 280, H = 190, pl = 44, pb = 30, pt = 22;
    const tr = v => (opts.log ? Math.log10(Math.max(v, 0.01)) : v);
    const vals = series.flatMap(s => s.values.map(tr));
    let lo = opts.min !== undefined ? tr(opts.min) : Math.min(...vals), hi = opts.max !== undefined ? tr(opts.max) : Math.max(...vals);
    if (hi - lo < 1e-9) { hi += 0.5; lo -= 0.5; }
    const X = i => pl + (W - pl - 10) * (xs.length === 1 ? .5 : i / (xs.length - 1));
    const Y = v => pt + (H - pt - pb) * (1 - (tr(v) - lo) / (hi - lo));
    let h = `<svg viewBox="0 0 ${W} ${H}" style="width:49%;min-width:260px">`;
    for (let k = 0; k <= 3; k++) {
      const v = lo + (hi - lo) * k / 3, y = pt + (H - pt - pb) * (1 - k / 3);
      h += `<line x1="${pl}" x2="${W - 6}" y1="${y}" y2="${y}" stroke="#253256"/><text x="${pl - 4}" y="${y + 3}" font-size="9" fill="#8d9bc4" text-anchor="end">${opts.log ? f2(Math.pow(10, v)) : opts.pct ? Math.round(v * 100) + '%' : f1(v)}</text>`;
    }
    if (opts.pct && opts.min === 0 && opts.max === 1) h += `<line x1="${pl}" x2="${W - 6}" y1="${Y(0.5)}" y2="${Y(0.5)}" stroke="#8d9bc4" stroke-dasharray="3 3"/><text x="${W - 8}" y="${Y(0.5) - 3}" font-size="8" fill="#8d9bc4" text-anchor="end">even</text>`;
    xs.forEach((x, i) => { h += `<text x="${X(i)}" y="${H - pb + 13}" font-size="9" fill="#cbd5e1" text-anchor="middle">${x}</text>`; });
    series.forEach((s, j) => {
      h += `<polyline fill="none" stroke="${PAL[j]}" stroke-width="2.5" points="${s.values.map((v, i) => X(i) + ',' + Y(v)).join(' ')}"/>`;
      s.values.forEach((v, i) => { h += `<circle cx="${X(i)}" cy="${Y(v)}" r="3.5" fill="${PAL[j]}"><title>${s.name} @ ${xs[i]}: ${opts.pct ? pct(v) : f2(v)}</title></circle>`; });
    });
    h += `<text x="${pl}" y="13" font-size="10.5" fill="#8d9bc4">${opts.title || ''}</text>`;
    if (series.length > 1) series.forEach((s, j) => { h += `<text x="${W - 8}" y="${pt + 10 + j * 12}" font-size="9" fill="${PAL[j]}" text-anchor="end">${s.name}</text>`; });
    return h + `</svg>`;
  }
  function wdlBar(r, nameX) {
    const w = r.w / r.n * 100, d = r.d / r.n * 100, l = r.l / r.n * 100;
    return `<div class="mute" style="font-size:12px">${nameX || r.X}: wins / draws / losses</div><div class="wdl"><div style="width:${w}%;background:#34d399">${r.w ? 'W ' + r.w : ''}</div><div style="width:${d}%;background:#94a3b8">${r.d ? 'D ' + r.d : ''}</div><div style="width:${l}%;background:#f87171">${r.l ? 'L ' + r.l : ''}</div></div>`;
  }
  const strip = x => String(x).replace(/<[^>]+>/g, '');
  function mdTable(head, rows) {
    return `| ${head.map(strip).join(' | ')} |\n|${head.map(() => '---').join('|')}|\n` + rows.map(r => `| ${r.map(strip).join(' | ')} |`).join('\n');
  }
  function htmlTable(head, rows, numFrom = 1) {
    return `<table><tr>${head.map((h, i) => `<th class="${i >= numFrom ? 'num' : ''}">${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${i >= numFrom ? 'num' : ''}">${c}</td>`).join('')}</tr>`).join('')}</table>`;
  }
  const drawNote = r => (r.d / r.n >= 0.6
    ? ` <b>${pct(r.d / r.n)} of games were draws</b>, which is typical here: the ball only changes hands when a carrier dribbles next to a defender, and a keeper that stays level with the ball blocks most shots. So look at the tie-breakers too: <b>shots</b> ${r.shX}–${r.shY} and <b>plies with the ball in the attacking third</b> ${r.attX}–${r.attY}.`
    : '');

  // ---------- experiment definitions ----------
  const positionsOpts = () => Object.entries(RFT.PRESETS).map(([k, p]) => [k, p.name]).concat([['current', 'Current Play board']]);
  const hOpts = [['H1', 'H1 · Field Position'], ['H2', 'H2 · Structure'], ['H3', 'H3 · Tempo']];
  const EXPS = [
    {
      id: 'prune', title: '① Pruning vs no pruning', q: 'Same heuristic, several depths and positions: how many nodes and how much time do minimax and α-β need? (α-β is shown both without and with move ordering.)',
      params: [
        { k: 'depths', label: 'Depths', type: 'text', v: '1,2,3,4' },
        { k: 'h', label: 'Heuristic', type: 'select', v: 'H1', opts: hOpts },
        { k: 'pos', label: 'Positions', type: 'multi', v: ['kickoff', 'midfield', 'attack', 'defend'], opts: positionsOpts },
      ],
      async run(p, ctx) {
        const depths = p.depths.split(',').map(Number).filter(x => x > 0 && x <= 5);
        if (!depths.length || !p.pos.length) throw new Error('choose at least one depth (1–5) and one position');
        const ev = RFAI.HEURISTICS[p.h].fn, rows = [], groups = [];
        let k = 0; const tot = depths.length * p.pos.length;
        for (const pk of p.pos) {
          const s = pk === 'current' ? window.APP.currentState() : RFT.PRESETS[pk].make();
          if (RF.isTerminal(s)) continue;
          const pname = pk === 'current' ? 'Current' : RFT.PRESETS[pk].name;
          for (const d of depths) {
            if (ctx.stopped) throw new Error('stopped');
            const mm = RFAI.minimaxChoose(s, null, ev, d);
            await yieldUI();
            const ab = RFAI.alphabetaChoose(s, null, ev, d, false);
            const abo = RFAI.alphabetaChoose(s, null, ev, d, true);
            const same = mm.value === ab.value && ab.value === abo.value;
            rows.push([pname, d, fint(mm.nodes), f2(mm.timeMs), fint(ab.nodes), f2(ab.timeMs), fint(abo.nodes), f2(abo.timeMs),
              pct(1 - ab.nodes / mm.nodes), pct(1 - abo.nodes / mm.nodes),
              same ? `<span class="ok">✓ ${Math.round(ab.value)}</span>` : '<span class="bad">✗</span>',
              RF.sameMove(mm.move, ab.move) ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>']);
            groups.push({ label: `d${d}`, sub: pk === 'current' ? 'Current' : RFT.PRESETS[pk].short, values: [mm.nodes, ab.nodes, abo.nodes], d, pk, pname, mm: mm.nodes, ab: ab.nodes, abo: abo.nodes, same, sameMove: RF.sameMove(mm.move, ab.move), rootB: RF.legalMoves(s).length, ballTeam: RF.teamOf(s.carrier), rootTeam: s.turn });
            ctx.progress(++k / tot);
            await yieldUI();
          }
        }
        const head = ['Position', 'd', 'MM nodes', 'MM ms', 'αβ nodes', 'αβ ms', 'αβ+ord nodes', 'αβ+ord ms', 'αβ saved', 'αβ+ord saved', 'same value', 'same move'];
        const dmax = Math.max(...depths);
        const atMax = groups.filter(g => g.d === dmax);
        const best = atMax.reduce((a, b) => (b.ab / b.mm < a.ab / a.mm ? b : a)), worst = atMax.reduce((a, b) => (b.ab / b.mm > a.ab / a.mm ? b : a));
        const byD = depths.map(d => { const gs = groups.filter(g => g.d === d); return 1 - gs.reduce((s, g) => s + g.ab / g.mm, 0) / gs.length; });
        const byDo = depths.map(d => { const gs = groups.filter(g => g.d === d); return 1 - gs.reduce((s, g) => s + g.abo / g.mm, 0) / gs.length; });
        const allSame = groups.every(g => g.same), allSameMove = groups.every(g => g.sameMove);
        const gain = g => (1 - g.abo / g.mm) - (1 - g.ab / g.mm);
        const bigGain = atMax.reduce((a, b) => (gain(b) > gain(a) ? b : a));
        const bf = g => g.rootB;
        const interp = `<b>${allSame ? 'Same answer, less work.' : '⚠ Value mismatch, please report this.'}</b> ${allSame ? `α-β returned exactly the same root value as minimax in all ${groups.length} searches${allSameMove ? ' (and, without ordering, the same move)' : ''}. Pruning only skips work that cannot change the decision.` : ''}<br>
          <b>Savings grow with depth</b>, because each extra level adds more sibling subtrees that can be cut. Average node saving without ordering: ${depths.map((d, i) => `d${d} ${pct(byD[i])}`).join(' · ')}; with ordering: ${depths.map((d, i) => `d${d} ${pct(byDo[i])}`).join(' · ')}. At depth 1 nothing can be pruned: every root move must be scored once.<br>
          <b>Savings depend on the position.</b> At d${dmax}, plain α-β saved the most on <b>${best.pname}</b> (${pct(1 - best.ab / best.mm)}) and the least on <b>${worst.pname}</b> (${pct(1 - worst.ab / worst.mm)}, ${bf(worst)} root moves). ${worst.ballTeam !== worst.rootTeam ? `In ${worst.pname} the side to move has no ball, so the root has many near-equal defensive moves. A "flat" position like that rarely lets a single reply refute a move, so there are few cut-offs.` : `Many near-equal moves make a position "flat", and flat positions give few cut-offs.`}<br>
          <b>Move ordering matters most on ${bigGain.pname}</b> (${pct(1 - bigGain.ab / bigGain.mm)} → ${pct(1 - bigGain.abo / bigGain.mm)} saved at d${dmax}). ${bigGain.pk === 'attack' ? 'Without ordering the moves come out as dribbles, then passes, then the shot, so the winning shot is searched <i>last</i>. With ordering it is searched first: α jumps to "goal" immediately, and every other move is refuted by its first reply.' : 'Ordering searches the most promising move first. That raises α early, so the remaining moves are refuted quickly.'} With good ordering α-β approaches its best case of O(b<sup>d/2</sup>) nodes, which in the same time means roughly twice the depth.<br>
          <b>Time</b> follows the node counts, minus a little bookkeeping overhead per node.`;
        return {
          html: htmlTable(head, rows, 1) + `<div class="chart">${barChart(groups, ['Minimax', 'α-β', 'α-β + ordering'], { log: true, title: 'Nodes expanded (log scale)' })}</div><div class="interp">${interp}</div>`,
          md: mdTable(head, rows),
        };
      },
    },
    {
      id: 'greedy', title: '② Greedy vs α-β search', q: 'A tournament between the greedy agent (no look-ahead) and α-β using the same heuristic, swapping sides every game.',
      params: [
        { k: 'n', label: 'Games', type: 'number', v: 20 }, { k: 'd', label: 'α-β depth', type: 'number', v: 4 },
        { k: 'h', label: 'Heuristic', type: 'select', v: 'H3', opts: hOpts },
        { k: 'open', label: 'Random opening moves', type: 'number', v: 2 },
      ],
      async run(p, ctx) {
        const r = await pairing({ kind: 'alphabeta', depth: +p.d, heuristic: p.h, ordering: true }, { kind: 'greedy', heuristic: p.h }, +p.n,
          { randomOpening: +p.open }, ctx, (r, i) => ctx.progress(i / p.n));
        const head = ['Agent', 'W', 'D', 'L', 'Win %', 'Draw %', 'Loss %', 'Score %', 'Goals', 'Shots', 'Att. third plies', 'ms/move', 'nodes/move'];
        const rows = [
          [r.X, r.w, r.d, r.l, pct(r.w / r.n), pct(r.d / r.n), pct(r.l / r.n), scoreTxt(r), r.gf, r.shX, r.attX, f2(r.msX), fint(r.nodesX)],
          [r.Y, r.l, r.d, r.w, pct(r.l / r.n), pct(r.d / r.n), pct(r.w / r.n), pct(1 - r.score), r.ga, r.shY, r.attY, f2(r.msY), fint(r.nodesY)],
        ];
        const verdict = r.score > 0.5 + r.ci && r.ci > 0 ? `<b>Search wins clearly</b> (${pct(r.score)}).` : r.score > 0.5 ? `<b>Search is ahead</b> (${pct(r.score)}), though the interval still touches 50%.` : r.score < 0.5 ? `<b>Greedy did better</b> (${pct(1 - r.score)}). Check the heuristic and depth.` : `<b>Dead even</b> (${pct(r.score)}).`;
        const interp = `${verdict} Greedy scores only its own next position. It cannot see that after its dribble the defender simply steps in front, or that the keeper slides across after its pass. α-β at depth ${p.d} assumes the opponent replies as well as it can, so it builds attacks that still work after the reply. It costs about ×${f1(r.msX / Math.max(r.msY, 0.001))} more time per move.${drawNote(r)}`;
        return { html: wdlBar(r) + htmlTable(head, rows) + `<div class="interp">${interp}</div>`, md: mdTable(head, rows) };
      },
    },
    {
      id: 'heur', title: '③ Heuristic vs heuristic', q: 'H1 (field position), H2 (structure) and H3 (tempo) with identical α-β settings: first head-to-head, then each against the same baseline opponents to see how well it exploits mistakes.',
      params: [{ k: 'n', label: 'Games / pairing', type: 'number', v: 20 }, { k: 'd', label: 'Depth', type: 'number', v: 3 }, { k: 'open', label: 'Random opening moves', type: 'number', v: 2 }],
      async run(p, ctx) {
        const hs = ['H1', 'H2', 'H3'], pairs = [['H3', 'H1'], ['H3', 'H2'], ['H1', 'H2']], baselines = ['random', 'greedyH1'];
        const total = (pairs.length + hs.length * baselines.length) * p.n;
        const T = {}; hs.forEach(h => (T[h] = { pts: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, sh: 0, att: 0, tk: 0, lost: 0, poss: 0, plies: 0 }));
        const cfg = h => ({ kind: 'alphabeta', depth: +p.d, heuristic: h, ordering: true });
        const rows = [];
        let done = 0;
        const prog = (r, i) => ctx.progress((done * p.n + i) / total);
        for (const [x, y] of pairs) {
          const r = await pairing(cfg(x), cfg(y), +p.n, { randomOpening: +p.open }, ctx, prog);
          done++;
          rows.push([`${x} vs ${y}`, r.w, r.d, r.l, scoreTxt(r), `${r.gf}–${r.ga}`, `${r.shX}–${r.shY}`, `${r.attX}–${r.attY}`, `${r.tkX}–${r.tkY}`]);
          const add = (h, w, d, l, gf, ga, sh, att, tk, lost, poss) => { const t = T[h]; t.w += w; t.d += d; t.l += l; t.gf += gf; t.ga += ga; t.sh += sh; t.att += att; t.tk += tk; t.lost += lost; t.poss += poss; t.plies += r.plies; t.pts += 3 * w + d; };
          add(x, r.w, r.d, r.l, r.gf, r.ga, r.shX, r.attX, r.tkX, r.tkY, r.possX); add(y, r.l, r.d, r.w, r.ga, r.gf, r.shY, r.attY, r.tkY, r.tkX, r.possY);
        }
        const league = hs.map(h => [RFAI.HEURISTICS[h].name, T[h].w, T[h].d, T[h].l, `${T[h].gf}–${T[h].ga}`, T[h].sh, T[h].att, T[h].lost, pct(T[h].poss / T[h].plies), T[h].pts]);
        // common opponents
        const base = {}, brows = [];
        for (const h of hs) {
          base[h] = {};
          for (const b of baselines) {
            const r = await pairing(cfg(h), ROSTER[b], +p.n, { randomOpening: +p.open }, ctx, prog);
            done++;
            base[h][b] = r;
          }
          brows.push([RFAI.HEURISTICS[h].name, ...baselines.flatMap(b => [scoreTxt(base[h][b]), `${base[h][b].gf}–${base[h][b].ga}`])]);
        }
        const allDraw = hs.every(h => T[h].w === 0 && T[h].l === 0);
        const by = (f, max = true) => hs.reduce((a, b) => ((max ? f(b) > f(a) : f(b) < f(a)) ? b : a));
        const name = h => `<b>${RFAI.HEURISTICS[h].name}</b>`;
        const goals = b => h => base[h][b].gf - base[h][b].ga;
        const bestRandom = by(goals('random')), bestGreedy = by(goals('greedyH1'));
        const mostAtt = by(h => T[h].att), mostLost = by(h => T[h].lost);
        const trap = T[mostLost].lost >= 20 && T[mostLost].ga === 0 && T[mostLost].lost > 2 * Math.max(...hs.filter(h => h !== mostLost).map(h => T[h].lost));
        const trappedShots = hs.filter(h => T[h].sh >= 10 && T[h].gf === 0);
        const interp = `<b>Head-to-head:</b> ${allDraw ? `every game ended in a draw${hs.every(h => T[h].gf === 0) ? ' (0–0)' : ''}, so on goals the three heuristics are <b>evenly matched</b>. Whichever heuristic defends, α-β at depth ${p.d} always gets its keeper level with the ball in time, and none of the three attacking ideas moves the ball across faster than that.` : `${name(by(h => T[h].pts))} collected the most points.`}<br>
          <b>Style differences show in the tie-breakers.</b> ${name(mostAtt)} spent the most time with the ball in the attacking third (${T[mostAtt].att} plies)${trappedShots.length ? `, and ${trappedShots.length === 1 && trappedShots[0] === mostAtt ? 'it' : trappedShots.map(name).join(' and ')} took ${trappedShots.map(h => T[h].sh).join(' / ')} shots without scoring. Those shots came from boxed-in positions where every other move also loses the ball, so shooting into the keeper was the least bad option` : ''}.
          ${trap ? `${name(mostLost)} lost the ball to tackles ${T[mostLost].lost} times yet conceded nothing. That is deliberate: it dribbles next to a defender only when the opponent's new carrier would be boxed in (no safe dribble, no open pass, a covered shot), so the search sees it win the ball straight back. Call it a <b>pressing trap</b>. It's a nice example of minimax exploiting a heuristic: the trick is "safe" within the search horizon but looks odd to a human.` : ''}<br>
          <b>Against common opponents</b> the heuristics do separate. Against Random, ${name(bestRandom)} had the best goal difference (${base[bestRandom].random.gf}–${base[bestRandom].random.ga}); against Greedy·H1, ${name(bestGreedy)} did (${base[bestGreedy].greedyH1.gf}–${base[bestGreedy].greedyH1.ga}).
          Why, in football terms: <b>H1</b> only rewards pushing the ball forward and ignores tackles and passing lanes, so it advances bluntly. <b>H2</b> is cautious: it is penalised whenever any defender is within 2 cells, so it backs away from pressure instead of attacking it. That's enough against a random defender but rarely creates chances against an organised one. <b>H3</b> counts <i>safe</i> options (a nearby defender cannot steal the ball) and rewards switching play beyond the keeper's reach. Against a defence that does not make mistakes, that is the only route to goal.`;
        return {
          html: '<h4>Head-to-head (X vs Y)</h4>' + htmlTable(['Pairing', 'X W', 'D', 'X L', 'X score %', 'Goals', 'Shots', 'Att. third plies', 'Tackles won'], rows) +
            '<h4>Summary per heuristic (3 pts per win, 1 per draw)</h4>' + htmlTable(['Heuristic', 'W', 'D', 'L', 'Goals', 'Shots', 'Att. third', 'Balls lost to tackles', 'Possession', 'Pts'], league) +
            `<h4>Against common opponents (same α-β depth ${p.d})</h4>` + htmlTable(['Heuristic', 'vs Random: score %', 'goals', 'vs Greedy·H1: score %', 'goals'], brows) +
            `<div class="interp">${interp}</div>`,
          md: mdTable(['Pairing', 'X W', 'D', 'X L', 'X score %', 'Goals', 'Shots', 'Att. third', 'Tackles won'], rows) + '\n\n' +
            mdTable(['Heuristic', 'W', 'D', 'L', 'Goals', 'Shots', 'Att. third', 'Balls lost', 'Possession', 'Pts'], league) + '\n\n' +
            mdTable(['Heuristic', 'vs Random score', 'goals', 'vs Greedy·H1 score', 'goals'], brows),
        };
      },
    },
    {
      id: 'depth', title: '④ Depth vs performance', q: 'Raise α-β depth against a fixed opponent. How do strength and computation cost change?',
      params: [
        { k: 'maxd', label: 'Max depth', type: 'number', v: 5 }, { k: 'n', label: 'Games / depth', type: 'number', v: 20 },
        { k: 'h', label: 'Heuristic', type: 'select', v: 'H3', opts: hOpts },
        { k: 'opp', label: 'Opponent', type: 'select', v: 'greedyH1', opts: () => Object.keys(ROSTER).map(k => [k, rosterLabel(k)]) },
      ],
      async run(p, ctx) {
        const rows = [], xs = [], sc = [], ms = [], gd = [];
        const maxd = Math.min(6, Math.max(1, +p.maxd));
        for (let d = 1; d <= maxd; d++) {
          const r = await pairing({ kind: 'alphabeta', depth: d, heuristic: p.h, ordering: true }, ROSTER[p.opp], +p.n, { randomOpening: 2 }, ctx,
            (r, i) => ctx.progress(((d - 1) * p.n + i) / (maxd * p.n)));
          rows.push([`d${d}`, r.w, r.d, r.l, scoreTxt(r), `${r.gf}–${r.ga}`, `${r.shX}–${r.shY}`, f2(r.msX), fint(r.nodesX)]);
          xs.push('d' + d); sc.push(r.score); ms.push(r.msX); gd.push((r.gf - r.ga) / r.n);
        }
        const growth = ms.slice(1).map((m, i) => m / Math.max(ms[i], 0.001));
        const bestI = sc.indexOf(Math.max(...sc));
        const zig = sc.some((v, i) => i > 1 && (v - sc[i - 1]) * (sc[i - 1] - sc[i - 2]) < 0);
        const interp = `<b>Cost grows exponentially:</b> time per move rises about ×${f1(growth.reduce((a, b) => a + b, 0) / Math.max(growth.length, 1))} per extra level (b<sup>d</sup>, softened by pruning).
          <b>Strength does not rise as smoothly:</b> the best score came at <b>d${bestI + 1}</b> (${pct(sc[bestI])})${bestI < sc.length - 1 ? ', and going deeper did not beat it: diminishing returns' : ''}.
          ${zig ? '<b>Odd/even zig-zag:</b> odd depths stop on our own move (optimistic: "I\'ll get there next"), while even depths include the opponent\'s reply (cautious: "but the defender steps in"), so strength need not increase monotonically.' : ''}
          The <b>horizon effect</b> explains the weak low-depth results: a tackle or a save one move beyond the search depth is simply invisible.
          The practical rule: pick the deepest search that fits your time budget per move. Here depth ${maxd} costs ${f2(ms[maxd - 1])} ms per move, against ${f2(ms[bestI])} ms at d${bestI + 1}, the strongest depth in this run.`;
        return {
          html: htmlTable(['Depth', 'W', 'D', 'L', 'Score %', 'Goals', 'Shots', 'ms/move', 'nodes/move'], rows) +
            `<div class="chart">${lineChart(xs, [{ name: 'score', values: sc }], { pct: true, min: 0, max: 1, title: 'Score % vs ' + rosterLabel(p.opp) })}${lineChart(xs, [{ name: 'ms/move', values: ms }], { log: true, title: 'ms per move (log scale)' })}</div><div class="interp">${interp}</div>`,
          md: mdTable(['Depth', 'W', 'D', 'L', 'Score %', 'Goals', 'Shots', 'ms/move', 'nodes/move'], rows),
        };
      },
    },
    {
      id: 'mcts', title: '⑤ MCTS vs other strategies', q: 'Cost and benefit of MCTS: number of iterations × roll-out style (full random to the final whistle, depth-limited + heuristic, or depth-limited with a "smart" policy).',
      params: [
        { k: 'its', label: 'Iterations', type: 'text', v: '50,200,600' }, { k: 'n', label: 'Games / setting', type: 'number', v: 10 },
        { k: 'opp', label: 'Opponent', type: 'select', v: 'greedyH1', opts: () => Object.keys(ROSTER).map(k => [k, rosterLabel(k)]) },
        { k: 'rd', label: 'Depth-limited roll-out length', type: 'number', v: 8 },
      ],
      async run(p, ctx) {
        const its = p.its.split(',').map(Number).filter(x => x > 0);
        const modes = [['full random', { rolloutDepth: 0, rolloutPolicy: 'random' }], [`${p.rd} moves + H3`, { rolloutDepth: +p.rd, rolloutPolicy: 'random' }], [`${p.rd} smart + H3`, { rolloutDepth: +p.rd, rolloutPolicy: 'smart' }]];
        const rows = [], series = modes.map(m => ({ name: m[0], values: [] })), tseries = modes.map(m => ({ name: m[0], values: [] }));
        let k = 0;
        for (const it of its) for (let j = 0; j < modes.length; j++) {
          const r = await pairing({ kind: 'mcts', iterations: it, heuristic: 'H3', ...modes[j][1] }, ROSTER[p.opp], +p.n, { randomOpening: 2 }, ctx,
            (r, i) => ctx.progress((k * p.n + i) / (its.length * modes.length * p.n)));
          k++;
          rows.push([it, modes[j][0], r.w, r.d, r.l, scoreTxt(r), `${r.gf}–${r.ga}`, `${r.shX}–${r.shY}`, f2(r.msX)]);
          series[j].values.push(r.score); tseries[j].values.push(r.msX);
        }
        const ab = RFAI.alphabetaChoose(RF.initialState(), null, RFAI.H3, 3, true);
        const all = []; its.forEach((it, i) => modes.forEach((m, j) => all.push({ it, mode: m[0], score: series[j].values[i], ms: tseries[j].values[i] })));
        const best = all.reduce((a, b) => (b.score > a.score ? b : a));
        const fullAvg = series[0].values.reduce((a, b) => a + b, 0) / its.length, limAvg = (series[1].values.concat(series[2].values)).reduce((a, b) => a + b, 0) / (2 * its.length);
        const conceded = rows.reduce((a, r) => a + Number(String(r[6]).split('–')[1] || 0), 0);
        const interp = `<b>Best setting:</b> ${best.it} iterations with ${best.mode} roll-outs, scoring ${pct(best.score)} against ${rosterLabel(p.opp)} at ${f2(best.ms)} ms per move. Averaged over iterations, full random roll-outs scored ${pct(fullAvg)} and depth-limited ones ${pct(limAvg)}.<br>
          <b>Why full random roll-outs are weak here:</b> random play almost never scores in 80 turns, so nearly every simulated game ends 0–0 and all moves look like ~50%. This is the <b>sparse reward</b> problem. Those roll-outs are also the slowest, since each one simulates the rest of the match.
          <b>Depth-limited roll-outs + H3</b> help: after ${p.rd} simulated moves the heuristic says who is better off, so each simulation is cheaper and carries more information. A <b>smart policy</b> (shoot when open, avoid tackle dribbles) makes simulated games look more like real ones.<br>
          <b>Why MCTS concedes goals (${conceded} in total here):</b> on defensive turns there are 20–34 legal moves. A few hundred simulations give each move only a handful of visits, too noisy to reliably find the single keeper slide that stops a shot. α-β simply checks every reply.<br>
          <b>Cost-benefit:</b> MCTS needs no evaluation function and is <i>anytime</i> (stop whenever time runs out), which is why it shines in huge games like Go. On this small, tactical board, α-β depth 3 with a good heuristic picks a move in about ${f2(ab.timeMs)} ms. Because it checks every reply, it never misses the keeper slide that saves a shot within its horizon. Here MCTS spends more time to play worse.`;
        return {
          html: htmlTable(['Iterations', 'Roll-out', 'W', 'D', 'L', 'Score %', 'Goals', 'Shots', 'ms/move'], rows, 2) +
            `<div class="chart">${lineChart(its.map(String), series, { pct: true, min: 0, max: 1, title: 'Score % vs ' + rosterLabel(p.opp) })}${lineChart(its.map(String), tseries, { log: true, title: 'ms per move (log scale)' })}</div><div class="interp">${interp}</div>`,
          md: mdTable(['Iterations', 'Roll-out', 'W', 'D', 'L', 'Score %', 'Goals', 'Shots', 'ms/move'], rows),
        };
      },
    },
    {
      id: 'league', title: '⑥ Grand league (bonus)', q: 'A round robin of any agents: the big picture of who beats whom, and at what cost.',
      params: [
        { k: 'agents', label: 'Agents', type: 'multi', v: ['random', 'greedyH1', 'greedyH3', 'ab3H1', 'ab4H3', 'mcts300'], opts: () => Object.keys(ROSTER).map(k => [k, rosterLabel(k)]) },
        { k: 'n', label: 'Games / pairing', type: 'number', v: 10 },
      ],
      async run(p, ctx) {
        const ks = p.agents;
        if (ks.length < 2) throw new Error('choose at least two agents');
        const T = {}; ks.forEach(k => (T[k] = { w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, ms: 0, mv: 0, sh: 0, att: 0 }));
        const pairs = []; for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) pairs.push([ks[i], ks[j]]);
        const M = {};
        let k = 0;
        for (const [x, y] of pairs) {
          const r = await pairing(ROSTER[x], ROSTER[y], +p.n, { randomOpening: 2 }, ctx, (r, i) => ctx.progress((k * p.n + i) / (pairs.length * p.n)));
          k++;
          M[x + '|' + y] = r.score; M[y + '|' + x] = 1 - r.score;
          const add = (a, w, d, l, gf, ga, t, mv, sh, att) => { const q = T[a]; q.w += w; q.d += d; q.l += l; q.gf += gf; q.ga += ga; q.pts += 3 * w + d; q.ms += t; q.mv += mv; q.sh += sh; q.att += att; };
          add(x, r.w, r.d, r.l, r.gf, r.ga, r.tX, r.mX, r.shX, r.attX); add(y, r.l, r.d, r.w, r.ga, r.gf, r.tY, r.mY, r.shY, r.attY);
        }
        const rows = ks.map(a => [rosterLabel(a), T[a].w, T[a].d, T[a].l, `${T[a].gf}–${T[a].ga}`, T[a].sh, T[a].att, T[a].pts, f2(T[a].ms / Math.max(1, T[a].mv))]).sort((a, b) => b[7] - a[7] || b[6] - a[6]);
        const mhead = ['row vs column →', ...ks.map(rosterLabel)];
        const mrows = ks.map(a => [rosterLabel(a), ...ks.map(b => (a === b ? '—' : pct(M[a + '|' + b])))]);
        return {
          html: htmlTable(['Agent', 'W', 'D', 'L', 'Goals', 'Shots', 'Att. third', 'Pts', 'ms/move'], rows) + '<h4>Head-to-head score % (row agent vs column agent)</h4>' + htmlTable(mhead, mrows) +
            `<div class="interp">Read the table together with the ms/move column: the question is not only who is strongest, but who is strongest <i>per millisecond</i>. Random is the floor. Anything that never dribbles into a tackle and keeps its keeper level with the ball is already hard to score against.</div>`,
          md: mdTable(['Agent', 'W', 'D', 'L', 'Goals', 'Shots', 'Att. third', 'Pts', 'ms/move'], rows) + '\n\n' + mdTable(mhead, mrows),
        };
      },
    },
  ];

  const cards = [];
  function initLab() {
    const box = $('labCards');
    box.innerHTML = '';
    for (const ex of EXPS) {
      const card = document.createElement('div');
      card.className = 'panel card';
      card.id = 'exp-' + ex.id;
      let ph = '';
      for (const p of ex.params) {
        const opts = typeof p.opts === 'function' ? p.opts() : p.opts;
        if (p.type === 'select') ph += `<label>${p.label}<select data-k="${p.k}">${opts.map(([v, l]) => `<option value="${v}" ${v === p.v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
        else if (p.type === 'multi') ph += `<div style="width:100%"><span class="mute" style="font-size:12px">${p.label}: </span>${opts.map(([v, l]) => `<label class="inline" style="margin-right:10px"><input type="checkbox" data-m="${p.k}" value="${v}" ${p.v.includes(v) ? 'checked' : ''}>${l}</label>`).join('')}</div>`;
        else ph += `<label>${p.label}<input ${p.type === 'number' ? 'type="number" min="1"' : ''} data-k="${p.k}" value="${p.v}" style="${p.type === 'text' ? 'width:120px' : ''}"></label>`;
      }
      card.innerHTML = `<h2>${ex.title}</h2><div class="q">${ex.q}</div><div class="params">${ph}<button class="primary run">▶ Run</button><button class="stop" disabled>■ Stop</button><button class="copy" disabled>📋 Copy Markdown</button></div>
        <div class="progress"><div></div></div><div class="status mute" style="font-size:12px">Not run yet. Press ▶ Run.</div><div class="result"></div>`;
      box.appendChild(card);
      const ctx = { stopped: false, progress: f => (card.querySelector('.progress div').style.width = (100 * Math.min(1, f)).toFixed(1) + '%') };
      const state = { md: '', running: false };
      const run = async () => {
        if (state.running) return;
        const p = {};
        card.querySelectorAll('[data-k]').forEach(i => (p[i.dataset.k] = i.value));
        ex.params.filter(x => x.type === 'multi').forEach(x => (p[x.k] = [...card.querySelectorAll(`[data-m="${x.k}"]:checked`)].map(i => i.value)));
        state.running = true; ctx.stopped = false; ctx.progress(0);
        card.querySelector('.run').disabled = true; card.querySelector('.stop').disabled = false;
        card.querySelector('.status').textContent = 'running…';
        const t0 = performance.now();
        try {
          const res = await ex.run(p, ctx);
          card.querySelector('.result').innerHTML = res.html;
          state.md = `### ${ex.title}\n\n${res.md}\n`;
          card.querySelector('.copy').disabled = false;
          card.querySelector('.status').textContent = `done in ${f1((performance.now() - t0) / 1000)} s`;
          ctx.progress(1);
        } catch (e) {
          card.querySelector('.status').textContent = e.message === 'stopped' ? 'stopped' : 'error: ' + e.message;
          if (e.message !== 'stopped') console.error(e);
        }
        state.running = false;
        card.querySelector('.run').disabled = false; card.querySelector('.stop').disabled = true;
      };
      card.querySelector('.run').onclick = run;
      card.querySelector('.stop').onclick = () => (ctx.stopped = true);
      card.querySelector('.copy').onclick = () => copy(state.md, card.querySelector('.status'));
      cards.push({ run, state, ctx });
    }
    let stopAll = false;
    $('runAll').onclick = async () => {
      if ($('runAll').dataset.running) { stopAll = true; cards.forEach(c => (c.ctx.stopped = true)); return; }
      stopAll = false; $('runAll').dataset.running = '1'; $('runAll').textContent = '■ Stop all';
      const t0 = performance.now();
      for (let i = 0; i < cards.length && !stopAll; i++) {
        $('runAllStatus').textContent = ` running ${i + 1}/${cards.length}: ${EXPS[i].title}…`;
        await cards[i].run();
      }
      delete $('runAll').dataset.running; $('runAll').textContent = '▶ Run all experiments';
      $('runAllStatus').textContent = stopAll ? ' stopped' : ` all done in ${f1((performance.now() - t0) / 1000)} s`;
      $('copyAll').disabled = !cards.some(c => c.state.md);
    };
    $('copyAll').onclick = () => copy('## Robo-Football experiment results\n\n' + cards.map(c => c.state.md).filter(Boolean).join('\n'), $('runAllStatus'));
  }
  function copy(text, statusEl) {
    const done = () => (statusEl.textContent = ' Markdown copied to clipboard ✓');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallback());
    else fallback();
    function fallback() {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { statusEl.textContent = ' copy failed. Select the table manually.'; }
      ta.remove();
    }
  }

  window.LAB = { initLab, ROSTER, pairing };
})();
