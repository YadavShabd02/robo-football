# Robo-Football: Adversarial Search Lab

**Run it:** double-click `index.html`. It works offline in any modern browser, with no install and no server.
**Headless rule checks:** `node tests.js` (16 checks).

## What's inside

| Tab | Assignment part | What it does |
|---|---|---|
| 🎮 Play | Part 1 + fun | Play vs 5 bot levels (Random → α-β depth 4, MCTS), watch bot-vs-bot, or hot-seat. The AI-brain panel explains every bot move. |
| 🌳 Search Tree | Part 2 | Builds a real game tree from any position and steps through minimax / α-β: α/β windows, cut-offs, and why each happens. |
| ✍️ α-β Trainer | Exam prep | Hand-trace practice on any textbook or random tree, with a Quiz mode that hides the answer until you check. |
| 🧪 Experiments | Part 3 | All five required experiments plus a league, with tables, charts, data-driven interpretations and Markdown export. |
| ✅ Rule Checks | Part 1 | The 16 automated rule tests and the text-board printer. |
| 📘 Rules & Design | All | Rules, every design decision with its reason, state/actions, agents, heuristic formulas, key insights. |

| File | Contents |
|---|---|
| `engine.js` | Game environment: state, legal moves, `applyMove` (tackles, saves, goals, reset), terminal test, text printer |
| `agents.js` | Random, Greedy, Minimax, Alpha-Beta (+ move ordering), MCTS (full / depth-limited roll-outs), heuristics H1/H2/H3, tree tracer |
| `tests.js` | Rule checks + preset positions used by the experiments |
| `ui-board.js`, `ui-tree.js`, `ui-lab.js`, `app.js`, `style.css`, `index.html` | Browser UI |

## Key findings (from the Experiments tab)

- α-β always returns the same value as minimax. It saves ~75% of nodes at depth 4, or ~92% with move ordering, and the saving grows with depth.
- **Defence dominates.** The ball only changes hands when the *carrier* dribbles next to a defender, and a keeper that stays within one column of the ball saves every shot. So α-β agents essentially never concede, and search-vs-search games end 0–0. That's why tournaments also report shots and attacking-third possession.
- Head-to-head the heuristics are evenly matched on goals. Against common opponents they separate: H3 has the best goal difference against both Random and Greedy.
- H3 sometimes sets **pressing traps**: it loses the ball on purpose where the opponent's new carrier is boxed in, so it wins the ball straight back. This is minimax exploiting its evaluation within the horizon.
- Depth vs strength zig-zags between odd and even depths, while cost grows ~×4 per level.
- MCTS with full random roll-outs suffers from sparse reward. Depth-limited roll-outs + H3 do better, but on this small board α-β is stronger per millisecond.
