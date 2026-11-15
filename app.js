// Main app: Play tab, Search-tree tab, Trainer, Tests, Rules doc
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const { R, C, teamOf, isGK, gkOf, legalMoves, applyMove, isTerminal, pieceName, moveToString, sameMove } = RF;
  const { Board, miniBoard, Sound, confetti } = UIB;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const TEAMS = ['Team A', 'Team B'];
  const store = { get: (k, d) => { try { const v = localStorage.getItem('rf.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem('rf.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } } };
  const signed = v => (v > 0 ? '+' : '') + Math.round(v);

  // ---------------- tabs (with #hash deep links) ----------------
  function showTab(name) {
    if (!$('tab-' + name)) name = 'play';
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
    if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
  }
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

  // ---------------- agent config widgets ----------------
  const KINDS = [['human', '🧑 Human'], ['random', '🎲 Random'], ['greedy', '⚡ Greedy (no search)'], ['minimax', '🌲 Minimax'], ['alphabeta', '✂️ Alpha-Beta'], ['mcts', '🎰 MCTS']];
  function buildCfg(el, team, cfg) {
    el.className = 'agentcfg ' + (team ? 'B' : 'A');
    el.innerHTML = `<div class="title">${team ? '🔴 Team B · attacks downward' : '🔵 Team A · attacks upward'}</div>
      <select data-f="kind">${KINDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <div class="grid2">
        <label data-for="greedy minimax alphabeta mcts">Heuristic<select data-f="heuristic"><option>H1</option><option>H2</option><option>H3</option></select></label>
        <label data-for="minimax alphabeta">Depth<input type="number" data-f="depth" min="1" max="6" value="3"></label>
        <label data-for="alphabeta" class="inline" style="margin-top:20px"><input type="checkbox" data-f="ordering" checked> ordering</label>
        <label data-for="mcts">Iterations<input type="number" data-f="iterations" min="10" max="20000" value="600"></label>
        <label data-for="mcts">Roll-out depth<input type="number" data-f="rolloutDepth" min="0" max="80" value="8" title="0 = play to the end of the match"></label>
        <label data-for="mcts">Policy<select data-f="rolloutPolicy"><option value="random">random</option><option value="smart">smart</option></select></label>
      </div>`;
    const vis = () => { const k = el.querySelector('[data-f=kind]').value; el.querySelectorAll('[data-for]').forEach(l => l.style.display = l.dataset.for.split(' ').includes(k) ? '' : 'none'); };
    const set = c => {
      for (const k in c) { const i = el.querySelector(`[data-f=${k}]`); if (!i) continue; if (i.type === 'checkbox') i.checked = !!c[k]; else i.value = c[k]; }
      vis();
    };
    el.querySelectorAll('input,select').forEach(i => i.addEventListener('change', () => { vis(); $('preset').value = 'custom'; }));
    set(cfg);
    el.read = () => {
      const c = {};
      el.querySelectorAll('[data-f]').forEach(i => c[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value);
      return c;
    };
    el.set = set;
  }
  const PRESETS = {
    hvEasy: [{ kind: 'human' }, { kind: 'random' }],
    hvMed: [{ kind: 'human' }, { kind: 'greedy', heuristic: 'H3' }],
    hvHard: [{ kind: 'human' }, { kind: 'alphabeta', depth: 3, heuristic: 'H3', ordering: true }],
    hvLegend: [{ kind: 'human' }, { kind: 'alphabeta', depth: 4, heuristic: 'H3', ordering: true }],
    hvMcts: [{ kind: 'human' }, { kind: 'mcts', iterations: 600, rolloutDepth: 8, rolloutPolicy: 'smart', heuristic: 'H3' }],
    greedyvab: [{ kind: 'greedy', heuristic: 'H3' }, { kind: 'alphabeta', depth: 3, heuristic: 'H3', ordering: true }],
    aivai: [{ kind: 'alphabeta', depth: 3, heuristic: 'H3', ordering: true }, { kind: 'alphabeta', depth: 3, heuristic: 'H1', ordering: true }],
    mctsvab: [{ kind: 'mcts', iterations: 500, rolloutDepth: 8, rolloutPolicy: 'smart', heuristic: 'H3' }, { kind: 'alphabeta', depth: 3, heuristic: 'H3', ordering: true }],
    hvh: [{ kind: 'human' }, { kind: 'human' }],
  };
  const startPreset = store.get('preset', 'hvMed');
  $('preset').value = PRESETS[startPreset] ? startPreset : 'hvMed';
  buildCfg($('cfgA'), 0, PRESETS[$('preset').value][0]);
  buildCfg($('cfgB'), 1, PRESETS[$('preset').value][1]);
  $('preset').onchange = () => {
    const p = PRESETS[$('preset').value];
    if (p) { $('cfgA').set(p[0]); $('cfgB').set(p[1]); store.set('preset', $('preset').value); newMatch(); }
    else $('customize').open = true;
  };
  $('applyCustom').onclick = () => { $('preset').value = 'custom'; newMatch(); };

  // ---------------- help ----------------
  function showHelp() {
    $('modalCard').className = 'modal-card help';
    $('modalCard').innerHTML = `<h2>⚽ How to play</h2>
      <p class="mute" style="text-align:center;margin-top:-4px">A 6×5 pitch, 5 robots a side, one brain per team. Turns strictly alternate.</p>
      <div class="help-steps">
        <div><span>🎯</span><span>You are <b style="color:var(--A)">🔵 Team A</b> and attack <b>upward</b>. Score more goals than the bot before the turns run out (80 turns, 40 each). After a goal everyone resets and the team that conceded gets the ball.</span></div>
        <div><span>⚽</span><span><b>Your ball:</b> only the carrier (gold ring) acts. Click a <b>⚪ dot</b> to dribble one step. A <b style="color:var(--red)">🔴 dot</b> means you'd end up next to an opponent, who steals the ball. Click a <b style="color:var(--green)">glowing teammate</b> to pass along a straight line that no opponent stands on.</span></div>
        <div><span>🥅</span><span><b>Shooting</b> is allowed from the top two rows. The keeper saves anything within 1 column of itself (the <b>striped</b> part of the goal), so shoot when it is 2+ columns away.</span></div>
        <div><span>🛡️</span><span><b>No ball:</b> move <b>one</b> of your players one step: click the player, then a ⚪ dot. The keeper only slides sideways. You can't steal by walking up to the carrier. The ball changes hands only when the carrier dribbles next to you.</span></div>
        <div><span>💡</span><span><b>Pro tip:</b> the keeper moves only one column per turn. Get the ball to the far side of the goal and shoot before it can get across. Stuck? Press <b>💡 Hint</b> to see what α-β would do.</span></div>
      </div>
      <p style="text-align:center"><button class="primary" id="helpGo">Let's play!</button></p>`;
    $('modal').classList.remove('hidden');
    $('helpGo').onclick = () => { $('modal').classList.add('hidden'); store.set('seenHelp', true); };
  }
  $('helpBtn').onclick = showHelp;
  $('modal').addEventListener('click', e => { if (e.target === $('modal')) $('modal').classList.add('hidden'); });

  // ---------------- game controller ----------------
  const G = { hist: [], view: 0, agents: [], playing: false, busy: false, rand: RF.rng(Date.now() & 0xffff), selected: null, cands: null, lastInfo: null, token: 0, hint: null };
  const cur = () => G.hist[G.hist.length - 1].s;
  const atLive = () => G.view === G.hist.length - 1;
  const anyHuman = () => G.agents.some(a => a.human);
  const allHuman = () => G.agents.every(a => a.human);
  const delay = () => 1500 - +$('speed').value;

  function newMatch() {
    G.token++;
    G.agents = [RFAI.makeAgent($('cfgA').read()), RFAI.makeAgent($('cfgB').read())];
    G.hist = [{ s: RF.initialState(+$('budget').value || 80) }];
    G.view = 0; G.playing = false; G.busy = false; G.selected = null; G.cands = null; G.lastInfo = null; G.hint = null;
    $('labelA').textContent = G.agents[0].human ? 'Human' : G.agents[0].label;
    $('labelB').textContent = G.agents[1].human ? 'Human' : G.agents[1].label;
    $('nameA').textContent = G.agents[0].human ? (G.agents[1].human ? 'Player A' : 'You') : 'Robo A';
    $('nameB').textContent = G.agents[1].human ? (G.agents[0].human ? 'Player B' : 'You') : 'Robo B';
    $('playBtn').textContent = '▶ Play';
    $('aiControls').classList.toggle('hidden', anyHuman());
    $('speedWrap').classList.toggle('hidden', anyHuman());
    $('hintBtn').classList.toggle('hidden', !anyHuman());
    document.querySelector('.actionbar').classList.toggle('hidden', !anyHuman());
    $('presetDesc').innerHTML = describeMatch();
    $('brainSummary').innerHTML = 'The AI explains its last move here: how far it looked ahead, how many positions it checked, and why it chose that move.';
    $('thinkStats').innerHTML = ''; $('thinkTable').innerHTML = '';
    $('brainPip').classList.add('hidden');
    $('modal').classList.add('hidden');
    Sound.whistle();
    render();
    maybeAuto();
  }
  function describeAgent(a) {
    const c = a.cfg, h = c.heuristic ? ` using heuristic ${c.heuristic}` : '';
    switch (c.kind) {
      case 'human': return 'you';
      case 'random': return 'a bot that plays random legal moves';
      case 'greedy': return `a bot that picks the best-looking move right now${h}, with no look-ahead`;
      case 'minimax': return `a bot that looks ${c.depth} moves ahead with plain minimax${h}`;
      case 'alphabeta': return `a bot that looks ${c.depth} moves ahead with α-β pruning${h}`;
      case 'mcts': return `a bot that simulates ${c.iterations} quick games per move (MCTS)`;
    }
  }
  function describeMatch() {
    const [a, b] = G.agents;
    if (a.human && b.human) return 'Two players share this screen and take turns.';
    if (a.human) return `You (🔵 A) vs ${describeAgent(b)}.`;
    if (b.human) return `${describeAgent(a)} (🔵 A) vs you (🔴 B).`;
    return `🔵 ${describeAgent(a)}<br>vs 🔴 ${describeAgent(b)}.`;
  }
  function maybeAuto() {
    const s = cur();
    if (isTerminal(s) || G.busy || !atLive()) return;
    if (!G.agents[s.turn].human && (G.playing || anyHuman())) {
      const tok = G.token;
      setTimeout(() => { if (tok === G.token && (G.playing || anyHuman())) aiMove(); }, anyHuman() ? 300 : delay());
    }
  }
  async function aiMove() {
    const s = cur();
    if (isTerminal(s) || G.busy || G.agents[s.turn].human || !atLive()) return;
    G.busy = true; G.phase = 'think'; const tok = G.token;
    render();
    await sleep(30);
    const ag = G.agents[s.turn];
    const res = ag.choose(s, G.rand);
    if (tok !== G.token) return;
    G.lastInfo = { res, team: s.turn, label: ag.label, cfg: ag.cfg, state: s };
    showThinking();
    const preview = anyHuman() ? 550 : Math.min(700, delay() * 0.6);
    if ($('ovCands').checked && res.scores && res.scores.length > 1 && preview > 120) {
      G.cands = topMoves(res).slice(0, 3).map(x => x.move);
      render();
      await sleep(preview);
      if (tok !== G.token) return;
    }
    G.cands = null; G.phase = 'commit';
    await commit(res.move);
    if (tok !== G.token) return;
    G.busy = false;
    render();
    maybeAuto();
  }
  function topMoves(res) {
    const sc = res.scores.slice();
    if (res.mcts) sc.sort((a, b) => b.visits - a.visits); else sc.sort((a, b) => b.value - a.value);
    return sc;
  }
  async function commit(move) {
    const s = cur(), ns = applyMove(s, move), ev = ns.event, tok = G.token;
    G.selected = null; G.hint = null; $('hintText').textContent = '';
    if (ev.kind === 'goal' || ev.kind === 'save') {
      Sound.kick();
      Board.shootBall(R(s, move.id), C(s, move.id), s.turn);
      await sleep(450);
      if (tok !== G.token) return;
    }
    if (ev.kind === 'goal') {
      const b = $('banner'); b.textContent = 'GOAL!'; b.style.color = s.turn ? 'var(--B)' : 'var(--A)';
      b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
      Sound.goal(); confetti(s.turn ? ['#fb7185', '#fecdd3', '#fbbf24'] : ['#22d3ee', '#a5f3fc', '#fbbf24']);
      await sleep(900);
      if (tok !== G.token) return;
    }
    G.hist.push({ s: ns, move, prev: s });
    G.view = G.hist.length - 1;
    render();
    if (ev.kind === 'tackle') { Board.popup(R(ns, ev.by), C(ns, ev.by), 'TACKLE! 🛡️', '#f87171'); Board.flash(ev.by); Sound.tackle(); }
    else if (ev.kind === 'save') { Board.popup(R(ns, ev.by), C(ns, ev.by), 'SAVED! 🧤', '#fbbf24'); Board.flash(ev.by); Sound.save(); }
    else if (ev.kind === 'pass') Sound.pass();
    else if (ev.kind === 'dribble' || ev.kind === 'move') Sound.kick();
    if (isTerminal(ns)) endMatch(ns);
  }
  function endMatch(s) {
    G.playing = false; $('playBtn').textContent = '▶ Play';
    Sound.whistle();
    const w = RF.winner(s), st = computeStats();
    let who;
    if (w < 0) who = 'Draw 🤝';
    else if (anyHuman() && !allHuman()) who = G.agents[w].human ? 'You win! 🏆' : 'The robot wins 🤖';
    else who = TEAMS[w] + ' wins! 🏆';
    if (w >= 0) confetti(w ? ['#fb7185', '#fbbf24'] : ['#22d3ee', '#fbbf24']);
    const tip = w < 0 && anyHuman() ? '<p class="mute">Draws are common in robo-football: the ball only changes hands when the carrier dribbles next to a defender, so careful teams rarely lose it. Try switching play to the far wing!</p>' : '';
    setTimeout(() => {
      if (!isTerminal(cur())) return; // undone meanwhile
      $('modalCard').className = 'modal-card';
      $('modalCard').innerHTML = `<h2>${who}</h2><div class="score" style="font-size:48px"><span style="color:var(--A)">${s.score[0]}</span><span class="sep">:</span><span style="color:var(--B)">${s.score[1]}</span></div>
        <p class="mute">${G.agents[0].label} vs ${G.agents[1].label}</p>${tip}
        <table class="mini">${statRows(st)}</table><br>
        <button class="primary" id="rematch">🔄 Rematch</button> <button id="closeModal">Review the match</button>`;
      $('modal').classList.remove('hidden');
      $('rematch').onclick = newMatch;
      $('closeModal').onclick = () => { $('modal').classList.add('hidden'); selectSub('stats'); };
    }, 800);
  }

  // ---------------- human input ----------------
  function humanCtx() {
    const s = cur();
    if (!atLive() || G.busy || isTerminal(s) || !G.agents[s.turn].human) return null;
    const ms = legalMoves(s), team = s.turn, own = teamOf(s.carrier) === team;
    const ctx = { s, ms, team, own, targets: new Set(), risky: new Set(), passTargets: new Set(), selectable: new Set(), shootable: null, wouldScore: false };
    if (own) {
      for (const m of ms) {
        if (m.type === 'dribble') {
          ctx.targets.add(m.r * 5 + m.c);
          for (let o = (1 - team) * 5; o < (1 - team) * 5 + 5; o++) if (Math.max(Math.abs(R(s, o) - m.r), Math.abs(C(s, o) - m.c)) <= 1) ctx.risky.add(m.r * 5 + m.c);
        }
        if (m.type === 'pass') ctx.passTargets.add(m.to);
        if (m.type === 'shoot') { ctx.shootable = team; ctx.wouldScore = Math.abs(C(s, gkOf(1 - team)) - C(s, s.carrier)) >= 2; }
      }
    } else {
      for (const m of ms) if (m.type === 'move') ctx.selectable.add(m.id);
      if (G.selected !== null) for (const m of ms) if (m.type === 'move' && m.id === G.selected) ctx.targets.add(m.r * 5 + m.c);
    }
    ctx.nullOnly = ms.length === 1 && ms[0].type === 'null';
    return ctx;
  }
  function onCell(r, c) {
    const h = humanCtx(); if (!h) return;
    const k = r * 5 + c;
    if (!h.targets.has(k)) { if (G.selected !== null) { G.selected = null; render(); } return; }
    const m = h.ms.find(m => (m.type === 'dribble' || (m.type === 'move' && m.id === G.selected)) && m.r === r && m.c === c);
    if (m) humanPlay(m);
  }
  function onPiece(id) {
    const h = humanCtx(); if (!h) return;
    if (h.own && h.passTargets.has(id)) return humanPlay(h.ms.find(m => m.type === 'pass' && m.to === id));
    if (!h.own && h.selectable.has(id)) { G.selected = G.selected === id ? null : id; render(); return; }
    onCell(R(h.s, id), C(h.s, id));
  }
  function onGoal(team) { const h = humanCtx(); if (h && h.shootable === team) humanPlay(h.ms.find(m => m.type === 'shoot')); }
  async function humanPlay(m) {
    if (G.busy) return;
    G.busy = true;
    const tok = G.token;
    await commit(m);
    if (tok !== G.token) return;
    G.busy = false;
    render(); maybeAuto();
  }
  $('shootBtn').onclick = () => { const h = humanCtx(); if (h && h.shootable !== null) humanPlay(h.ms.find(m => m.type === 'shoot')); };
  $('nullBtn').onclick = () => { const h = humanCtx(); if (h && h.nullOnly) humanPlay(h.ms[0]); };

  // ---------------- buttons ----------------
  $('newMatch').onclick = newMatch;
  $('playBtn').onclick = () => {
    if (anyHuman()) return;
    if (isTerminal(cur())) return newMatch();
    G.playing = !G.playing; $('playBtn').textContent = G.playing ? '⏸ Pause' : '▶ Play';
    if (G.playing) { G.view = G.hist.length - 1; render(); maybeAuto(); }
    else if (G.busy && G.phase === 'think') { G.token++; G.busy = false; G.cands = null; render(); } // cancel a move still being previewed
  };
  $('stepBtn').onclick = () => { if (!G.busy && atLive() && !G.agents[cur().turn].human) aiMove(); };
  $('undoBtn').onclick = () => {
    if (G.hist.length < 2) return;
    G.token++; G.playing = false; G.busy = false; $('playBtn').textContent = '▶ Play';
    do { G.hist.pop(); } while (G.hist.length > 1 && anyHuman() && !G.agents[cur().turn].human);
    G.view = G.hist.length - 1; G.selected = null; G.cands = null; G.hint = null; $('hintText').textContent = '';
    $('modal').classList.add('hidden');
    render(); maybeAuto();
  };
  $('hintBtn').onclick = () => {
    const h = humanCtx(); if (!h) return;
    const s = h.s, res = RFAI.alphabetaChoose(s, null, RFAI.H3, 3, true);
    G.hint = res.move;
    const m = res.move, fwd = (a, b) => RF.forwardRow(s.turn, b) - RF.forwardRow(s.turn, a);
    let why;
    if (m.type === 'shoot') why = Math.abs(C(s, gkOf(1 - s.turn)) - C(s, m.id)) >= 2 ? 'the keeper is 2+ columns away, so the shot scores' : 'every other move loses the ball anyway, and a saved shot at least lands deep in their half';
    else if (m.type === 'pass') { const f = fwd(R(s, m.id), R(s, m.to)); why = f > 0 ? 'it moves the ball forward in one go, faster than any dribble' : f < 0 ? 'the way forward is blocked, so it recycles the ball to a teammate with safer options' : 'it switches play across the pitch'; }
    else if (m.type === 'dribble') { const risky = [0, 1, 2, 3, 4].some(k => { const o = (1 - s.turn) * 5 + k; return Math.max(Math.abs(R(s, o) - m.r), Math.abs(C(s, o) - m.c)) <= 1; }); why = risky ? 'it gives the ball away on purpose where the opponent would be boxed in, so you win it straight back (a pressing trap)' : fwd(R(s, m.id), m.r) > 0 ? 'it gains ground without stepping next to a defender' : 'it keeps the ball safe and opens new angles'; }
    else if (m.type === 'move') why = isGK(m.id) ? 'it keeps the keeper level with the ball, so a shot would be saved' : 'it takes away space or a passing lane from the ball carrier';
    else why = 'there is no other legal move';
    $('hintText').innerHTML = `💡 α-β (3 moves ahead, H3) suggests <b>${moveToString(s, res.move)}</b>: ${why}.`;
    G.lastInfo = { res, team: s.turn, label: 'Hint: α-β d3·H3', cfg: { kind: 'alphabeta', depth: 3 }, state: s }; showThinking();
    render();
  };
  $('scrub').oninput = e => {
    G.view = +e.target.value;
    if (!atLive()) { G.playing = false; $('playBtn').textContent = '▶ Play'; }
    render(); if (atLive()) maybeAuto();
  };
  $('liveBtn').onclick = () => { G.view = G.hist.length - 1; render(); maybeAuto(); };
  ['ovThird', 'ovKeeper', 'ovLanes', 'ovDanger', 'ovCands'].forEach(id => $(id).onchange = () => render());
  Sound.on = store.get('sound', true); $('sound').checked = Sound.on;
  $('sound').onchange = () => { Sound.on = $('sound').checked; store.set('sound', Sound.on); };
  document.addEventListener('keydown', e => {
    if (!$('tab-play').classList.contains('active') || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (!$('modal').classList.contains('hidden')) { if (e.key === 'Escape') $('modal').classList.add('hidden'); return; }
    if (e.key === ' ') { e.preventDefault(); $('playBtn').click(); }
    else if (e.key === 'n') $('stepBtn').click(); else if (e.key === 'u') $('undoBtn').click(); else if (e.key === 'h') $('hintBtn').click();
    else if (e.key === 'Escape' && G.selected !== null) { G.selected = null; render(); }
  });

  // sub-tabs on the right panel
  function selectSub(name) {
    document.querySelectorAll('.subtabs button').forEach(b => b.classList.toggle('active', b.dataset.sub === name));
    document.querySelectorAll('.sub').forEach(x => x.classList.toggle('active', x.id === 'sub-' + name));
    if (name === 'brain') $('brainPip').classList.add('hidden');
    store.set('sub', name);
  }
  document.querySelectorAll('.subtabs button').forEach(b => b.onclick = () => selectSub(b.dataset.sub));
  selectSub(store.get('sub', 'comm'));

  // ---------------- render ----------------
  function render() {
    const entry = G.hist[G.view], s = entry.s, live = atLive();
    const h = live ? humanCtx() : null;
    Board.render(s, {
      ovThird: $('ovThird').checked, ovKeeper: $('ovKeeper').checked, ovLanes: $('ovLanes').checked, ovDanger: $('ovDanger').checked,
      targets: h && h.targets, risky: h && h.risky, passTargets: h && h.passTargets, selectable: h && h.selectable, selected: G.selected, shootable: h ? h.shootable : null,
      cands: live && $('ovCands').checked ? G.cands : null, hint: live ? G.hint : null,
      lastEv: entry.s.event, lastPrev: entry.prev && entry.s.event.kind !== 'goal' ? entry.prev : null,
    });
    $('scoreA').textContent = s.score[0]; $('scoreB').textContent = s.score[1];
    $('clock').textContent = isTerminal(s) ? 'full time' : `${s.turnsLeft} turns left`;
    // turn bar: WHAT to do (short)
    const tb = $('turnbar'), team = s.turn, hasBall = teamOf(s.carrier) === team, who = allHuman() ? TEAMS[team] + ': ' : '';
    tb.className = 'turnbar ' + (team ? 'B' : 'A') + (h ? ' yours' : '');
    if (isTerminal(s)) tb.textContent = '🏁 Full time';
    else if (!live) tb.textContent = `⏪ Replay: ply ${G.view} of ${G.hist.length - 1}`;
    else if (G.agents[team].human) tb.textContent = hasBall ? `${who}⚽ Your ball: dribble, pass${h && h.shootable !== null ? ' or SHOOT' : ''}` : `${who}🛡️ Defend: move one of your players`;
    else tb.textContent = G.busy ? `🤖 ${G.agents[team].label} is thinking…` : `${TEAMS[team]} (${G.agents[team].label}) to move${!G.playing && !anyHuman() ? ': press ▶ Play or ⏭ Step' : ''}`;
    // legend: what the symbols MEAN (context-sensitive)
    const L = [];
    const dot = c => `<i style="background:${c}"></i>`;
    if (h && h.own) {
      L.push(`<span>${dot('#fff')}dribble</span>`, `<span>${dot('var(--red)')}dribble into a tackle</span>`, `<span>${dot('var(--green)')}click teammate to pass</span>`);
      if (h.shootable !== null) L.push(h.wouldScore ? `<span style="color:var(--gold)">🥅 keeper is 2+ columns away: a shot SCORES</span>` : `<span>🧤 keeper covers you: a shot would be saved</span>`);
      else L.push(`<span>🥅 shooting unlocks in the top 2 rows</span>`);
    } else if (h) {
      L.push(G.selected === null ? `<span>① click one of your outlined players</span>` : `<span>② click a ${dot('#fff')}cell (Esc to cancel)</span>`, `<span>🧤 keeper slides sideways only</span>`);
    } else if (!isTerminal(s)) {
      L.push(`<span style="color:var(--gold)">➜ gold arrow: last move</span>`);
      if ($('ovCands').checked) L.push(`<span>➜ white arrows: AI's top candidates</span>`);
    }
    $('legend').innerHTML = L.join('');
    $('shootBtn').disabled = !(h && h.shootable !== null);
    $('shootBtn').textContent = h && h.shootable !== null ? (h.wouldScore ? '🥅 SHOOT: open goal!' : '🥅 SHOOT (will be saved)') : '🥅 SHOOT';
    $('nullBtn').classList.toggle('hidden', !(h && h.nullOnly));
    $('stepBtn').disabled = G.busy || !live || isTerminal(s) || G.agents[s.turn].human;
    $('hintBtn').disabled = !h;
    $('undoBtn').disabled = G.hist.length < 2;
    $('scrub').max = G.hist.length - 1; $('scrub').value = G.view; $('scrubLabel').textContent = `ply ${G.view}/${G.hist.length - 1}`;
    $('liveBtn').classList.toggle('hidden', live);
    // evaluation bar (H3, A's view)
    const v = RFAI.H3(s), share = 1 / (1 + Math.exp(-v / 250));
    $('evalVFill').style.height = (100 * share).toFixed(1) + '%';
    $('evalVNum').textContent = signed(v);
    drawEvalGraph();
    $('matchStats').innerHTML = statRows(computeStats(G.view));
    drawCommentary();
  }
  function computeStats(upto) {
    const st = [0, 1].map(() => ({ passes: 0, dribbles: 0, tackles: 0, shots: 0, saves: 0, goals: 0, poss: 0 }));
    const end = upto === undefined ? G.hist.length - 1 : upto;
    for (let i = 1; i <= end; i++) {
      const e = G.hist[i].s.event, p = G.hist[i].prev;
      st[teamOf(p.carrier)].poss++;
      if (e.kind === 'pass') st[e.team].passes++;
      if (e.kind === 'dribble') st[e.team].dribbles++;
      if (e.kind === 'tackle') { st[e.team].dribbles++; st[1 - e.team].tackles++; }
      if (e.kind === 'goal') { st[e.team].shots++; st[e.team].goals++; }
      if (e.kind === 'save') { st[e.team].shots++; st[1 - e.team].saves++; }
    }
    return st;
  }
  function statRows(st) {
    const tot = st[0].poss + st[1].poss || 1;
    const row = (n, a, b) => `<tr><td>${n}</td><td style="color:var(--A)">${a}</td><td style="color:var(--B)">${b}</td></tr>`;
    return `<tr><th></th><th>A</th><th>B</th></tr>` + row('Possession', Math.round(100 * st[0].poss / tot) + '%', Math.round(100 * st[1].poss / tot) + '%') +
      [['goals', 'Goals'], ['shots', 'Shots'], ['saves', 'Saves'], ['passes', 'Passes'], ['dribbles', 'Dribbles'], ['tackles', 'Tackles won']].map(([k, n]) => row(n, st[0][k], st[1][k])).join('');
  }
  function drawEvalGraph() {
    const n = G.hist.length, W = 300, H = 90;
    const X = i => (n <= 1 ? 0 : (i / (n - 1)) * W);
    const pts = G.hist.map((h, i) => `${X(i)},${H / 2 - Math.max(-600, Math.min(600, RFAI.H3(h.s))) / 600 * (H / 2 - 4)}`).join(' ');
    let svg = `<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#334"/><text x="3" y="10" font-size="8" fill="#22d3ee">A better</text><text x="3" y="${H - 3}" font-size="8" fill="#fb7185">B better</text>`;
    G.hist.forEach((h, i) => { if (h.s.event && h.s.event.kind === 'goal') svg += `<line x1="${X(i)}" x2="${X(i)}" y1="0" y2="${H}" stroke="${h.s.event.team ? '#fb7185' : '#22d3ee'}" stroke-width="2"/>`; });
    svg += `<polyline fill="none" stroke="#fbbf24" stroke-width="1.8" points="${pts}"/><line x1="${X(G.view)}" x2="${X(G.view)}" y1="0" y2="${H}" stroke="#fff" stroke-dasharray="2 3" opacity=".6"/>`;
    $('evalGraph').innerHTML = svg;
  }
  function commentFor(h) {
    const e = h.s.event, p = h.prev, t = e.team ? 'B' : 'A', nm = id => pieceName(id);
    switch (e.kind) {
      case 'pass': {
        const fwd = RF.forwardRow(e.team, R(p, e.move.to)) - RF.forwardRow(e.team, R(p, e.move.id));
        const diag = R(p, e.move.to) !== R(p, e.move.id) && C(p, e.move.to) !== C(p, e.move.id);
        return [t, `${nm(e.move.id)} ${fwd > 0 ? 'plays a forward pass' : fwd < 0 ? 'plays it back' : 'switches play across'} to ${nm(e.move.to)}${diag ? ' on the diagonal' : ''}`];
      }
      case 'dribble': return [t, `${nm(e.move.id)} carries the ball to (${e.move.r},${e.move.c})`];
      case 'tackle': return [t, `🛡️ ${nm(e.victim)} dribbles next to ${nm(e.by)}. Tackled, ball lost!`, true];
      case 'save': return [t, `🧤 ${nm(e.move.id)} shoots, but ${nm(e.by)} is within one column: SAVED!`, true];
      case 'goal': return [t, `⚽ GOAL! ${nm(e.scorer)} finds the far corner. ${h.s.score[0]}–${h.s.score[1]}`, true];
      case 'move': return [t, `${nm(e.move.id)} ${isGK(e.move.id) ? 'slides along the goal line' : 'steps'} to (${e.move.r},${e.move.c})`];
      default: return [t, `${TEAMS[e.team]} is boxed in and passes the turn`];
    }
  }
  function drawCommentary() {
    const out = [];
    for (let i = G.view; i >= Math.max(1, G.view - 60); i--) {
      const [t, txt, big] = commentFor(G.hist[i]);
      out.push(`<div class="${t}${big ? ' big' : ''}"><small class="mute">${i}.</small> ${txt}</div>`);
    }
    $('commentary').innerHTML = out.join('') || `<div class="mute">Kick-off! Team A starts with the ball (A#4 at (2,1)). ${G.agents[0] && G.agents[0].human ? 'Your move: try a pass or a safe dribble.' : ''}</div>`;
  }
  function showThinking() {
    const L = G.lastInfo; if (!L) return;
    const r = L.res, cfg = L.cfg || {}, team = TEAMS[L.team], mv = moveToString(L.state, r.move);
    let text;
    if (cfg.kind === 'random') text = `🎲 <b>${L.label}</b> picked one of its ${legalMoves(L.state).length} legal moves at random: <b>${mv}</b>. No thinking at all. It's the baseline every other agent must beat.`;
    else if (cfg.kind === 'greedy') text = `⚡ <b>${L.label}</b> tried each of its <b>${r.scores.length}</b> moves once, scored the resulting position with its heuristic and took the best: <b>${mv}</b> (${signed(r.value)}). It never asks <i>"what will the opponent do next?"</i>, which is why it can be lured into bad positions.`;
    else if (cfg.kind === 'minimax' || cfg.kind === 'alphabeta') text = `🌲 <b>${L.label}</b> looked <b>${cfg.depth} move${cfg.depth > 1 ? 's' : ''} ahead</b> (its moves and the opponent's best replies, alternating) and examined <b>${r.nodes.toLocaleString()}</b> positions${cfg.kind === 'alphabeta' ? `, cutting off ${r.cutoffs.toLocaleString()} branches that could not change the decision` : ''}. It chose <b>${mv}</b>. Value <b>${signed(r.value)}</b> = how good the position is for ${team} if both sides play their best (positive = good for ${team}).`;
    else if (cfg.kind === 'mcts') { const top = topMoves(r)[0]; text = `🎰 <b>${L.label}</b> played <b>${r.nodes.toLocaleString()}</b> quick simulated games from here (${cfg.rolloutDepth ? cfg.rolloutDepth + ' moves each, then scored by H3' : 'each to the final whistle'}), steering more simulations to promising moves with UCB1. It chose the most-visited move <b>${mv}</b>: tried ${top ? top.visits : '?'}×, winning ${top ? Math.round(top.value * 100) : '?'}% for ${team}.`; }
    else text = '';
    $('brainSummary').innerHTML = text;
    if (!document.querySelector('[data-sub=brain]').classList.contains('active')) $('brainPip').classList.remove('hidden');
    $('thinkStats').innerHTML = cfg.kind === 'random' ? '' : `<div><b>${r.nodes.toLocaleString()}</b><small>${r.mcts ? 'simulations' : 'positions'}</small></div>
      <div><b>${r.timeMs.toFixed(1)}</b><small>ms</small></div>
      ${r.cutoffs !== undefined ? `<div><b>${r.cutoffs.toLocaleString()}</b><small>α-β cut-offs</small></div>` : r.mcts ? `<div><b>${(r.rolloutSteps || 0).toLocaleString()}</b><small>simulated moves</small></div>` : `<div><b>${r.leaves.toLocaleString()}</b><small>leaves</small></div>`}`;
    if (!r.scores || !r.scores.length) { $('thinkTable').innerHTML = ''; return; }
    const top = topMoves(r).slice(0, 8);
    const vals = top.map(x => r.mcts ? x.visits : x.value), mx = Math.max(...vals), mn = Math.min(...vals);
    $('thinkTable').innerHTML = `<h3>Top moves it considered</h3><table><tr><th>Move</th><th class="num">${r.mcts ? 'visits' : 'value'}</th>${r.mcts ? '<th class="num">win%</th>' : ''}<th style="width:60px"></th></tr>` +
      top.map(x => `<tr class="${sameMove(x.move, r.move) ? 'chosen' : ''}"><td>${moveToString(L.state, x.move)}</td>
        <td class="num">${r.mcts ? x.visits : (x.bound ? '≤ ' : '') + signed(x.value)}</td>${r.mcts ? `<td class="num">${Math.round(x.value * 100)}</td>` : ''}
        <td><div class="bar" style="width:${mx === mn ? 100 : 8 + 92 * ((r.mcts ? x.visits : x.value) - mn) / (mx - mn)}%;background:${L.team ? 'var(--B)' : 'var(--A)'}"></div></td></tr>`).join('') +
      `</table>${r.scores.some(x => x.bound) ? '<p class="mute" style="font-size:12px">"≤ v": α-β cut this root move off early. It only proved the move is no better than v, which is all it needed.</p>' : ''}`;
  }

  Board.init(onCell, onPiece, onGoal);
  let resizeT; window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(render, 150); });
  window.APP = { currentState: () => G.hist[G.view].s, G, newMatch, render };

  // ---------------- search tree tab ----------------
  const tpos = $('treePos');
  tpos.innerHTML = Object.entries(RFT.PRESETS).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('') + '<option value="current">Current Play board</option>';
  tpos.value = 'attack';
  const treeView = new TreeView({
    boxEl: $('treeSvgBox'), stepperEl: $('treeStepper'), explainEl: $('treeExplain'), summaryEl: $('treeSummary'),
    onHover: n => { $('treeMini').innerHTML = `<b>${n.name}</b> ${n.title ? '· ' + n.title : ''}<br>${miniBoard(n.state)}${n.value !== undefined && (!n.children || !n.children.length) ? `<br>leaf value: <b>${n.value}</b>` : ''}`; },
  });
  $('treeBuild').onclick = () => {
    const pk = tpos.value, s = pk === 'current' ? window.APP.currentState() : RFT.PRESETS[pk].make();
    if (isTerminal(s)) { $('treeExplain').textContent = 'The match is over in that position. Pick another.'; return; }
    const d = +$('treeDepth').value, k = +$('treeK').value, h = RFAI.HEURISTICS[$('treeH').value].fn, ord = $('treeOrd').checked, ab = $('treeAlgo').value === 'ab';
    const tree = RFAI.buildGameTree(s, d, k, h, ord);
    const mm = RFAI.traceTree(tree, false, true);
    const abT = RFAI.traceTree(tree, true, true);
    const trace = ab ? abT : RFAI.traceTree(tree, false, true);
    const realMM = RFAI.minimaxChoose(s, null, h, d), realAB = RFAI.alphabetaChoose(s, null, h, d, ord);
    treeView.extraSummary = `<p style="font-size:12.5px" class="mute">This drawn tree: minimax evaluates <b>${mm.leavesEval}</b> leaves, α-β <b>${abT.leavesEval}</b>.<br>
      The <b>full</b> tree at depth ${d}: minimax expands <b>${realMM.nodes.toLocaleString()}</b> nodes, α-β${ord ? ' + ordering' : ''} <b>${realAB.nodes.toLocaleString()}</b> (${Math.round(100 * (1 - realAB.nodes / realMM.nodes))}% saved). Same value: ${signed(realMM.value)} = ${signed(realAB.value)} ✓</p>
      ${Math.round(mm.value) !== Math.round(realMM.value) ? `<p style="font-size:12.5px" class="mute">Why is the drawn root value (${signed(mm.value)}) different from the full search (${signed(realMM.value)})? The drawn tree keeps only ${k} moves per node, so some moves are missing, including possibly the opponent's best reply or our own best move.</p>` : ''}
      <p style="font-size:12.5px">Root player: <b>Team ${RF.TEAM_NAME[s.turn]}</b> (MAX ▲). Values are from its point of view.</p>`;
    treeView.load(tree, trace, true, ab, { game: true, startAt: 'end' });
    $('treeMini').innerHTML = miniBoard(s);
  };

  // ---------------- trainer tab ----------------
  const trView = new TreeView({ boxEl: $('trSvgBox'), stepperEl: $('trStepper'), explainEl: $('trExplain'), logEl: $('trLog'), summaryEl: $('trSummary') });
  function loadTrainer() {
    let tree;
    try { tree = RFAI.parseTree($('trTree').value); } catch (e) { $('trExplain').textContent = 'Could not read that tree: ' + e.message + '. Use nested brackets, e.g. ((3,5),(2,9)).'; return; }
    if (!tree.children || !tree.children.length) { $('trExplain').textContent = 'The root needs at least one child, e.g. ((3,5),(2,9)).'; return; }
    const rootMax = $('trRoot').value === 'max', quiz = $('trQuiz').checked;
    const t = RFAI.traceTree(tree, true, rootMax);
    trView.extraSummary = `<p style="font-size:12.5px" class="mute">Plain minimax would evaluate all <b>${t.totalLeaves}</b> leaves. Try putting each node's best child first and watch the pruning grow.</p>`;
    trView.load(tree, t, rootMax, true, { quiz, startAt: 'begin' });
    $('quizBar').classList.toggle('hidden', !quiz); $('quizResult').textContent = ''; $('quizVal').value = '';
  }
  $('trLoad').onclick = loadTrainer;
  $('trTree').addEventListener('keydown', e => { if (e.key === 'Enter') loadTrainer(); });
  $('trRoot').onchange = loadTrainer;
  $('trPreset').onchange = () => { if ($('trPreset').value) { $('trTree').value = $('trPreset').value; loadTrainer(); } };
  $('trRandom').onclick = () => { const d = 2 + Math.floor(Math.random() * 2); $('trTree').value = RFAI.treeToString(RFAI.randomTree(d, 3)); $('trPreset').value = ''; loadTrainer(); };
  $('trQuiz').onchange = loadTrainer;
  $('quizCheck').onclick = () => {
    const r = trView.checkQuiz($('quizVal').value);
    const perfect = r.vOk && r.wrong === 0 && r.missed === 0;
    $('quizResult').innerHTML = `${r.vOk ? '<span class="ok">✓ root value ' + r.value + '</span>' : '<span class="bad">✗ root value is ' + r.value + '</span>'} · pruned leaves: <span class="ok">${r.right} right</span>, <span class="bad">${r.wrong} wrong</span>, ${r.missed} missed (of ${r.total}) ${perfect ? '🎉 Perfect!' : '. Step through the trace to see why.'}`;
    if (perfect) confetti(['#fbbf24', '#22d3ee', '#fb7185']);
  };

  // ---------------- tests tab ----------------
  $('runTests').onclick = () => {
    const res = RFT.runAll();
    $('testList').innerHTML = res.map(r => `<div class="test ${r.ok ? 'pass' : 'fail'}">${r.ok ? '✅' : '❌'} ${r.name} <small class="mute">(${r.ms} ms)</small>${r.ok ? '' : `<br><small class="bad">${r.err}</small>`}</div>`).join('');
    const ok = res.filter(r => r.ok).length;
    $('testSummary').innerHTML = ` <b class="${ok === res.length ? 'ok' : 'bad'}">${ok}/${res.length} passed</b>`;
  };
  $('textBoard').textContent = RF.toText(RF.initialState()) + '\n\nLegend: G/1-4 = Team A (GK, players), g/a-d = Team B, * = ball carrier';
  $('kickMoves').textContent = legalMoves(RF.initialState()).map(m => moveToString(RF.initialState(), m)).join('\n');

  // ---------------- rules doc ----------------
  $('rulesDoc').innerHTML = `
  <div class="toc"><a href="#r-insights">Key insights</a><a href="#r-rules">Rules</a><a href="#r-design">Design decisions</a><a href="#r-sagt">State/Actions</a><a href="#r-agents">Agents</a><a href="#r-heur">Heuristics</a><a href="#r-app">Using this app</a></div>
  <h2 id="r-insights">Key insights (read these first)</h2>
  <div class="insights">
    <div><b>1. With the ball, only the carrier moves.</b> The other three teammates are frozen until you lose the ball, so the team advances by <i>dribble → pass → dribble</i> relays.</div>
    <div><b>2. You can only lose the ball by your own action:</b> dribbling next to an opponent (tackle) or having a shot saved. A defender walking up to you steals nothing.</div>
    <div><b>3. The keeper covers 3 of the 5 columns</b> (its own ±1). A shot scores only from 2+ columns away, and the keeper slides just 1 column per turn, so switching play across the pitch beats it.</div>
    <div><b>4. Defence dominates.</b> A careful defender just keeps the keeper level with the ball and bodies next to the forward cells, so many matches between competent agents end 0–0. Tournaments therefore also report shots and time spent in the attacking third.</div>
    <div><b>5. Lopsided branching.</b> With the ball ≈ 6–13 moves, without ≈ 20–34. The defending side's levels make the tree ~3× wider and dominate the search cost. Many defensive moves are near-equal, so without good move ordering they're hard to prune (see Experiment ①).</div>
    <div><b>6. Zero-sum.</b> Every evaluation is from Team A's view; Team B's value is the negative. That's why one number (and one minimax) suffices.</div>
  </div>
  <h2 id="r-rules">Game rules (as implemented)</h2>
  <ul>
    <li><b>Board</b> 6 rows (0–5) × 5 columns (0–4). Team A (🔵) defends row 0 and attacks row 5; Team B (🔴) defends row 5 and attacks row 0. On screen, row 5 is at the top.</li>
    <li><b>Pieces</b> 4 outfield players + 1 goalkeeper per team. Two pieces never share a cell.</li>
    <li><b>Turns strictly alternate</b> A, B, A, B… regardless of possession.</li>
    <li><b>With the ball</b> the team acts with its carrier only:
      <ul><li><b>Dribble</b> 1 cell (8 directions) into an empty cell. If an opponent is then adjacent (diagonals count), it wins the ball.</li>
      <li><b>Pass</b> to a teammate on a straight row, column or exact diagonal with no <i>opponent</i> on the line. It always succeeds.</li>
      <li><b>Shoot</b> only from the attacking third (A: rows 4–5, B: rows 0–1). It's a goal unless the opposing keeper is within 1 column; then it's saved and the keeper gets the ball.</li></ul></li>
    <li><b>Without the ball</b> the team moves exactly one of its players one cell into an empty cell. The keeper moves sideways only and stays on its goal line.</li>
    <li><b>Goal</b> → everyone resets to the kickoff formation and the team that conceded restarts with the ball. Play continues.</li>
    <li><b>End</b> after a fixed budget of total turns (default <b>80</b>). More goals wins; equal goals is a draw.</li>
  </ul>
  <h2 id="r-design">Design decisions (where the spec is silent)</h2>
  <div class="formation">${miniBoard(RF.initialState(), false)}<div><b>Kickoff formation</b> (Team A bottom, B top).<br>A: GK (0,2) · defenders (1,0), (1,4) · midfielder (1,2) · forward (2,1).<br>B is the 180° point-mirror (r,c) → (5−r, 4−c).<br>The forwards are two columns apart, so the kickoff carrier never starts next to an opponent.</div></div>
  <table>
    <tr><th>Situation</th><th>Decision</th><th>Why</th></tr>
    <tr><td>Who has the ball at a restart</td><td>The conceding team's forward (#4). Team A kicks off the match.</td><td>Most advanced player; consistent.</td></tr>
    <tr><td>Several opponents adjacent after a dribble</td><td>The <b>lowest piece id</b> wins it (keeper first, then #1…#4).</td><td>Fixed and deterministic, so tests are reproducible.</td></tr>
    <tr><td>Do passes, saves or defensive moves trigger tackles?</td><td>No. Only the carrier's own dribble does.</td><td>The rules mention tackles only for dribbles.</td></tr>
    <tr><td>Keeper with the ball</td><td>May pass, and may dribble, but only sideways along its goal line (so it can never shoot).</td><td>"Must stay on its own goal line" applies at all times.</td></tr>
    <tr><td>Teammates on a passing line</td><td>Don't block. Only opponents do.</td><td>The spec says "blocked by any opposing player".</td></tr>
    <tr><td>Does a goal use up a turn?</td><td>Yes. The shot is that team's turn; the next turn belongs to the conceding team, which now has the ball.</td><td>Keeps strict alternation.</td></tr>
    <tr><td>No legal move (fully boxed in)</td><td>A "null" move: the team passes its turn.</td><td>Very rare; avoids a dead state.</td></tr>
    <tr><td>Turn budget</td><td><b>80 total turns</b> (40 each).</td><td>Crossing the pitch takes ~5–8 own turns, so 40 own turns allows several attacks and restarts. That's still short enough for 20+ game tournaments with depth-4 search in a browser.</td></tr>
    <tr><td>Ties between equally good moves</td><td>In tournaments the root moves are shuffled with a seeded RNG before searching; the pruning experiment doesn't shuffle.</td><td>Otherwise deterministic agents replay the identical match 20 times. The pruning comparison needs identical move order.</td></tr>
  </table>
  <h2 id="r-sagt">State · Actions · Terminal test · Utility</h2>
  <ul>
    <li><b>State</b>: <code>pos[20]</code> (row, col of pieces 0–9; 0 and 5 are keepers), <code>carrier</code> (id with the ball → possession = its team), <code>turn ∈ {A,B}</code>, <code>score = [gA, gB]</code>, <code>turnsLeft</code>.</li>
    <li><b>Actions</b>: <code>dribble(id→r,c)</code>, <code>pass(id→teammate)</code>, <code>shoot(id)</code>, <code>move(id→r,c)</code>, <code>null</code>, with the preconditions above. <code>applyMove</code> resolves tackles, saves and goals (plus the reset), flips <code>turn</code> and decrements <code>turnsLeft</code>.</li>
    <li><b>Terminal test</b>: <code>turnsLeft == 0</code>. <b>Utility</b>: 1000 · (gA − gB) from A's view.</li>
  </ul>
  <h2 id="r-agents">Agents</h2>
  <table>
    <tr><th>Agent</th><th>Idea</th><th>Cost per move</th></tr>
    <tr><td>Random</td><td>Uniform over legal moves: the baseline.</td><td>O(b)</td></tr>
    <tr><td>Greedy</td><td>Apply each move, score the result with a heuristic, take the best. No look-ahead: it ignores the opponent's reply.</td><td>O(b)</td></tr>
    <tr><td>Minimax d</td><td>Depth-limited minimax. Leaves are scored by the heuristic from the root player's view.</td><td>O(b<sup>d</sup>)</td></tr>
    <tr><td>Alpha-Beta d</td><td>Same value as minimax, but prunes branches that cannot affect the decision. Optional <b>move ordering</b> tries open shots first, then forward passes, then safe forward dribbles. Defenders try moves toward the ball first, and the keeper tries moves toward the ball's column.</td><td>O(b<sup>d/2</sup>) best · O(b<sup>d</sup>) worst</td></tr>
    <tr><td>MCTS (UCT)</td><td>Selection by UCB1 = W/N + C·√(ln N<sub>parent</sub> / N), C = 1.41. Expansion adds one child. The roll-out is either <b>full</b> (to the final whistle, scored win/draw/loss) or <b>depth-limited</b> (k moves, then sigmoid(H3/150)). Then back-propagation. The roll-out policy is random or "smart" (shoot when open, avoid tackle dribbles). Final move = most-visited child.</td><td>O(iterations × roll-out length)</td></tr>
  </table>
  <h2 id="r-heur">Heuristics (from Team A's view; Team B's value is the negative)</h2>
  <table>
    <tr><th>H1 · Field Position</th><th>H2 · Structure</th><th>H3 · Tempo (hybrid, extra)</th></tr>
    <tr><td><ul><li>+1000 × goal difference</li><li>±50 possession</li><li>+10 × rows the ball has advanced</li><li>+40 if the carrier is in the attacking third with the keeper ≥ 2 columns away (open shot)</li></ul>
      <i>Idea:</i> goals come from getting the ball forward into a shooting spot. Simple and fast, but blind to tackles and passing.</td>
      <td><ul><li>+1000 × goal difference, ±50 possession, +4 × ball progress</li><li>+8 × clear passing lanes from the carrier</li><li>−30 if an opponent is within 2 cells of the carrier</li><li>Defending side: +10 per outfielder between the ball and its own goal, +15 if its keeper is within 1 column of the ball</li></ul>
      <i>Idea:</i> while you have the ball your teammates are frozen, so passing lanes <b>are</b> the team's mobility. On defence, bodies behind the ball and keeper alignment stop shots. It is cautious, often too cautious.</td>
      <td><ul><li>+1000 × goal difference, ±60 possession, +15 × ball progress</li><li>open shot: +400 if the shooter's team moves next, +60 otherwise (<b>turn-aware</b>)</li><li>+6 per <b>safe</b> dribble cell for the carrier, +6 more if it goes forward (mobility)</li><li>+3 per open lane, +6 per forward lane</li><li><b>switch of play</b>: +120 per teammate in the attacking third that a clear pass can reach and that stands 3+ columns from the keeper</li><li>+4 per row each outfielder has advanced</li></ul>
      <i>Idea:</i> built on insights 2 and 3. Since a nearby defender cannot steal the ball, H3 doesn't fear proximity; it values safe options and moving the ball across faster than the keeper can follow.</td></tr>
  </table>
  <p class="mute">Why no "admissible/consistent"? Those properties belong to A* path-cost heuristics. A game evaluation function only needs to agree with the true outcome at terminal states, be fast, and correlate with winning.</p>
  <h2 id="r-app">Using this app for the exam</h2>
  <ul>
    <li><b>Play</b>: play the bots. Open <i>🧠 AI brain</i> to see how far the bot looked, how many positions it checked, and its top candidate moves ("≤ v" rows are α-β cut-offs at the root).</li>
    <li><b>Search Tree</b>: build a real game tree from any position and step through α-β, with α/β windows, values bubbling up, and ✂ cut-offs explained.</li>
    <li><b>α-β Trainer</b>: type any textbook tree or roll a random one. Use Quiz mode, solve it on paper, click the leaves you think are pruned, and check.</li>
    <li><b>Experiments</b>: every Part 3 experiment, with tables, charts, a written interpretation and "Copy Markdown" for your report.</li>
    <li><b>Rule Checks</b>: the automated Part 1 tests, also runnable with <code>node tests.js</code>.</li>
  </ul>`;
  document.querySelectorAll('.doc .toc a').forEach(a => a.onclick = e => { e.preventDefault(); document.querySelector(a.getAttribute('href')).scrollIntoView({ behavior: 'smooth' }); });

  // ---------------- boot ----------------
  LAB.initLab();
  showTab(location.hash.slice(1) || 'play');
  newMatch();
  $('treeBuild').click();
  loadTrainer();
  $('runTests').click();
  if (!store.get('seenHelp', false)) showHelp();
})();
