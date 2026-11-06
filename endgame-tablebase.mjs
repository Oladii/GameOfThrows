import { cells, directions, distance, isRay, isLethalDamage, shieldCanRetreat } from './dist/engine.js';

// Exact reachability game: an invulnerable veteran and defense flag versus one
// non-shield enemy. Other positions retain the ordinary selective search.
export function createEndgameTablebase(config) {
  const cache = new Map(), metrics = { queries: 0, hits: 0, builds: 0 };
  function lookup(state) {
    metrics.queries++;
    if (config.stats.archer.aura > 0 && config.stats.archer.damageBonus > 0) return null;
    if (state.winner !== null || state.pieces.length !== 3 || config.geometry !== 'hex' || config.size !== 4 || !config.experiments.allyShotsPass || config.experiments.allowPass) return null;
    const shield = state.pieces.find(p => shieldCanRetreat(p, config));
    if (!shield || config.stats.shield.move !== 1) return null;
    const flag = state.pieces.find(p => p.team === shield.team && p.type === 'defenseLamp');
    const enemy = state.pieces.find(p => p.team !== shield.team);
    if (!flag || !enemy || enemy.type === 'shield') return null;
    const enemyStats = config.stats[enemy.type], promotion = config.shieldPromotion;
    // The reduced table models shield kills only. An aura-armed commander needs the full engine search.
    if (promotion.aura > 0 && promotion.rangeBonus > 0 && isLethalDamage(promotion.damageBonus, enemyStats.fortitude)) return null;
    if (![1, 2].includes(enemyStats.move) || ![1, 2].includes(config.stats.defenseLamp.move)) return null;
    if (isLethalDamage(enemyStats.damage, Math.min(config.stats.defenseLamp.fortitude, config.stats.shield.fortitude + promotion.defenseBonus))) return null;
    if (!isLethalDamage(config.stats.shield.damage + promotion.damageBonus, enemyStats.fortitude)) return null;
    const range = Math.min(config.stats.shield.range + promotion.rangeBonus, promotion.maxRange);
    const key = `${config.stats.defenseLamp.move}:${enemyStats.move}:${range}`;
    if (!cache.has(key)) { cache.set(key, build(config, config.stats.defenseLamp.move, enemyStats.move, range)); metrics.builds++; }
    const table = cache.get(key), at = p => table.at.get(`${p.q},${p.r}`);
    const node = ((at(shield) * table.n + at(flag)) * table.n + at(enemy)) * 2 + (state.turn === shield.team ? 0 : 1);
    if (!table.won[node]) return null;
    metrics.hits++;
    return { winner: shield.team, plies: table.ranks[node] };
  }
  return { lookup, metrics };
}

function build(config, flagMove, enemyMove, range) {
  const board = cells(config), n = board.length, volume = n ** 3;
  const at = new Map(board.map((c, i) => [`${c.q},${c.r}`, i]));
  const adjacent = board.map(c => directions(config).map(([q, r]) => at.get(`${c.q + q},${c.r + r}`)).filter(i => i !== undefined));
  const attacks = board.map(s => board.map(a => distance(s, a, config) <= range && isRay(s, a, config)));
  const flood = (start, limit, block1, block2 = -1) => {
    const seen = new Uint8Array(n), queue = [start], depths = [0], out = []; seen[start] = 1;
    for (let i = 0; i < queue.length; i++) if (depths[i] < limit) for (const next of adjacent[queue[i]]) if (!seen[next] && next !== block1 && next !== block2) {
      seen[next] = 1; queue.push(next); depths.push(depths[i] + 1); out.push(next);
    }
    return out;
  };
  const won = new Uint8Array(volume * 2), ranks = new Uint16Array(volume * 2), remaining = new Uint8Array(volume * 2), maxChild = new Uint16Array(volume * 2);
  const queue = new Uint32Array(volume * 2), enemyMoves = new Uint8Array(volume * 18), enemyCounts = new Uint8Array(volume);
  const flagMoves = Array.from({ length: n * n }, (_, i) => flood(i % n, flagMove, Math.floor(i / n)));
  let head = 0, tail = 0;
  const add = (node, rank) => { if (!won[node]) { won[node] = 1; ranks[node] = rank; queue[tail++] = node; } };
  for (let s = 0; s < n; s++) for (let b = 0; b < n; b++) if (s !== b) for (let a = 0; a < n; a++) if (a !== s && a !== b) {
    const base = (s * n + b) * n + a, options = flood(a, enemyMove, s, b);
    enemyCounts[base] = options.length; enemyMoves.set(options, base * 18); remaining[base * 2 + 1] = options.length;
    if (attacks[s][a]) { add(base * 2, 0); add(base * 2 + 1, 0); }
  }
  while (head < tail) {
    const node = queue[head++], turn = node % 2, base = Math.floor(node / 2), a = base % n, b = Math.floor(base / n) % n, s = Math.floor(base / (n * n));
    if (turn === 1) {
      for (const previous of adjacent[s]) if (previous !== a && previous !== b) add(((previous * n + b) * n + a) * 2, ranks[node] + 1);
      for (const previous of flagMoves[a * n + b]) if (previous !== s) add(((s * n + previous) * n + a) * 2, ranks[node] + 1);
    } else for (let i = 0; i < enemyCounts[base]; i++) {
      const previous = enemyMoves[base * 18 + i], pred = ((s * n + b) * n + previous) * 2 + 1;
      if (won[pred]) continue;
      maxChild[pred] = Math.max(maxChild[pred], ranks[node]);
      if (--remaining[pred] === 0) add(pred, maxChild[pred] + 1);
    }
  }
  return { n, at, won, ranks };
}
