import './ui/build.mjs';
import { buildWebArt } from './scripts/build-web-art.mjs';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
const read = name => fs.readFile(root + 'dist/' + name, 'utf8');
const soundData = Object.fromEntries(await Promise.all(['slide', 'place', 'click', 'hover', 'remove', 'knock1', 'knock2', 'knock3', 'scatter', 'victory', 'defeat'].map(async name =>
  [name, 'data:audio/wav;base64,' + (await fs.readFile(root + `dist/audio/${name}.wav`)).toString('base64')])));
const audioAssets = '// Generated from audio/*.wav. Per-file provenance, processing and license status: audio/source-manifest.json\nexport const GAME_AUDIO_ASSETS = ' + JSON.stringify(soundData) + ';\n';
await fs.writeFile(root + 'dist/audio-assets.js', audioAssets);
const audio = await read('audio.js');
const tableKnocksSource = await read('table-knocks.js');
const tableRattleSource = await read('table-rattle.js');
const boardDragSource = await read('board-drag.js');
const [sourceHtml, css, rules, engine, defensiveSelection, formationStrategy, bot, worker, client, startChoices, startPosition, moveAnimation, gameArchive, browserAnalytics, boardPresentation, onboardingUnits, onboardingShowcase, boardNavigation, newGameRefresh, hint, guideController, app] = await Promise.all(['index.html', 'styles.css', 'rules.js', 'engine.js', 'defensive-selection.mjs', 'formation-strategy.mjs', 'bot.js', 'bot-worker.js', 'bot-client.js', 'start-preferences.js', 'start-position.js', 'move-animation.js', 'game-archive.js', 'browser-analytics.js', 'board-presentation.js', 'onboarding-units.js', 'onboarding-showcase.js', 'board-navigation.js', 'new-game-refresh.js', 'hint.js', 'guide-controller.js', 'app.js'].map(read));
const { version } = JSON.parse(await fs.readFile(root + 'package.json', 'utf8'));
const [tokenAssets, tokenPresentation] = await Promise.all(['token-assets.js','token-presentation.js'].map(read));
const builtAt = new Date();
const buildLabel = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(builtAt);
const html = sourceHtml.replace(/(<span id="version-number"[^>]*>)[^<]*(<\/span>)/, (_, start, end) => `${start}v${version}${end}`).replace(/<span id="version-build"[^>]*>[^<]*<\/span>/, `<span id="version-build" data-built-at="${builtAt.toISOString()}">Сборка ${buildLabel} МСК</span>`);

const strip = code => code.replace(/^import .*?;\n/gm, '').replace(/^export /gm, '');
const [multiplayerClient, multiplayerSession] = await Promise.all(['multiplayer-client.js', 'multiplayer-session.js'].map(read));
const script = artwork => [rules, engine, client, startChoices, startPosition, moveAnimation, gameArchive, browserAnalytics, artwork, tokenPresentation, boardPresentation, audioAssets, audio, tableKnocksSource, tableRattleSource, boardDragSource, onboardingUnits, onboardingShowcase, boardNavigation, newGameRefresh, hint, guideController, multiplayerClient, multiplayerSession, app].map(strip).join('\n').replaceAll('</script', '<\\/script');
const workerSource = JSON.stringify([rules, engine, defensiveSelection, formationStrategy, bot, worker].map(strip).join('\n')).replaceAll('<', '\\u003c');
// Published standalone pages use the hosted API; the development page keeps its local API.
const publicRoomEndpoint = html.match(/<meta name="game-archive-endpoint" content="([^"]+)">/)?.[1];
if (!publicRoomEndpoint) throw new Error('Missing production room API endpoint');
// Normalise the generated development entry before deriving either distribution.
const brandTag = /(<img class="brand-logo") src="[^"]+"(?: srcset="[^"]+")?/;
const template = html.replace(/<style id="web-art">[^<]*<\/style>\n?/g, '')
  .replace(/<script type="importmap" id="web-token-art">[^<]*<\/script>\n?/g, '');
const publicHtml = template.replace('<meta name="game-room-endpoint" content="">', `<meta name="game-room-endpoint" content="${publicRoomEndpoint}">`);
const selectBundle = (await read('game-selects.js')).replaceAll('</script', '<\\/script');
function assemble(page, styles, artwork) {
  return page.replace('<link rel="stylesheet" href="/styles.css">', () => `<style>\n${styles}\n</style>`)
    .replace('<script src="/game-selects.js"></script>', () => `<script>${selectBundle}</script>`)
    .replace('<script type="module" src="/app.js"></script>', () => `<script id="bot-worker-source" type="application/json">${workerSource}</script>\n<script type="module">\n${script(artwork)}\n</script>`)
    .replace('href="/" aria-label="Game Of Trows — главная"', 'href="#" aria-label="Game Of Trows — главная"');
}
const graphics = await buildWebArt(root);
function webPage(page) {
  return page.replace(brandTag, `$1 src="${graphics.logoFallback}" srcset="${graphics.logo}"`)
    .replace('</head>', `<style id="web-art">:root{${graphics.backgrounds}}</style>\n</head>`);
}
const development = webPage(template).replace('</head>', `<script type="importmap" id="web-token-art">{"imports":{"./token-assets.js":"${graphics.tokenModuleUrl}"}}</script>\n</head>`);
const faviconSource = './token-art/bullseye.svg';
const web = assemble(webPage(publicHtml).replace(faviconSource, graphics.favicon), css, graphics.tokenModule);
async function dataUrl(file, type) {
  return 'data:' + type + ';base64,' + (await fs.readFile(root + 'dist/' + file)).toString('base64');
}
const offlineHtml = publicHtml.replace(brandTag, '$1 src="' + await dataUrl('brand/game-of-trows-v1.png', 'image/png') + '"')
  .replace(faviconSource, await dataUrl('token-art/bullseye.svg', 'image/svg+xml'));
let offlineCss = css;
for (const file of ['team-red.png', 'team-blue.png', 'advisor.webp', 'advisor.png']) {
  offlineCss = offlineCss.replace('./brand/' + file, await dataUrl('brand/' + file, 'image/' + file.split('.')[1]));
}
const standalone = assemble(offlineHtml, offlineCss, tokenAssets);
const rulesVersion = html.match(/id="version-number"[^>]*data-rules-version="(\d+\.\d+\.\d+)"/)?.[1];
if (!rulesVersion) throw new Error('Missing rules version');
const manifest = JSON.stringify({ version, rulesVersion }) + '\n';
await Promise.all([
  fs.writeFile(root + 'Lamps.html', standalone),
  fs.writeFile(root + 'dist/index.html', development),
  fs.writeFile(root + 'dist/version.json', manifest),
  fs.writeFile(root + 'docs/index.html', web),
  fs.writeFile(root + 'docs/version.json', manifest),
  fs.writeFile(root + 'docs/.nojekyll', '')
]);
console.log('Standalone: ' + root + 'Lamps.html');
