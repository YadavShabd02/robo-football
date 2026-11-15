// ============================================================
// Automated rule checks + preset positions for experiments
// ============================================================
(function (root) {
  'use strict';
  const RF = typeof module !== 'undefined' ? require('./engine.js') : root.RF;
  const RFAI = typeof module !== 'undefined' ? require('./agents.js') : root.RFAI;
  const { legalMoves, applyMove, customState, R, C, isTerminal } = RF;

  // ---- Preset positions (not just kickoff) ----
  const PRESETS = {
    kickoff: { short: 'Kickoff', name: 'Kickoff', desc: 'Start of match, A to move with the ball.', make: () => RF.initialState() },
    midfield: {
      short: 'Midfield', name: 'Midfield build-up', desc: 'A carrier in midfield, defenders scattered — many passing options.',
      make: () => customState({ a: [[0, 1], [1, 0], [2, 2], [3, 4], [2, 0]], b: [[5, 2], [4, 1], [4, 3], [3, 1], [3, 3]], carrier: 2, turn: 0, turnsLeft: 50 }),
    },
    attack: {
      short: 'Attack', name: 'A in the attacking third', desc: 'A carrier at row 4; keeper on col 2 → a shot from col 0 would score. Clear best move → big pruning.',
      make: () => customState({ a: [[0, 2], [2, 1], [3, 3], [2, 4], [4, 0]], b: [[5, 2], [4, 2], [3, 4], [2, 2], [1, 1]], carrier: 4, turn: 0, turnsLeft: 40 }),
    },
    defend: {
      short: 'Defend', name: 'A defending', desc: 'B has the ball near A\'s goal; it is A\'s turn (wide 30+ move level).',
      make: () => customState({ a: [[0, 2], [1, 1], [2, 3], [3, 0], [3, 2]], b: [[5, 1], [4, 4], [3, 3], [1, 4], [2, 1]], carrier: 9, turn: 0, turnsLeft: 30 }),
    },
  };

  const tests = [];
  const T = (name, fn) => tests.push({ name, fn });
  const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
  const has = (ms, pred) => ms.some(pred);

  T('Kickoff: 10 pieces on 10 distinct cells, mirrored formation', () => {
    const s = RF.initialState();
    const set = new Set();
    for (let i = 0; i < 10; i++) set.add(R(s, i) * 5 + C(s, i));
    assert(set.size === 10, 'overlap at kickoff');
    for (let i = 0; i < 5; i++) assert(R(s, i) === 5 - R(s, i + 5) && C(s, i) === 4 - C(s, i + 5), 'not mirrored');
    assert(s.turn === 0 && RF.teamOf(s.carrier) === 0, 'A should kick off with the ball');
  });

  T('Random self-play (300 matches): no overlaps, GK on goal line, strict alternation, budget ends match', () => {
    const rand = RF.rng(7);
    for (let g = 0; g < 300; g++) {
      let s = RF.initialState(), ply = 0;
      while (!isTerminal(s)) {
        const ms = legalMoves(s);
        assert(ms.length > 0, 'no legal moves');
        const prevTurn = s.turn;
        s = applyMove(s, ms[Math.floor(rand() * ms.length)]);
        ply++;
        assert(s.turn === 1 - prevTurn, 'turn did not alternate');
        const set = new Set();
        for (let i = 0; i < 10; i++) {
          assert(RF.inB(R(s, i), C(s, i)), 'off board');
          set.add(R(s, i) * 5 + C(s, i));
        }
        assert(set.size === 10, 'two pieces share a cell');
        assert(R(s, 0) === 0 && R(s, 5) === 5, 'goalkeeper left its goal line');
      }
      assert(ply === RF.DEFAULT_BUDGET, 'match length != budget');
    }
  });

  T('Shoot only offered inside the attacking third', () => {
    const base = { b: [[5, 2], [4, 4], [4, 0], [3, 0], [5, 4]], turn: 0 };
    let s = customState({ ...base, a: [[0, 2], [1, 0], [1, 2], [1, 4], [3, 2]], carrier: 4 });
    assert(!has(legalMoves(s), m => m.type === 'shoot'), 'shot allowed from row 3');
    s = customState({ ...base, a: [[0, 2], [1, 0], [1, 2], [1, 4], [4, 2]], carrier: 4 });
    assert(has(legalMoves(s), m => m.type === 'shoot'), 'shot not allowed from row 4');
    s = customState({ a: [[0, 2], [1, 0], [3, 3], [1, 4], [4, 2]], b: [[5, 2], [4, 4], [2, 1], [3, 0], [1, 1]], carrier: 9, turn: 1 });
    assert(has(legalMoves(s), m => m.type === 'shoot'), 'B should shoot from row 1');
  });

  T('Save: keeper within 1 column saves and gains the ball', () => {
    const s = customState({ a: [[0, 0], [1, 0], [1, 2], [2, 4], [4, 3]], b: [[5, 2], [3, 4], [3, 0], [2, 0], [2, 2]], carrier: 4, turn: 0 });
    const n = applyMove(s, { type: 'shoot', id: 4 });
    assert(n.event.kind === 'save' && n.carrier === 5 && n.score[0] === 0, 'expected save by B keeper');
  });

  T('Goal: keeper 2+ columns away → score, reset to kickoff, conceding team restarts with ball', () => {
    const s = customState({ a: [[0, 0], [1, 0], [1, 2], [2, 4], [4, 4]], b: [[5, 1], [3, 4], [3, 0], [2, 0], [2, 2]], carrier: 4, turn: 0, turnsLeft: 50 });
    const n = applyMove(s, { type: 'shoot', id: 4 });
    assert(n.event.kind === 'goal' && n.score[0] === 1, 'goal not counted');
    assert(n.carrier === RF.KICKOFF_CARRIER[1] && n.turn === 1, 'B must restart with the ball and move next');
    assert(n.turnsLeft === 49, 'turn budget not decremented');
    for (let i = 0; i < 10; i++) assert(R(n, i) === RF.initialState().pos[2 * i], 'not reset to formation');
  });

  T('Shot boundary: keeper 0 or 1 column away → saved; exactly 2 → goal; shooting from the goal line (row 5) is allowed', () => {
    const mk = (gkc, shooterR) => customState({ a: [[0, 0], [1, 0], [1, 2], [2, 4], [shooterR, 2]], b: [[5, gkc], [3, 4], [3, 0], [2, 0], [1, 1]], carrier: 4, turn: 0, turnsLeft: 30 });
    assert(applyMove(mk(2, 4), { type: 'shoot', id: 4 }).event.kind === 'save', 'keeper same column should save');
    assert(applyMove(mk(3, 4), { type: 'shoot', id: 4 }).event.kind === 'save', 'keeper 1 column away should save');
    assert(applyMove(mk(0, 4), { type: 'shoot', id: 4 }).event.kind === 'goal', 'keeper 2 columns away should concede');
    const s5 = customState({ a: [[0, 0], [1, 0], [1, 2], [2, 4], [5, 4]], b: [[5, 1], [3, 4], [3, 0], [2, 0], [1, 1]], carrier: 4, turn: 0 });
    assert(legalMoves(s5).some(m => m.type === 'shoot'), 'shot from row 5 should be legal');
  });

  T('Team B goal → A restarts with the ball and moves next; goal on the last turn ends the match', () => {
    const s = customState({ a: [[0, 4], [3, 1], [3, 3], [4, 4], [2, 2]], b: [[5, 2], [4, 1], [4, 3], [3, 4], [1, 0]], carrier: 9, turn: 1, turnsLeft: 1, score: [2, 2] });
    const n = applyMove(s, { type: 'shoot', id: 9 });
    assert(n.event.kind === 'goal' && n.score[1] === 3, 'B goal not counted');
    assert(n.carrier === RF.KICKOFF_CARRIER[0] && n.turn === 0, 'A must restart with the ball');
    assert(isTerminal(n) && RF.winner(n) === 1 && legalMoves(n).length === 0, 'match should be over with B winning');
  });

  T('Diagonal pass blocked by an opponent on the diagonal; diagonal pass legal when clear', () => {
    const base = { a: [[0, 2], [1, 0], [2, 4], [1, 4], [3, 2]], carrier: 1, turn: 0 };
    const blocked = customState({ ...base, b: [[5, 2], [2, 1], [4, 4], [5, 4], [4, 0]] });
    assert(!legalMoves(blocked).some(m => m.type === 'pass' && m.to === 4), 'pass (1,0)→(3,2) through (2,1) allowed');
    const clear = customState({ ...base, b: [[5, 2], [2, 0], [4, 4], [5, 4], [4, 0]] });
    assert(legalMoves(clear).some(m => m.type === 'pass' && m.to === 4), 'clear diagonal pass missing');
  });

  T('Tackle: dribbling next to an opponent loses the ball; tie-break = lowest id', () => {
    // A carrier at (2,2) dribbles to (3,2); B pieces 7 at (4,1) and 8 at (4,3) both adjacent
    const s = customState({ a: [[0, 2], [1, 0], [2, 2], [1, 4], [0, 4]], b: [[5, 2], [5, 4], [4, 1], [4, 3], [5, 0]], carrier: 2, turn: 0 });
    const n = applyMove(s, { type: 'dribble', id: 2, r: 3, c: 2 });
    assert(n.event.kind === 'tackle' && n.carrier === 7, 'expected tackle by B id 7 (lowest), got ' + n.carrier);
    const safe = applyMove(s, { type: 'dribble', id: 2, r: 2, c: 3 });
    assert(safe.carrier === 2, 'non-adjacent dribble should keep the ball');
  });

  T('Defender walking next to the carrier does NOT steal (tackles only on dribble)', () => {
    const s = customState({ a: [[0, 2], [1, 0], [2, 2], [1, 4], [0, 4]], b: [[5, 2], [5, 4], [4, 1], [4, 3], [5, 0]], carrier: 2, turn: 1 });
    const n = applyMove(s, { type: 'move', id: 7, r: 3, c: 1 });
    assert(n.carrier === 2, 'possession changed on a defensive move');
  });

  T('Pass: blocked by an opponent on the line, NOT blocked by a teammate; only straight lines', () => {
    const s = customState({ a: [[0, 2], [1, 0], [1, 1], [3, 0], [2, 3]], b: [[5, 2], [2, 0], [4, 4], [5, 4], [4, 0]], carrier: 1, turn: 0 });
    const ms = legalMoves(s);
    assert(!has(ms, m => m.type === 'pass' && m.to === 3), 'pass through opponent at (2,0) allowed');
    // (1,0)->(3,2)? not straight to (2,3) -> check knight-like (1,0)->(2,3) illegal
    assert(!has(ms, m => m.type === 'pass' && m.to === 4), 'non-straight pass allowed');
    assert(has(ms, m => m.type === 'pass' && m.to === 2), 'adjacent pass missing');
    const s2 = customState({ a: [[0, 2], [1, 0], [2, 0], [3, 0], [4, 4]], b: [[5, 2], [2, 2], [4, 1], [5, 4], [4, 0]], carrier: 1, turn: 0 });
    assert(has(legalMoves(s2), m => m.type === 'pass' && m.to === 3), 'teammate on the line wrongly blocked pass');
  });

  T('Off-ball turn: only single-player moves; GK moves sideways only; no moves into occupied cells', () => {
    const s = RF.initialState();
    const n = applyMove(s, { type: 'pass', id: 4, to: 2 });
    const ms = legalMoves(n);
    assert(ms.every(m => m.type === 'move'), 'non-move action for defending team');
    const g = RF.grid(n);
    for (const m of ms) {
      assert(g[m.r * 5 + m.c] < 0, 'move into occupied cell');
      if (RF.isGK(m.id)) assert(m.r === 5, 'GK left goal line');
    }
  });

  T('Carrier cannot dribble into an occupied cell; GK carrier dribbles sideways only', () => {
    const s = customState({ a: [[0, 2], [1, 0], [1, 2], [1, 4], [2, 1]], b: [[5, 2], [4, 0], [4, 2], [4, 4], [3, 3]], carrier: 0, turn: 0 });
    for (const m of legalMoves(s)) if (m.type === 'dribble') assert(m.r === 0, 'GK dribbled off its line');
    const g = RF.grid(s);
    for (const m of legalMoves(RF.initialState())) if (m.type === 'dribble') assert(g[m.r * 5 + m.c] < 0, 'dribble into occupied cell');
  });

  T('Alpha-beta returns the SAME value as minimax (40 random positions, depths 1–3, ±ordering)', () => {
    const rand = RF.rng(11);
    for (let k = 0; k < 40; k++) {
      let s = RF.initialState();
      const plies = Math.floor(rand() * 30);
      for (let i = 0; i < plies; i++) { const ms = legalMoves(s); s = applyMove(s, ms[Math.floor(rand() * ms.length)]); }
      for (let d = 1; d <= 3; d++) {
        const h = RFAI.H1;
        const mm = RFAI.minimaxChoose(s, null, h, d);
        const ab = RFAI.alphabetaChoose(s, null, h, d, false);
        const abo = RFAI.alphabetaChoose(s, null, h, d, true);
        assert(mm.value === ab.value && mm.value === abo.value, `value mismatch d${d}: ${mm.value} ${ab.value} ${abo.value}`);
        assert(ab.nodes <= mm.nodes, 'alpha-beta expanded more nodes than minimax');
        if (d === 1) assert(RF.sameMove(mm.move, ab.move), 'depth 1 move differs');
      }
    }
  });

  T('Trainer: textbook tree ((4,8),(2,7),(6,1)) → root 4, prunes exactly 1 leaf', () => {
    const t = RFAI.parseTree('((4,8),(2,7),(6,1))');
    const r = RFAI.traceTree(t, true, true);
    assert(r.value === 4 && r.totalLeaves - r.leavesEval === 1, `got ${r.value}, pruned ${r.totalLeaves - r.leavesEval}`);
    const t2 = RFAI.parseTree('(((3,5),(6,9)),((1,2),(8,4)))');
    const r2 = RFAI.traceTree(t2, true, true);
    assert(r2.value === 5 && r2.totalLeaves - r2.leavesEval === 3, `ex2 got ${r2.value}, pruned ${r2.totalLeaves - r2.leavesEval}`);
  });

  T('Agents only ever return legal moves (all agent types, 4 short matches)', () => {
    const cfgs = [{ kind: 'random' }, { kind: 'greedy', heuristic: 'H2' }, { kind: 'alphabeta', depth: 2, heuristic: 'H3', ordering: true }, { kind: 'mcts', iterations: 60, rolloutDepth: 6 }];
    const rand = RF.rng(3);
    for (const cfg of cfgs) {
      const ag = RFAI.makeAgent(cfg);
      let s = RF.initialState(16);
      while (!isTerminal(s)) {
        const ms = legalMoves(s);
        const mv = s.turn === 0 ? ag.choose(s, rand).move : ms[0];
        assert(ms.some(m => RF.sameMove(m, mv)), cfg.kind + ' returned an illegal move');
        s = applyMove(s, mv);
      }
    }
  });

  function runAll() {
    return tests.map(t => {
      const t0 = Date.now();
      try { t.fn(); return { name: t.name, ok: true, ms: Date.now() - t0 }; }
      catch (e) { return { name: t.name, ok: false, err: e.message, ms: Date.now() - t0 }; }
    });
  }

  const RFT = { PRESETS, tests, runAll };
  if (typeof module !== 'undefined') {
    module.exports = RFT;
    if (require.main === module) {
      const res = runAll();
      for (const r of res) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  -> ' + r.err) + ` (${r.ms}ms)`);
      console.log('\nKickoff board:\n' + RF.toText(RF.initialState()));
      process.exit(res.every(r => r.ok) ? 0 : 1);
    }
  } else root.RFT = RFT;
})(typeof window !== 'undefined' ? window : globalThis);
