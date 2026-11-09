// The standalone page includes all game code, CSS and the bot Worker.
// A fresh page URL therefore refreshes the whole release without clearing
// storage belonging to the archive or other projects on the same origin.
export function freshNewGameUrl(href, nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`) {
  const url = new URL(href);
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  url.searchParams.set('_fresh', nonce);
  url.searchParams.set('_newGame', '1');
  return url.href;
}

export function consumeNewGameRefresh(location, browserHistory) {
  const url = new URL(location.href);
  if (url.searchParams.get('_newGame') !== '1') return false;
  url.searchParams.delete('_newGame');
  browserHistory.replaceState(null, '', url.href);
  return true;
}

export async function refreshNewGamePage({ location, fetchPage = fetch, online = true, timeoutMs = 4000 }) {
  const url = freshNewGameUrl(location.href);
  if (!url || !online) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchPage(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return false;
    const html = await response.text();
    if (!html.includes('id="version-number"') || !html.includes('<script id="bot-worker-source"')) return false;
    location.replace(url);
    return true;
  } catch { return false; }
  finally { clearTimeout(timeout); }
}

function versionParts(value) { return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null; }
export function hasNewerGameVersion(current, candidate) {
  const a = versionParts(current), b = versionParts(candidate);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] > a[i];
  return false;
}
export function needsNewGame({ phase, savedVersion, currentVersion, latestVersion }) {
  return hasNewerGameVersion(currentVersion, latestVersion) || (phase === 'playing' && (!versionParts(savedVersion) || hasNewerGameVersion(savedVersion, currentVersion)));
}
export async function latestGameVersion({ location, fetchPage = fetch, online = true, timeoutMs = 4000 }) {
  const url = new URL(location.href);
  if (!online || !['http:', 'https:'].includes(url.protocol)) return null;
  url.searchParams.delete('_newGame'); url.searchParams.delete('_fresh');
  url.searchParams.set('_versionCheck', String(Date.now()));
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchPage(url.href, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return null;
    const match = (await response.text()).match(/id=["']version-number["'][^>]*>\s*v?(\d+\.\d+\.\d+)\s*</);
    return match?.[1] || null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}
