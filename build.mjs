import './ui/build.mjs';
import { interFontCss, mobilePage, routePage } from './mobile/build.mjs';
import { buildWebArt } from './scripts/build-web-art.mjs';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
const read = name => fs.readFile(root + 'dist/' + name, 'utf8');
const soundData = Object.fromEntries(await Promise.all(['slide', 'place', 'click', 'hover', 'remove', 'knock1', 'knock2', 'knock3', 'scatter', 'victory', 'defeat'].map(async name =>
  [name, 'data:audio/wav;base64,' + (await fs.readFile(root + `dist/audio/${name}.wav`)).toString('base64')])));
const { defeat } = JSON.parse(await read('audio/source-manifest.json')).runtime_sources;
const audioAssets = [
  '// Generated from audio/*.wav. Source metadata: https://github.com/Oladii/GameOfThrows/blob/main/dist/audio/source-manifest.json',
  `// Defeat sound: ${defeat.source} by ${defeat.author}. ${defeat.url}`,
  `// ${defeat.license} (${defeat.license_url}). ${defeat.processing}`,
  'export const GAME_AUDIO_ASSETS = ' + JSON.stringify(soundData) + ';',
  ''
].join('\n');
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
  .replace(/<style id="board-control-font">[^<]*<\/style>\n?/g, '')
  .replace(/<script type="importmap" id="web-token-art">[^<]*<\/script>\n?/g, '');
const publicHtml = template.replace('<meta name="game-room-endpoint" content="">', `<meta name="game-room-endpoint" content="${publicRoomEndpoint}">`);
const selectBundle = (await read('game-selects.js')).replaceAll('</script', '<\\/script');
function assemble(page, styles, artwork) {
  return page.replace('<link rel="stylesheet" href="/styles.css">', () => `<style>\n${styles}\n</style>`)
    .replace('<script src="/game-selects.js"></script>', () => `<script>${selectBundle}</script>`)
    .replace('<script type="module" src="/app.js"></script>', () => `<script id="bot-worker-source" type="application/json">${workerSource}</script>\n<script type="module">\n${script(artwork)}\n</script>`)
    .replace('<a class="brand" href="/"', '<a class="brand" href="#"');
}
const graphics = await buildWebArt(root);
function webPage(page) {
  return page.replace(brandTag, `$1 src="${graphics.logoFallback}" srcset="${graphics.logo}"`)
    .replace('</head>', `<style id="web-art">:root{${graphics.backgrounds}}</style>\n</head>`);
}
const development = webPage(template).replace('</head>', `<script type="importmap" id="web-token-art">{"imports":{"./token-assets.js":"${graphics.tokenModuleUrl}"}}</script>\n</head>`);
const faviconSource = './token-art/bullseye.svg';
async function dataUrl(file, type) {
  return 'data:' + type + ';base64,' + (await fs.readFile(root + 'dist/' + file)).toString('base64');
}
const controlIconPath = /\.\/control-icons\/[\w-]+\.svg/g;
const iconUrls = new Map(await Promise.all([...new Set(css.match(controlIconPath))].map(async file => [file, await dataUrl(file.slice(2), 'image/svg+xml')])));
const webCss = css.replace(controlIconPath, file => iconUrls.get(file));
const web = assemble(webPage(publicHtml).replace(faviconSource, graphics.favicon), webCss, graphics.tokenModule);
const controlFont = await interFontCss('Board Controls Inter');
const withControlFont = page => page.replace('</head>', () => `<style id="board-control-font">${controlFont}</style>\n</head>`);
const offlineHtml = publicHtml.replace(brandTag, '$1 src="' + await dataUrl('brand/bitva-znamen.png', 'image/png') + '"')
  .replace(faviconSource, await dataUrl('token-art/bullseye.svg', 'image/svg+xml'));
let offlineCss = webCss;
for (const file of ['team-red.png', 'team-blue.png', 'advisor.webp', 'advisor.png']) {
  offlineCss = offlineCss.replace('./brand/' + file, await dataUrl('brand/' + file, 'image/' + file.split('.')[1]));
}
const standalone = assemble(offlineHtml, offlineCss, tokenAssets);
const rulesVersion = html.match(/id="version-number"[^>]*data-rules-version="(\d+\.\d+\.\d+)"/)?.[1];
if (!rulesVersion) throw new Error('Missing rules version');
const manifest = JSON.stringify({ version, rulesVersion }) + '\n';
await Promise.all([
  fs.writeFile(root + 'Lamps.html', withControlFont(standalone)),
  fs.writeFile(root + 'dist/index.html', withControlFont(development)),
  fs.writeFile(root + 'dist/version.json', manifest),
  fs.writeFile(root + 'docs/index.html', withControlFont(routePage(web, false))),
  fs.writeFile(root + 'docs/mobile.html', await mobilePage(web)),
  fs.writeFile(root + 'docs/version.json', manifest),
  fs.writeFile(root + 'docs/.nojekyll', '')
]);
console.log('Standalone: ' + root + 'Lamps.html');
