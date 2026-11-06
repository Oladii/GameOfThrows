// Move focus without changing selection or the game position.
export function boardNavigationTarget(board, current, direction, geometry = 'hex', wholeBoard = false) {
  const point = cell => geometry === 'hex' ? { x: cell.q + cell.r / 2, y: cell.r * Math.sqrt(3) / 2 } : { x: cell.q, y: cell.r };
  const origin = point(current);
  if (direction === 'Home' || direction === 'End') {
    const row = (wholeBoard ? board : board.filter(cell => cell.r === current.r)).slice().sort((a, b) => point(a).y - point(b).y || point(a).x - point(b).x);
    return (direction === 'Home' ? row[0] : row.at(-1)) || current;
  }
  const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight';
  if (!horizontal && direction !== 'ArrowUp' && direction !== 'ArrowDown') return current;
  const axis = horizontal ? 'x' : 'y', cross = horizontal ? 'y' : 'x';
  const sign = direction === 'ArrowLeft' || direction === 'ArrowUp' ? -1 : 1;
  const candidates = board.map(cell => ({ cell, point: point(cell) })).filter(candidate => sign * (candidate.point[axis] - origin[axis]) > 1e-6 && (!horizontal || Math.abs(candidate.point.y - origin.y) < 1e-6));
  candidates.sort((a, b) => Math.abs(a.point[axis] - origin[axis]) - Math.abs(b.point[axis] - origin[axis]) || Math.abs(a.point[cross] - origin[cross]) - Math.abs(b.point[cross] - origin[cross]) || Math.abs(a.cell.q - current.q) - Math.abs(b.cell.q - current.q));
  return candidates[0]?.cell || current;
}
