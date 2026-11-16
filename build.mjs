import './ui/build.mjs';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
const read = name => fs.readFile(root + 'dist/' + name, 'utf8');
const soundData = Object.fromEntries(await Promise.all(['slide', 'place', 'click', 'hover', 'remove'].map(async name =>
  [name, 'data:audio/wav;base64,' + (await fs.readFile(root + `dist/audio/${name}.wav`)).toString('base64')])));
const audioAssets = '// Generated from audio/*.wav. Per-file provenance, processing and license status: audio/source-manifest.json\nexport const GAME_AUDIO_ASSETS = ' + JSON.stringify(soundData) + ';\n';
await fs.writeFile(root + 'dist/audio-assets.js', audioAssets);
const audio = await read('audio.js');
const [sourceHtml, css, rules, engine, defensiveSelection, formationStrategy, bot, worker, client, startChoices, startPosition, moveAnimation, gameArchive, boardPresentation, onboardingUnits, onboardingShowcase, boardNavigation, newGameRefresh, hint, guideController, app] = await Promise.all(['index.html', 'styles.css', 'rules.js', 'engine.js', 'defensive-selection.mjs', 'formation-strategy.mjs', 'bot.js', 'bot-worker.js', 'bot-client.js', 'start-preferences.js', 'start-position.js', 'move-animation.js', 'game-archive.js', 'board-presentation.js', 'onboarding-units.js', 'onboarding-showcase.js', 'board-navigation.js', 'new-game-refresh.js', 'hint.js', 'guide-controller.js', 'app.js'].map(read));
const { version } = JSON.parse(await fs.readFile(root + 'package.json', 'utf8'));
const [tokenAssets, tokenPresentation] = await Promise.all(['token-assets.js','token-presentation.js'].map(read));
const builtAt = new Date();
const buildLabel = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(builtAt);
const html = sourceHtml.replace(/(<span id="version-number"[^>]*>)[^<]*(<\/span>)/, (_, start, end) => `${start}v${version}${end}`).replace(/<span id="version-build"[^>]*>[^<]*<\/span>/, `<span id="version-build" data-built-at="${builtAt.toISOString()}">Сборка ${buildLabel} МСК</span>`);
await fs.writeFile(root + 'dist/index.html', html);
const strip = code => code.replace(/^import .*?;\n/gm, '').replace(/^export /gm, '');
const [multiplayerClient, multiplayerSession] = await Promise.all(['multiplayer-client.js', 'multiplayer-session.js'].map(read));
const script = [rules, engine, client, startChoices, startPosition, moveAnimation, gameArchive, tokenAssets, tokenPresentation, boardPresentation, audioAssets, audio, onboardingUnits, onboardingShowcase, boardNavigation, newGameRefresh, hint, guideController, multiplayerClient, multiplayerSession, app].map(strip).join('\n').replaceAll('</script', '<\\/script');
const workerSource = JSON.stringify([rules, engine, defensiveSelection, formationStrategy, bot, worker].map(strip).join('\n')).replaceAll('<', '\\u003c');
// Published standalone pages use the hosted API; the development page keeps its local API.
const publicRoomEndpoint = html.match(/<meta name="game-archive-endpoint" content="([^"]+)">/)?.[1];
if (!publicRoomEndpoint) throw new Error('Missing production room API endpoint');
let illustratedHtml = html.replace('<meta name="game-room-endpoint" content="">', `<meta name="game-room-endpoint" content="${publicRoomEndpoint}">`);
const [brandIcon, favicon] = await Promise.all([
  fs.readFile(root + 'dist/brand/game-of-trows-v1.png'),
  fs.readFile(root + 'dist/token-art/bullseye.svg')
]);
illustratedHtml = illustratedHtml.replaceAll('src="./brand/game-of-trows-v1.png"', 'src="data:image/png;base64,' + brandIcon.toString('base64') + '"');
illustratedHtml = illustratedHtml.replaceAll('href="./token-art/bullseye.svg"', 'href="data:image/svg+xml;base64,' + favicon.toString('base64') + '"');
const selectBundle = (await read('game-selects.js')).replaceAll('</script', '<\\/script');
let illustratedCss = css;
for (const color of ['red', 'blue']) {
  const flag = await fs.readFile(root + `dist/brand/team-${color}.png`);
  illustratedCss = illustratedCss.replaceAll(`./brand/team-${color}.png`, 'data:image/png;base64,' + flag.toString('base64'));
}
const advisor = await fs.readFile(root + 'dist/brand/advisor.png');
illustratedCss = illustratedCss.replaceAll('./brand/advisor.png', 'data:image/png;base64,' + advisor.toString('base64'));
const standalone = illustratedHtml.replace('<link rel="stylesheet" href="/styles.css">', () => `<style>\n${illustratedCss}\n</style>`).replace('<script type="module" src="/app.js"></script>', () => `<script id="bot-worker-source" type="application/json">${workerSource}</script>\n<script>${selectBundle}</script>\n<script type="module">\n${script}\n</script>`).replace('href="/" aria-label="Game Of Trows — главная"', 'href="#" aria-label="Game Of Trows — главная"');
await fs.mkdir(root + 'docs', { recursive: true });
await Promise.all([
  fs.writeFile(root + 'Lamps.html', standalone),
  fs.writeFile(root + 'docs/index.html', standalone),
  fs.writeFile(root + 'docs/.nojekyll', '')
]);
console.log('Standalone: ' + root + 'Lamps.html');
