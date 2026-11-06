import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
const read = name => fs.readFile(root + 'dist/' + name, 'utf8');
const [sourceHtml, css, rules, engine, bot, worker, client, startPosition, moveAnimation, gameArchive, boardPresentation, onboardingExamples, onboardingUnits, boardNavigation, app] = await Promise.all(['index.html', 'styles.css', 'rules.js', 'engine.js', 'bot.js', 'bot-worker.js', 'bot-client.js', 'start-position.js', 'move-animation.js', 'game-archive.js', 'board-presentation.js', 'onboarding-examples.js', 'onboarding-units.js', 'board-navigation.js', 'app.js'].map(read));
const { version } = JSON.parse(await fs.readFile(root + 'package.json', 'utf8'));
const builtAt = new Date();
const buildLabel = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(builtAt);
const html = sourceHtml.replace(/(<span id="version-number">)[^<]*(<\/span>)/, (_, start, end) => `${start}v${version}${end}`).replace(/<span id="version-build"[^>]*>[^<]*<\/span>/, `<span id="version-build" data-built-at="${builtAt.toISOString()}">Сборка ${buildLabel} МСК</span>`);
await fs.writeFile(root + 'dist/index.html', html);
const strip = code => code.replace(/^import .*?;\n/gm, '').replace(/^export /gm, '');
const script = [rules, engine, client, startPosition, moveAnimation, gameArchive, boardPresentation, onboardingExamples, onboardingUnits, boardNavigation, app].map(strip).join('\n').replaceAll('</script', '<\\/script');
const workerSource = JSON.stringify([rules, engine, bot, worker].map(strip).join('\n')).replaceAll('<', '\\u003c');
let illustratedHtml = html;
for (const name of ['stats.svg', 'overlays.svg', 'board.svg']) {
  const svg = await read('guide/' + name);
  illustratedHtml = illustratedHtml.replaceAll('src="./guide/' + name + '"', 'src="data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64') + '"');
}
const standalone = illustratedHtml.replace('<link rel="stylesheet" href="/styles.css">', () => `<style>\n${css}\n</style>`).replace('<script type="module" src="/app.js"></script>', () => `<script id="bot-worker-source" type="application/json">${workerSource}</script>\n<script type="module">\n${script}\n</script>`).replace('href="/" aria-label="Game Of Trows — главная"', 'href="#" aria-label="Game Of Trows — главная"');
await fs.mkdir(root + 'docs', { recursive: true });
await Promise.all([
  fs.writeFile(root + 'Lamps.html', standalone),
  fs.writeFile(root + 'docs/index.html', standalone),
  fs.writeFile(root + 'docs/.nojekyll', '')
]);
console.log('Standalone: ' + root + 'Lamps.html');
