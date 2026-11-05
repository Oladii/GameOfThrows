export function alphaBeta(node, remaining, alpha, beta, context) {
  context.visit?.(node, remaining);
  if (remaining === 0 || context.terminal(node)) return node.immediate;
  const children = context.children(node, remaining);
  if (!children.length) return node.immediate;
  const maximizing = context.maximizing(node);
  let value = maximizing ? -Infinity : Infinity;
  for (const child of children) {
    const next = alphaBeta(child, remaining - 1, alpha, beta, context);
    value = maximizing ? Math.max(value, next) : Math.min(value, next);
    if (maximizing) alpha = Math.max(alpha, value); else beta = Math.min(beta, value);
    if (beta <= alpha) break;
  }
  return value;
}
