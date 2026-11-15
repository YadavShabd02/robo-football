// ============================================================
// Robo-Football — Game Environment (Part 1)
// Pure functions, no DOM. Works in browser (window.RF) and Node.
// ============================================================
(function (root) {
  'use strict';
  const ROWS = 6, COLS = 5;
  const A = 0, B = 1;
  const DEFAULT_BUDGET = 80;
  const TEAM_NAME = ['A', 'B'];

  // ---- Kickoff formation (DESIGN DECISION) ----
  // ids 0..4 = Team A (0 = GK), ids 5..9 = Team B (5 = GK)
  // Team A: GK (0,2) | defenders (1,0) (1,4) | midfielder (1,2) | forward (2,1)
  // Team B is the 180° point-mirror: (r,c) -> (5-r, 4-c)
  const FORM_A = [[0, 2], [1, 0], [1, 2], [1, 4], [2, 1]];
  const FORM_B = FORM_A.map(([r, c]) => [ROWS - 1 - r, COLS - 1 - c]);
  const KICKOFF_CARRIER = [4, 9]; // the forward of each team restarts with the ball

  const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  const teamOf = id => (id < 5 ? A : B);
  const isGK = id => id % 5 === 0;
  const gkOf = team => team * 5;
  const goalLine = team => (team === A ? 0 : ROWS - 1);       // row a team defends
  const inAttackThird = (team, r) => (team === A ? r >= ROWS - 2 : r <= 1);
  const forwardRow = (team, r) => (team === A ? r : ROWS - 1 - r); // 0..5 progress toward attack

  function kickoff(ballTeam, score, turnsLeft, budget, turn) {
    const pos = [];
    for (const [r, c] of FORM_A) pos.push(r, c);
    for (const [r, c] of FORM_B) pos.push(r, c);
    budget = budget || DEFAULT_BUDGET;
    return {
      pos,
      carrier: KICKOFF_CARRIER[ballTeam],
      turn: turn === undefined ? ballTeam : turn,
      score: score ? score.slice() : [0, 0],
      turnsLeft: turnsLeft === undefined ? budget : turnsLeft,
      budget,
      event: null,
    };
  }
  const initialState = (budget) => kickoff(A, [0, 0], budget || DEFAULT_BUDGET, budget || DEFAULT_BUDGET, A);

  // Build a custom position. a,b: arrays of 5 [r,c] (index 0 = GK).
  function customState({ a, b, carrier, turn, score, turnsLeft, budget }) {
    const pos = [];
    for (const [r, c] of a) pos.push(r, c);
    for (const [r, c] of b) pos.push(r, c);
    budget = budget || DEFAULT_BUDGET;
    return { pos, carrier, turn, score: score || [0, 0], turnsLeft: turnsLeft === undefined ? budget : turnsLeft, budget, event: null };
  }

  function clone(s) {
    return { pos: s.pos.slice(), carrier: s.carrier, turn: s.turn, score: s.score.slice(), turnsLeft: s.turnsLeft, budget: s.budget, event: null };
  }

  function grid(s) {
    const g = new Array(ROWS * COLS).fill(-1);
    for (let id = 0; id < 10; id++) g[s.pos[2 * id] * COLS + s.pos[2 * id + 1]] = id;
    return g;
  }
  const inB = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const R = (s, id) => s.pos[2 * id], C = (s, id) => s.pos[2 * id + 1];

  // Is the straight line between two cells clear of `blockerTeam` pieces? (null if not a straight line)
  function lineClear(s, g, r0, c0, r1, c1, blockerTeam) {
    const dr = r1 - r0, dc = c1 - c0;
    if (!(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) return null;
    const sr = Math.sign(dr), sc = Math.sign(dc);
    let r = r0 + sr, c = c0 + sc;
    const blockers = [];
    while (r !== r1 || c !== c1) {
      const o = g[r * COLS + c];
      if (o >= 0 && teamOf(o) === blockerTeam) blockers.push(o);
      r += sr; c += sc;
    }
    return blockers.length === 0 ? true : blockers;
  }

  function isTerminal(s) { return s.turnsLeft <= 0; }

  function legalMoves(s) {
    if (isTerminal(s)) return [];
    const team = s.turn, g = grid(s), moves = [];
    if (teamOf(s.carrier) === team) {
      const id = s.carrier, r = R(s, id), c = C(s, id);
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (!inB(nr, nc) || g[nr * COLS + nc] >= 0) continue;
        if (isGK(id) && dr !== 0) continue; // keeper never leaves its goal line
        moves.push({ type: 'dribble', id, r: nr, c: nc });
      }
      for (let t = team * 5; t < team * 5 + 5; t++) {
        if (t === id) continue;
        if (lineClear(s, g, r, c, R(s, t), C(s, t), 1 - team) === true) moves.push({ type: 'pass', id, to: t });
      }
      if (inAttackThird(team, r)) moves.push({ type: 'shoot', id });
    } else {
      for (let id = team * 5; id < team * 5 + 5; id++) {
        const r = R(s, id), c = C(s, id);
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc;
          if (!inB(nr, nc) || g[nr * COLS + nc] >= 0) continue;
          if (isGK(id) && dr !== 0) continue;
          moves.push({ type: 'move', id, r: nr, c: nc });
        }
      }
    }
    if (moves.length === 0) moves.push({ type: 'null' }); // DESIGN: boxed-in team passes its turn
    return moves;
  }

  // Apply a move (assumed legal) -> new state. s.event describes what happened.
  function applyMove(s, m) {
    let n = clone(s);
    const team = s.turn;
    let ev = { kind: m.type, team, move: m };
    if (m.type === 'dribble' || m.type === 'move') {
      ev.from = [R(s, m.id), C(s, m.id)];
      n.pos[2 * m.id] = m.r; n.pos[2 * m.id + 1] = m.c;
      if (m.type === 'dribble') {
        // Tackle check: any opponent adjacent (8-neighbourhood) wins the ball.
        // DESIGN: tie-break = lowest piece id (GK first, then 1..4).
        for (let o = (1 - team) * 5; o < (1 - team) * 5 + 5; o++) {
          if (Math.max(Math.abs(R(n, o) - m.r), Math.abs(C(n, o) - m.c)) <= 1) {
            n.carrier = o; ev = { ...ev, kind: 'tackle', by: o, victim: m.id };
            break;
          }
        }
      }
    } else if (m.type === 'pass') {
      n.carrier = m.to;
      ev.from = [R(s, m.id), C(s, m.id)]; ev.to = [R(s, m.to), C(s, m.to)];
    } else if (m.type === 'shoot') {
      const gk = gkOf(1 - team), r = R(s, m.id), c = C(s, m.id);
      ev.from = [r, c];
      if (Math.abs(C(s, gk) - c) <= 1) {
        n.carrier = gk; ev = { ...ev, kind: 'save', by: gk };
      } else {
        const score = s.score.slice(); score[team]++;
        // reset; conceding team restarts with the ball; turn order keeps alternating
        n = kickoff(1 - team, score, s.turnsLeft, s.budget, s.turn);
        ev = { ...ev, kind: 'goal', scorer: m.id };
      }
    }
    n.turn = 1 - s.turn;
    n.turnsLeft = s.turnsLeft - 1;
    n.event = ev;
    return n;
  }

  function winner(s) {
    if (s.score[0] > s.score[1]) return A;
    if (s.score[1] > s.score[0]) return B;
    return -1;
  }

  // ---- Pretty printing ----
  const pieceChar = id => (teamOf(id) === A ? (isGK(id) ? 'G' : String(id)) : (isGK(id) ? 'g' : 'abcd'[id - 6]));
  function toText(s) {
    const g = grid(s);
    const lines = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      let line = r + ' |';
      for (let c = 0; c < COLS; c++) {
        const id = g[r * COLS + c];
        line += id < 0 ? ' .' : (id === s.carrier ? '*' : ' ') + pieceChar(id);
      }
      lines.push(line);
    }
    lines.push('   ' + ' 0 1 2 3 4'.slice(0));
    lines.push(`turn=${TEAM_NAME[s.turn]} score=${s.score[0]}-${s.score[1]} turnsLeft=${s.turnsLeft} (* = ball)`);
    return lines.join('\n');
  }

  function moveToString(s, m) {
    const nm = id => `${TEAM_NAME[teamOf(id)]}${isGK(id) ? 'gk' : id % 5}`;
    switch (m.type) {
      case 'dribble': return `${nm(m.id)} dribble→(${m.r},${m.c})`;
      case 'move': return `${nm(m.id)} →(${m.r},${m.c})`;
      case 'pass': return `${nm(m.id)} pass→${nm(m.to)}`;
      case 'shoot': return `${nm(m.id)} SHOOT`;
      default: return 'pass turn';
    }
  }
  const pieceName = id => `${TEAM_NAME[teamOf(id)]}${isGK(id) ? '-GK' : '#' + (id % 5)}`;
  const sameMove = (a, b) => a && b && a.type === b.type && a.id === b.id && a.r === b.r && a.c === b.c && a.to === b.to;

  // Seeded RNG (mulberry32) for reproducible experiments
  function rng(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5; let x = t;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  const RF = {
    ROWS, COLS, A, B, DEFAULT_BUDGET, TEAM_NAME, FORM_A, FORM_B, KICKOFF_CARRIER, DIRS,
    teamOf, isGK, gkOf, goalLine, inAttackThird, forwardRow, kickoff, initialState, customState, clone,
    grid, inB, R, C, lineClear, isTerminal, legalMoves, applyMove, winner, toText, moveToString, pieceName,
    sameMove, rng,
  };
  if (typeof module !== 'undefined') module.exports = RF; else root.RF = RF;
})(typeof window !== 'undefined' ? window : globalThis);
