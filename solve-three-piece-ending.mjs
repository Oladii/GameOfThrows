// Exact reachability game for match 8: invulnerable promoted shield + defense
// flag versus a lone archer. North wins iff it forces the archer onto a shield
// attack ray after a move. South's damage 1 can never kill either North unit.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { clone, cells, directions, distance, isRay, reachable, move } from '../outputs/playtest-2026-11-05-shield-promotion-range/engine-snapshot/engine.js';

const data = JSON.parse(await fs.readFile('../outputs/playtest-2026-11-05-shield-promotion-range/matches.json', 'utf8'));
const match = data.matches.find(m => m.match === 8), config = data.protocol.config;
assert.equal(match.finalState.pieces.length, 3);
assert.equal(config.experiments.allowPass, false);
assert.equal(config.experiments.allyShotsPass, true);
const shield = match.finalState.pieces.find(p => p.type === 'shield');
const flag = match.finalState.pieces.find(p => p.type === 'defenseLamp');
const archer = match.finalState.pieces.find(p => p.type === 'archer');
assert.equal(shield.team, flag.team); assert.notEqual(archer.team, shield.team);
assert.equal(shield.reachedFarEdge, true); assert.equal(config.stats.archer.damage, 1);
const board = cells(config), n = board.length, volume = n ** 3;
const at = new Map(board.map((c, i) => [`${c.q},${c.r}`, i]));
const adjacent = board.map(c => directions(config).map(([q, r]) => at.get(`${c.q + q},${c.r + r}`)).filter(i => i !== undefined));
const index = p => at.get(`${p.q},${p.r}`);
const attack = board.map(s => board.map(a => distance(s, a, config) <= 2 && isRay(s, a, config)));
function flood(start, limit, block1, block2 = -1, landingBlock = -1) {
  const seen = new Uint8Array(n), queue = [start], depths = [0], result = [];
  seen[start] = 1;
  for (let i = 0; i < queue.length; i++) {
    if (depths[i] === limit) continue;
    for (const next of adjacent[queue[i]]) if (!seen[next] && next !== block1 && next !== block2) {
      seen[next] = 1; queue.push(next); depths.push(depths[i] + 1);
      if (next !== landingBlock) result.push(next);
    }
  }
  return result;
}
const initial = ((index(shield) * n + index(flag)) * n + index(archer)) * 2 + (match.finalState.turn === shield.team ? 0 : 1);
const results = [];
for (const variant of [{ id: 'current', archerMove: 2, shieldMove: 1 }, { id: 'archer_move_1', archerMove: 1, shieldMove: 1 }, { id: 'shield_move_2', archerMove: 2, shieldMove: 2 }]) {
  const began = performance.now();
  const won = new Uint8Array(volume * 2), remaining = new Uint8Array(volume * 2), ranks = new Uint16Array(volume * 2), maxChild = new Uint16Array(volume * 2);
  const queue = new Uint32Array(volume * 2), archerMoves = new Uint8Array(volume * 18), archerCounts = new Uint8Array(volume);
  const flagMoves = Array.from({ length: n * n }, (_, i) => flood(i % n, 2, Math.floor(i / n)));
  const shieldMoves = variant.shieldMove === 1 ? null : Array.from({ length: n * n }, (_, i) => flood(i % n, variant.shieldMove, Math.floor(i / n)));
  let head = 0, tail = 0, validStates = 0, validatedModelPositions = 0;
  const add = (node, rank) => { if (won[node]) return; won[node] = 1; ranks[node] = rank; queue[tail++] = node; };
  for (let s = 0; s < n; s++) for (let b = 0; b < n; b++) if (s !== b) for (let a = 0; a < n; a++) if (a !== s && a !== b) {
    const base = (s * n + b) * n + a, options = flood(a, variant.archerMove, s, b);
    archerCounts[base] = options.length; archerMoves.set(options, base * 18);
    remaining[base * 2 + 1] = options.length; validStates += 2;
    if (attack[s][a]) { add(base * 2, 0); add(base * 2 + 1, 0); }
    // Independently compare the reduced movement model with production rules.
    if (base % 601 === 0 && !attack[s][a]) {
      const c = clone(config); c.stats.archer.move = variant.archerMove; c.stats.shield.move = variant.shieldMove;
      const state = { pieces: [{ ...shield, ...board[s] }, { ...flag, ...board[b] }, { ...archer, ...board[a] }], turn: shield.team, ply: 200, winner: null };
      const sets = [
        [state.pieces[0], variant.shieldMove === 1 ? adjacent[s].filter(i => i !== b && i !== a) : shieldMoves[a * n + s].filter(i => i !== b)],
        [state.pieces[1], flagMoves[a * n + b].filter(i => i !== s)],
        [state.pieces[2], options]
      ];
      for (const [piece, modeled] of sets) assert.deepEqual(reachable(piece, state, c).map(index).sort((x, y) => x - y), [...modeled].sort((x, y) => x - y));
      validatedModelPositions++;
    }
  }
  while (head < tail) {
    const node = queue[head++], turn = node % 2, base = Math.floor(node / 2);
    const a = base % n, b = Math.floor(base / n) % n, s = Math.floor(base / (n * n));
    if (turn === 1) {
      // North needs one winning move. All movement here is reversible.
      const priorShields = variant.shieldMove === 1 ? adjacent[s].filter(i => i !== a) : shieldMoves[a * n + s];
      for (const previous of priorShields) if (previous !== b) add(((previous * n + b) * n + a) * 2, ranks[node] + 1);
      for (const previous of flagMoves[a * n + b]) if (previous !== s) add(((s * n + previous) * n + a) * 2, ranks[node] + 1);
    } else {
      // South must have every legal escape already inside North's attractor.
      for (let i = 0; i < archerCounts[base]; i++) {
        const previous = archerMoves[base * 18 + i], pred = ((s * n + b) * n + previous) * 2 + 1;
        if (won[pred]) continue;
        maxChild[pred] = Math.max(maxChild[pred], ranks[node]);
        if (--remaining[pred] === 0) add(pred, maxChild[pred] + 1);
      }
    }
  }
  // Check a finite rank certificate against every modeled forward transition.
  // North has a decreasing-rank move; all South replies decrease the rank.
  let certificateStates = 0;
  for (let s = 0; s < n; s++) for (let b = 0; b < n; b++) if (s !== b) for (let a = 0; a < n; a++) if (a !== s && a !== b && !attack[s][a]) {
    const base = (s * n + b) * n + a;
    if (won[base * 2]) {
      const nextShields = variant.shieldMove === 1 ? adjacent[s].filter(i => i !== a) : shieldMoves[a * n + s];
      const childNodes = nextShields.filter(i => i !== b).map(i => ((i * n + b) * n + a) * 2 + 1);
      childNodes.push(...flagMoves[a * n + b].filter(i => i !== s).map(i => ((s * n + i) * n + a) * 2 + 1));
      assert.ok(childNodes.some(child => won[child] && ranks[child] < ranks[base * 2])); certificateStates++;
    }
    if (won[base * 2 + 1]) {
      assert.ok(archerCounts[base] > 0);
      for (let i = 0; i < archerCounts[base]; i++) {
        const child = ((s * n + b) * n + archerMoves[base * 18 + i]) * 2;
        assert.ok(won[child] && ranks[child] < ranks[base * 2 + 1]);
      }
      certificateStates++;
    }
  }
  const outcome = { ...variant, validStates, northWinningStates: tail, finalPositionNorthCanForceWin: !!won[initial], worstCasePliesToCapture: won[initial] ? ranks[initial] : null, validatedModelPositions, certificateStates, allModeledWinningStatesHaveDecreasingRankCertificate: true, seconds: +( (performance.now() - began) / 1000).toFixed(3), principalLine: [] };
  if (won[initial]) {
    let state = clone(match.finalState), node = initial;
    const c = clone(config); c.stats.archer.move = variant.archerMove; c.stats.shield.move = variant.shieldMove;
    while (state.winner === null) {
      const north = state.turn === shield.team, options = [];
      for (const p of state.pieces.filter(p => p.team === state.turn)) for (const to of reachable(p, state, c)) {
        const next = move(state, c, p.id, to);
        let child = null, rank = 0;
        if (next.state.winner === null) {
          child = ((index(next.state.pieces.find(p => p.id === shield.id)) * n + index(next.state.pieces.find(p => p.id === flag.id))) * n + index(next.state.pieces.find(p => p.id === archer.id))) * 2 + (next.state.turn === shield.team ? 0 : 1);
          if (!won[child]) { assert.equal(north, true); continue; }
          rank = ranks[child];
        }
        options.push({ id: p.id, to, next, rank, child });
      }
      options.sort((a, b) => north ? a.rank - b.rank : b.rank - a.rank);
      const chosen = options[0]; assert.ok(chosen);
      assert.ok(chosen.next.state.winner === shield.team || chosen.rank < ranks[node]);
      outcome.principalLine.push({ team: state.turn, id: chosen.id, from: state.pieces.find(p => p.id === chosen.id), to: chosen.to, remainingRank: chosen.rank });
      state = chosen.next.state; node = chosen.child;
    }
    assert.equal(state.winner, shield.team);
    assert.ok(outcome.principalLine.length <= outcome.worstCasePliesToCapture);
  }
  results.push(outcome); console.log(JSON.stringify({ ...outcome, principalLine: undefined }));
}
await fs.writeFile('../outputs/diagnostics-2026-11-05-five-limit-games/exact-ending-8.json', JSON.stringify({ assumptions: 'Promoted shield and defense flag are permanently invulnerable to lone archer damage 1; North wins by shield rays of reach 2. Full finite reachability attractor, all legal moves, no heuristic beam. Non-attractor states admit indefinite evasion in this model.', results }, null, 2));
