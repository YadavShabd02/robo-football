// ============================================================
// Robo-Football — Players & Search (Part 2)
// Random, Greedy, Minimax, Alpha-Beta (+ordering), MCTS, 3 heuristics,
// plus a generic tree tracer used by the visualisers.
// ============================================================
(function (root) {
  'use strict';
  const RF = typeof module !== 'undefined' ? require('./engine.js') : root.RF;
  const { A, B, R, C, teamOf, isGK, gkOf, forwardRow, inAttackThird, legalMoves, applyMove, isTerminal, grid, lineClear } = RF;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const cheb = (r1, c1, r2, c2) => Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));

  // ------------------------------------------------------------
  // Heuristics — all return a score from TEAM A's point of view.
  // (zero-sum: value for B = −value for A)
  // ------------------------------------------------------------
  function utility(s) { return 1000 * (s.score[0] - s.score[1]); }

  // H1 "Field Position": score, possession, how far forward the ball is, open shot.
  function H1(s) {
    let v = utility(s);
    const ct = teamOf(s.carrier), sg = ct === A ? 1 : -1;
    const r = R(s, s.carrier), c = C(s, s.carrier);
    v += sg * 50;
    v += sg * 10 * forwardRow(ct, r);
    if (inAttackThird(ct, r) && Math.abs(C(s, gkOf(1 - ct)) - c) >= 2) v += sg * 40;
    return v;
  }

  // H2 "Structure": passing lanes, tackle danger, defensive bodies, keeper alignment.
  function H2(s) {
    let v = utility(s);
    const ct = teamOf(s.carrier), dt = 1 - ct, sg = ct === A ? 1 : -1;
    const r = R(s, s.carrier), c = C(s, s.carrier), g = grid(s);
    v += sg * 50;
    v += sg * 4 * forwardRow(ct, r);
    let lanes = 0;
    for (let t = ct * 5; t < ct * 5 + 5; t++)
      if (t !== s.carrier && lineClear(s, g, r, c, R(s, t), C(s, t), dt) === true) lanes++;
    v += sg * 8 * lanes;
    let danger = false;
    for (let o = dt * 5; o < dt * 5 + 5; o++) if (cheb(R(s, o), C(s, o), r, c) <= 2) danger = true;
    if (danger) v -= sg * 30;
    let bodies = 0;
    for (let d = dt * 5 + 1; d < dt * 5 + 5; d++) {
      const dr = R(s, d);
      if (dt === A ? dr < r : dr > r) bodies++;
    }
    v -= sg * 10 * bodies;
    if (Math.abs(C(s, gkOf(dt)) - c) <= 1) v -= sg * 15;
    return v;
  }

  // H3 "Tempo" (extra, hybrid). Built on two facts of THIS rule set:
  //  (1) the ball is only ever lost by your OWN dribble into a defender (or a saved shot),
  //      so a nearby opponent is not a threat in itself — what matters is how many SAFE
  //      dribbles the carrier still has (its mobility);
  //  (2) the keeper slides one column per turn, so a shot / a pass across the pitch beats it.
  // It is turn-aware: an open shot is worth a lot only if the shooter's team moves next.
  function H3(s) {
    let v = utility(s);
    const ct = teamOf(s.carrier), dt = 1 - ct, sg = ct === A ? 1 : -1;
    const r = R(s, s.carrier), c = C(s, s.carrier), g = grid(s);
    const gkc = C(s, gkOf(dt));
    v += sg * 60;                                    // possession
    v += sg * 15 * forwardRow(ct, r);                // ball progress
    if (inAttackThird(ct, r) && Math.abs(gkc - c) >= 2) v += sg * (s.turn === ct ? 400 : 60); // open shot
    // carrier mobility: safe dribble cells (no opponent adjacent after the move)
    let safe = 0, fwdSafe = 0;
    for (const [dr, dc] of RF.DIRS) {
      const nr = r + dr, nc = c + dc;
      if (!RF.inB(nr, nc) || g[nr * 5 + nc] >= 0 || (isGK(s.carrier) && dr !== 0)) continue;
      let ok = true;
      for (let o = dt * 5; o < dt * 5 + 5; o++) if (cheb(R(s, o), C(s, o), nr, nc) <= 1) { ok = false; break; }
      if (ok) { safe++; if (forwardRow(ct, nr) > forwardRow(ct, r)) fwdSafe++; }
    }
    v += sg * 6 * (safe + fwdSafe);
    // passing lanes, forward lanes, and the "switch of play": a teammate in the attacking
    // third, reachable by a clear pass, 3+ columns from the keeper (still open after the
    // keeper's 1-column reply) is a shot waiting to happen.
    for (let t = ct * 5; t < ct * 5 + 5; t++) {
      if (t === s.carrier || lineClear(s, g, r, c, R(s, t), C(s, t), dt) !== true) continue;
      v += sg * 3;
      if (forwardRow(ct, R(s, t)) > forwardRow(ct, r)) v += sg * 6;
      if (!isGK(t) && inAttackThird(ct, R(s, t))) {
        const gap = Math.abs(gkc - C(s, t));
        if (gap >= 3 || (gap === 2 && s.turn === ct)) v += sg * 120;
        else if (gap === 2) v += sg * 30;
      }
    }
    // team shape: outfielders pushed up the pitch (both sides)
    for (let t = 1; t < 5; t++) v += 4 * forwardRow(A, R(s, t));
    for (let t = 6; t < 10; t++) v -= 4 * forwardRow(B, R(s, t));
    return v;
  }

  const HEURISTICS = {
    H1: { fn: H1, name: 'H1 · Field Position', short: 'H1' },
    H2: { fn: H2, name: 'H2 · Structure', short: 'H2' },
    H3: { fn: H3, name: 'H3 · Tempo (hybrid)', short: 'H3' },
  };

  // ------------------------------------------------------------
  // Move ordering (cheap, no evaluation call) for alpha-beta
  // ------------------------------------------------------------
  function moveKey(s, m) {
    const t = s.turn;
    switch (m.type) {
      case 'shoot': return Math.abs(C(s, gkOf(1 - t)) - C(s, m.id)) >= 2 ? 1000 : -60;
      case 'pass': return 20 + 10 * (forwardRow(t, R(s, m.to)) - forwardRow(t, R(s, m.id)));
      case 'dribble': {
        let risk = 0;
        for (let o = (1 - t) * 5; o < (1 - t) * 5 + 5; o++) if (cheb(R(s, o), C(s, o), m.r, m.c) <= 1) risk = 100;
        return 10 * (forwardRow(t, m.r) - forwardRow(t, R(s, m.id))) - risk;
      }
      case 'move': {
        const br = R(s, s.carrier), bc = C(s, s.carrier);
        if (isGK(m.id)) return Math.abs(m.c - bc) < Math.abs(C(s, m.id) - bc) ? 8 : -8;
        return -5 * cheb(m.r, m.c, br, bc) + 5 * cheb(R(s, m.id), C(s, m.id), br, bc);
      }
      default: return 0;
    }
  }
  function orderMoves(s, ms) {
    return ms.map(m => [moveKey(s, m), m]).sort((x, y) => y[0] - x[0]).map(x => x[1]);
  }
  function shuffle(a, rand) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // ------------------------------------------------------------
  // Agents. choose(s, rand) -> { move, value, nodes, leaves, timeMs, scores:[{move,value,bound}] }
  // ------------------------------------------------------------
  function randomChoose(s, rand) {
    const t0 = now(), ms = legalMoves(s);
    const move = ms[Math.floor((rand || Math.random)() * ms.length)];
    return { move, value: 0, nodes: 1, leaves: 0, timeMs: now() - t0, scores: [] };
  }

  function valFor(rootTeam, evalFn) {
    const sg = rootTeam === A ? 1 : -1;
    return st => (isTerminal(st) ? utility(st) : evalFn(st)) * sg;
  }

  function greedyChoose(s, rand, evalFn) {
    const t0 = now(), val = valFor(s.turn, evalFn);
    let ms = legalMoves(s);
    if (rand) ms = shuffle(ms.slice(), rand);
    let best = null, bv = -Infinity;
    const scores = [];
    for (const m of ms) {
      const v = val(applyMove(s, m));
      scores.push({ move: m, value: v });
      if (v > bv) { bv = v; best = m; }
    }
    return { move: best, value: bv, nodes: 1 + ms.length, leaves: ms.length, timeMs: now() - t0, scores };
  }

  function minimaxChoose(s, rand, evalFn, depth) {
    const t0 = now(), rootTeam = s.turn, val = valFor(rootTeam, evalFn);
    const st = { nodes: 0, leaves: 0 };
    function mm(x, d) {
      st.nodes++;
      if (d === 0 || isTerminal(x)) { st.leaves++; return val(x); }
      const ms = legalMoves(x), max = x.turn === rootTeam;
      let best = max ? -Infinity : Infinity;
      for (const m of ms) {
        const v = mm(applyMove(x, m), d - 1);
        if (max ? v > best : v < best) best = v;
      }
      return best;
    }
    st.nodes++;
    let ms = legalMoves(s);
    if (rand) ms = shuffle(ms.slice(), rand);
    let best = null, bv = -Infinity;
    const scores = [];
    for (const m of ms) {
      const v = mm(applyMove(s, m), depth - 1);
      scores.push({ move: m, value: v });
      if (v > bv) { bv = v; best = m; }
    }
    return { move: best, value: bv, nodes: st.nodes, leaves: st.leaves, timeMs: now() - t0, scores };
  }

  function alphabetaChoose(s, rand, evalFn, depth, ordering) {
    const t0 = now(), rootTeam = s.turn, val = valFor(rootTeam, evalFn);
    const st = { nodes: 0, leaves: 0, cutoffs: 0 };
    function ab(x, d, a, b) {
      st.nodes++;
      if (d === 0 || isTerminal(x)) { st.leaves++; return val(x); }
      let ms = legalMoves(x);
      if (ordering) ms = orderMoves(x, ms);
      if (x.turn === rootTeam) {
        let v = -Infinity;
        for (const m of ms) {
          v = Math.max(v, ab(applyMove(x, m), d - 1, a, b));
          if (v >= b) { st.cutoffs++; return v; }
          a = Math.max(a, v);
        }
        return v;
      } else {
        let v = Infinity;
        for (const m of ms) {
          v = Math.min(v, ab(applyMove(x, m), d - 1, a, b));
          if (v <= a) { st.cutoffs++; return v; }
          b = Math.min(b, v);
        }
        return v;
      }
    }
    st.nodes++;
    let ms = legalMoves(s);
    if (rand) ms = shuffle(ms.slice(), rand);
    if (ordering) ms = orderMoves(s, ms); // stable sort keeps shuffled order among equal keys
    let best = null, bv = -Infinity, alpha = -Infinity;
    const scores = [];
    for (const m of ms) {
      const v = ab(applyMove(s, m), depth - 1, alpha, Infinity);
      scores.push({ move: m, value: v, bound: v <= alpha && alpha > -Infinity }); // ≤ bound when pruned
      if (v > bv) { bv = v; best = m; }
      alpha = Math.max(alpha, v);
    }
    return { move: best, value: bv, nodes: st.nodes, leaves: st.leaves, cutoffs: st.cutoffs, timeMs: now() - t0, scores };
  }

  // ---- MCTS (UCT) with full or depth-limited roll-outs ----
  function mctsChoose(s, rand, evalFn, cfg) {
    rand = rand || Math.random;
    const t0 = now();
    const iters = cfg.iterations || 500, rd = cfg.rolloutDepth || 0, Cp = cfg.C === undefined ? 1.41 : cfg.C;
    const policy = cfg.rolloutPolicy || 'random', scale = cfg.scale || 150;
    const mk = (st, parent, move) => ({ s: st, parent, move, children: [], untried: shuffle(legalMoves(st).slice(), rand), N: 0, W: 0 });
    const rootN = mk(s, null, null);
    let rolloutSteps = 0;
    function rolloutMove(st) {
      const ms = legalMoves(st);
      if (policy === 'smart') {
        // shoot when it scores; never dribble into a tackle if avoidable
        const sh = ms.find(m => m.type === 'shoot' && Math.abs(C(st, gkOf(1 - st.turn)) - C(st, m.id)) >= 2);
        if (sh) return sh;
        if (rand() < 0.7) {
          const safe = ms.filter(m => m.type !== 'dribble' || moveKey(st, m) > -50);
          if (safe.length) return safe[Math.floor(rand() * safe.length)];
        }
      }
      return ms[Math.floor(rand() * ms.length)];
    }
    for (let it = 0; it < iters; it++) {
      let n = rootN;
      // 1. selection
      while (n.untried.length === 0 && n.children.length) {
        let best = null, bu = -Infinity;
        const lnN = Math.log(n.N);
        for (const ch of n.children) {
          const u = ch.W / ch.N + Cp * Math.sqrt(lnN / ch.N);
          if (u > bu) { bu = u; best = ch; }
        }
        n = best;
      }
      // 2. expansion
      if (n.untried.length && !isTerminal(n.s)) {
        const m = n.untried.pop();
        const ch = mk(applyMove(n.s, m), n, m);
        n.children.push(ch); n = ch;
      }
      // 3. simulation
      let x = n.s, k = 0;
      while (!isTerminal(x) && (rd === 0 || k < rd)) { x = applyMove(x, rolloutMove(x)); k++; }
      rolloutSteps += k;
      let rA; // result in [0,1] for team A
      if (isTerminal(x)) rA = x.score[0] > x.score[1] ? 1 : x.score[0] < x.score[1] ? 0 : 0.5;
      else rA = 1 / (1 + Math.exp(-evalFn(x) / scale));
      // 4. backpropagation — W stored from the view of the player who moved INTO the node
      while (n) {
        n.N++;
        if (n.parent) n.W += n.parent.s.turn === A ? rA : 1 - rA;
        n = n.parent;
      }
    }
    let best = null;
    for (const ch of rootN.children) if (!best || ch.N > best.N) best = ch;
    const scores = rootN.children.map(ch => ({ move: ch.move, value: +(ch.W / ch.N).toFixed(3), visits: ch.N }));
    scores.sort((a, b) => b.visits - a.visits);
    return { move: best ? best.move : legalMoves(s)[0], value: best ? best.W / best.N : 0.5, nodes: iters, leaves: iters, rolloutSteps, timeMs: now() - t0, scores, mcts: true };
  }

  // cfg: {kind, depth, heuristic, ordering, iterations, rolloutDepth, rolloutPolicy, C}
  function makeAgent(cfg) {
    const h = HEURISTICS[cfg.heuristic || 'H1'];
    const ev = h.fn;
    let label;
    switch (cfg.kind) {
      case 'random': label = 'Random'; break;
      case 'greedy': label = `Greedy·${h.short}`; break;
      case 'minimax': label = `Minimax d${cfg.depth}·${h.short}`; break;
      case 'alphabeta': label = `αβ d${cfg.depth}·${h.short}${cfg.ordering ? '+ord' : ''}`; break;
      case 'mcts': label = `MCTS ${cfg.iterations}${cfg.rolloutDepth ? ' rd' + cfg.rolloutDepth : ' full'}${cfg.rolloutPolicy === 'smart' ? '·smart' : ''}`; break;
      case 'human': label = 'Human'; break;
    }
    const choose = (s, rand) => {
      switch (cfg.kind) {
        case 'random': return randomChoose(s, rand);
        case 'greedy': return greedyChoose(s, rand, ev);
        case 'minimax': return minimaxChoose(s, rand, ev, cfg.depth || 2);
        case 'alphabeta': return alphabetaChoose(s, rand, ev, cfg.depth || 2, !!cfg.ordering);
        case 'mcts': return mctsChoose(s, rand, ev, cfg);
      }
    };
    return { cfg, label: cfg.label || label, choose, human: cfg.kind === 'human' };
  }

  // Play one full match. agents = [agentForA, agentForB]
  function playMatch(agents, opts = {}) {
    const rand = RF.rng(opts.seed || 1);
    let s = RF.initialState(opts.budget);
    const stats = [{ time: 0, moves: 0, nodes: 0 }, { time: 0, moves: 0, nodes: 0 }];
    let ply = 0;
    while (!isTerminal(s)) {
      let m;
      if (ply < (opts.randomOpening || 0)) { const ms = legalMoves(s); m = ms[Math.floor(rand() * ms.length)]; }
      else {
        const res = agents[s.turn].choose(s, rand);
        stats[s.turn].time += res.timeMs; stats[s.turn].moves++; stats[s.turn].nodes += res.nodes;
        m = res.move;
      }
      s = applyMove(s, m); ply++;
    }
    return { score: s.score, winner: RF.winner(s), stats };
  }

  // ------------------------------------------------------------
  // Generic game-tree tracer (for visualisation / hand-trace trainer)
  // tree node: {id, label, children:[], value (leaves)}
  // ------------------------------------------------------------
  function numberTree(t) {
    let id = 0;
    (function walk(n, d) { n.id = id++; n.depth = d; (n.children || []).forEach(c => walk(c, d + 1)); })(t, 0);
    return id;
  }
  function resetTree(t) {
    (function walk(n) { n.visited = false; n.pruned = false; n.result = undefined; n.a = undefined; n.b = undefined; (n.children || []).forEach(walk); })(t);
  }
  function traceTree(tree, useAB, rootMax) {
    resetTree(tree);
    const events = [];
    let leavesEval = 0;
    function markPruned(n) { n.pruned = true; (n.children || []).forEach(markPruned); }
    function rec(n, isMax, a, b) {
      n.visited = true; n.isMax = isMax;
      events.push({ t: 'enter', id: n.id, a, b, isMax });
      if (!n.children || !n.children.length) {
        leavesEval++;
        n.result = n.value;
        events.push({ t: 'leaf', id: n.id, v: n.value });
        return n.value;
      }
      let v = isMax ? -Infinity : Infinity;
      for (let i = 0; i < n.children.length; i++) {
        const ch = n.children[i];
        const cv = rec(ch, !isMax, a, b);
        if (isMax) { v = Math.max(v, cv); if (useAB) a = Math.max(a, v); }
        else { v = Math.min(v, cv); if (useAB) b = Math.min(b, v); }
        events.push({ t: 'update', id: n.id, v, a, b, child: ch.id, cv, isMax });
        if (useAB && a >= b && i < n.children.length - 1) {
          const rest = n.children.slice(i + 1);
          rest.forEach(markPruned);
          events.push({ t: 'prune', id: n.id, ids: rest.map(r => r.id), v, a, b, isMax });
          break;
        }
      }
      n.result = v;
      events.push({ t: 'exit', id: n.id, v });
      return v;
    }
    const value = rec(tree, rootMax, -Infinity, Infinity);
    let totalLeaves = 0;
    (function walk(n) { if (!n.children || !n.children.length) totalLeaves++; else n.children.forEach(walk); })(tree);
    return { value, events, leavesEval, totalLeaves };
  }

  // Build a capped (top-k per node) game tree from a real position for visualisation.
  function buildGameTree(s, depth, k, evalFn, ordering) {
    const rootTeam = s.turn, val = valFor(rootTeam, evalFn);
    function build(x, d, label, move) {
      const node = { label, move, state: x };
      if (d === 0 || isTerminal(x)) { node.value = Math.round(val(x)); node.children = []; return node; }
      let ms = legalMoves(x);
      if (ordering) ms = orderMoves(x, ms);
      ms = ms.slice(0, k);
      node.children = ms.map(m => build(applyMove(x, m), d - 1, RF.moveToString(x, m), m));
      return node;
    }
    const t = build(s, depth, 'root', null);
    numberTree(t);
    return t;
  }

  // Parse "((4,8),(2,7),(6,1))" into a tree
  function parseTree(str) {
    let i = 0;
    const s = str.replace(/\s+/g, '');
    function node() {
      if (s[i] === '(' || s[i] === '[') {
        i++;
        const ch = [];
        while (s[i] !== ')' && s[i] !== ']') {
          ch.push(node());
          if (s[i] === ',') i++;
          if (i > s.length) throw new Error('unbalanced');
        }
        i++;
        return { children: ch, label: '' };
      }
      const m = /^-?\d+(\.\d+)?/.exec(s.slice(i));
      if (!m) throw new Error('bad token at ' + i);
      i += m[0].length;
      return { value: parseFloat(m[0]), children: [], label: m[0] };
    }
    const t = node();
    numberTree(t);
    return t;
  }
  function randomTree(depth, branch, rand) {
    rand = rand || Math.random;
    function b(d) {
      if (d === 0) { const v = Math.floor(rand() * 21) - 5; return { value: v, children: [], label: String(v) }; }
      const n = 2 + Math.floor(rand() * (branch - 1));
      return { children: Array.from({ length: n }, () => b(d - 1)), label: '' };
    }
    const t = b(depth); numberTree(t); return t;
  }
  function treeToString(n) {
    if (!n.children || !n.children.length) return String(n.value);
    return '(' + n.children.map(treeToString).join(',') + ')';
  }

  const RFAI = {
    HEURISTICS, H1, H2, H3, utility, orderMoves, moveKey, shuffle, makeAgent, playMatch,
    randomChoose, greedyChoose, minimaxChoose, alphabetaChoose, mctsChoose,
    traceTree, buildGameTree, parseTree, randomTree, treeToString, numberTree,
  };
  if (typeof module !== 'undefined') module.exports = RFAI; else root.RFAI = RFAI;
})(typeof window !== 'undefined' ? window : globalThis);
