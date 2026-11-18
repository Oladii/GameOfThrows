// The standalone page includes all game code, CSS and the bot Worker.
// A fresh page URL therefore refreshes the whole release without clearing
// storage belonging to the archive or other projects on the same origin.
export function freshNewGameUrl(href, nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`, startGame = false) {
  const url = new URL(href);
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  url.searchParams.set('_fresh', nonce);
  url.searchParams.set('_newGame', startGame ? 'start' : '1');
  return url.href;
}

export function consumeNewGameRefresh(location, browserHistory) {
  const url = new URL(location.href);
  if (!['1', 'start'].includes(url.searchParams.get('_newGame'))) return false;
  url.searchParams.delete('_newGame');
  browserHistory.replaceState(null, '', url.href);
  return true;
}

export async function refreshNewGamePage({ location, fetchPage = fetch, online = true, timeoutMs = 4000, startGame = false, signal }) {
  const url = freshNewGameUrl(location.href, undefined, startGame);
  if (!url || !online || signal?.aborted) return false;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchPage(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return false;
    const html = await response.text();
    if (controller.signal.aborted) return false;
    if (!html.includes('id="version-number"') || !html.includes('<script id="bot-worker-source"')) return false;
    location.replace(url);
    return true;
  } catch { return false; }
  finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}

function versionParts(value) { return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null; }
export function hasNewerGameVersion(current, candidate) {
  const a = versionParts(current), b = versionParts(candidate);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] > a[i];
  return false;
}
// UI releases apply on reload; only a rules change requires a new match.
export function needsNewGame({ phase, savedVersion, currentRulesVersion, latestRulesVersion }) {
  return hasNewerGameVersion(currentRulesVersion, latestRulesVersion)
    || (phase === 'playing' && versionParts(currentRulesVersion) !== null
      && (!versionParts(savedVersion) || hasNewerGameVersion(savedVersion, currentRulesVersion)));
}
export async function latestGameVersion({ location, fetchPage = fetch, online = true, timeoutMs = 4000, includeRules = false }) {
  const url = new URL(location.href);
  if (!online || !['http:', 'https:'].includes(url.protocol)) return null;
  const manifest = new URL('./version.json', url);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchPage(manifest.href, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return null;
    const { version, rulesVersion } = await response.json();
    if (!versionParts(version)) return null;
    if (!includeRules) return version;
    return { version, rulesVersion: versionParts(rulesVersion) ? rulesVersion : null };
  } catch { return null; }
  finally { clearTimeout(timer); }
}
