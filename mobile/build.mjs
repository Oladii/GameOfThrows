import { readFile } from 'node:fs/promises';

// A phone stays on the touch interface when it rotates. A narrow or touch-enabled
// computer still gets the desktop game. Both entry points accept shared links.
function routeDevice(mobilePage) {
  const phone = navigator.userAgentData?.mobile === true
    || /iPhone|iPod|Android.*Mobile|Windows Phone|KaiOS|Opera Mini/i.test(navigator.userAgent);
  if (phone === mobilePage) return;
  const target = new URL(phone ? './mobile.html' : './', location.href);
  target.search = location.search;
  target.hash = location.hash;
  location.replace(target.href);
}

export function routePage(html, mobilePage) {
  return html.replace('<head>', () => '<head>\n<script>(' + routeDevice.toString() + ')(' + mobilePage + ')</script>');
}

function edit(source, from, to) {
  if (source.split(from).length !== 2) throw new Error('Mobile entry expected one occurrence of ' + from);
  return source.replace(from, () => to);
}

function between(source, start, end, replacement) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error('Missing mobile integration point: ' + start);
  return source.slice(0, a) + replacement + source.slice(b);
}

const read = (file, encoding) => readFile(new URL(file, import.meta.url), encoding);
const assetUrl = async (file, mime) => `data:${mime};base64,${(await read(file)).toString('base64')}`;

export async function interFontCss(family = 'Inter') {
  const [font, license] = await Promise.all([assetUrl('fonts/InterVariable.woff2', 'font/woff2'), read('fonts/OFL.txt', 'utf8')]);
  return `/*\n${license}\n*/\n@font-face{font-family:"${family}";src:url(${font}) format('woff2');font-weight:100 900;font-display:swap}`;
}

async function inlinePreviewFlags() {
  const { default: sharp } = await import('sharp');
  const colors = ['blue', 'red'];
  return Promise.all(colors.map(async side => {
    const original = await read(`../dist/brand/team-${side}.png`);
    const flag = await sharp(original).resize({ width: 144 }).webp({ lossless: true }).toBuffer();
    return `--team-${side}:url("data:image/webp;base64,${flag.toString('base64')}")`;
  }));
}

export async function mobilePage(web, { preview = false } = {}) {
  const iconNames = ['match-back', 'bulb', 'arrow-left-curved', 'arrow-left-inc', 'arrow-right-inc', 'chevron-left', 'chevron-down', 'chevron-up', 'option-check'];
  const [css, controller, fontCss, icons, flags, artwork] = await Promise.all([
    read('mobile.css', 'utf8'), read('mobile.js', 'utf8'), interFontCss(),
    Promise.all(iconNames.map(name => assetUrl(`icons/${name}.svg`, 'image/svg+xml'))),
    preview ? inlinePreviewFlags() : [],
    Promise.all(['logo', 'flag-blue', 'flag-red'].map(name => assetUrl(`art/${name}.png`, 'image/png'))),
  ]);
  const [matchBackUrl, hintUrl, undoUrl, previousUrl, nextUrl, roomBackUrl, selectDown, selectUp, optionCheck] = icons;
  const [hint, undo, previous, next] = [hintUrl, undoUrl, previousUrl, nextUrl].map(url =>
    `<img src="${url}" width="24" height="24" alt="">`);
  const matchBack = `<img class="match-back-icon" src="${matchBackUrl}" width="24" height="24" alt="">`;
  const back = matchBack + `<img class="room-back-icon" src="${roomBackUrl}" width="24" height="24" alt="">`;
  const [homeLogo, blueFlag, redFlag] = artwork;
  const selectIconCss = `:root{--start-select-down:url("${selectDown}");--start-select-up:url("${selectUp}");--start-option-check:url("${optionCheck}")}`;
  const flagCss = `:root{--match-flag-blue:url("${blueFlag}");--match-flag-red:url("${redFlag}");${flags.join(';')}}`;
  let page = preview ? web : routePage(web, true);
  const change = (from, to) => { page = edit(page, from, to); };
  change('width=device-width,initial-scale=1"', 'width=device-width,initial-scale=1,viewport-fit=cover"');
  change('<meta name="theme-color" content="#fbfaf8">', '<meta name="theme-color" content="#fffefb">');
  change('</head>', `<style>\n${fontCss}\n${flagCss}\n${selectIconCss}\n${css}</style>\n</head>`);
  const desktopUpdateNotice = 'Доступно обновление игры. Обнови вкладку, чтобы применить его';
  const mobileUpdateNotice = 'Доступно обновление игры.\nОбновите вкладку, чтобы применить его';
  change(`>${desktopUpdateNotice}</div>`, `>${mobileUpdateNotice}</div>`);
  change(`'${desktopUpdateNotice}'`, JSON.stringify(mobileUpdateNotice));
  change('#board .cell.move-destination .tile{fill:', '#board .cell:is(.selected,.mobile-origin,.move-destination) .tile{fill:');
  page = page.replace(/(\.cell(?:\.(?:reachable|selected|movement-range))?):hover \.tile/g, '$1.mobile-hover-unused .tile');
  // Room navigation stays reachable while players are choosing their sides.
  change('<body>', '<body class="mobile-game">');
  const counter = '<span id="move-counter" class="move-counter" role="status" aria-live="polite" aria-atomic="true">Ход 1</span>';
  change(counter, `<button id="home-back" class="button" type="button" aria-label="На главный экран">${back}</button><div class="mobile-turn" role="status" aria-atomic="true"><strong id="team-name"></strong><span id="move-counter" class="move-counter"></span></div><span id="team-flag" aria-hidden="true"></span>`);
  const hintPanel = '<div id="move-hint" class="move-hint" role="status" aria-label="Совет" aria-live="polite" hidden></div>';
  change('        ' + hintPanel + '\n', '');
  change('<div class="board-footer">', `<div class="mobile-context"><p id="aura-caption" aria-live="polite"></p>${hintPanel}</div><div class="board-footer"><button id="result-new-game" class="button primary" type="button" hidden>Новая игра</button><div id="move-actions" hidden><button id="cancel-move" class="button">Отмена</button><button id="commit" class="button">Сделать ход</button></div>`);
  for (const [id, icon] of Object.entries({'show-hint': hint, undo, 'review-previous': previous, 'review-current': next})) {
    page = between(page, `<button id="${id}"`, '</button>', page.match(new RegExp(`<button id="${id}"[^>]*>`))[0] + icon);
  }
  change("  button.textContent = 'Подсказать ход';", `  button.setAttribute('aria-label', hint?.failed ? 'Повторить запрос подсказки' : 'Подсказка');
  button.setAttribute('aria-busy', String(Boolean(hint?.pending)));`);
  change('  setFooterDisabled(button, !canRequestHint() || hasAdvice, !canRequestHint(visibleState()) || hasAdvice);', `  const position = visibleState();
  const showDuringBotTurn = !reviewingTurn && isBotTurn(position);
  setFooterDisabled(button, !canRequestHint() || hasAdvice, !canRequestHint(position) && !showDuringBotTurn);`);
  change('<div class="hint-bubble">', '<div class="hint-bubble"><p class="mobile-hint-title">Подсказка</p>');
  change("previousGame = null; selected = null; $('#start-dialog').close(); render();", "previousGame = null; selected = null; $('#mobile-home').close(); $('#start-dialog').close(); render();");
  change('<div id="toast"', `<dialog id="mobile-home" aria-label="Главный экран"><div class="home-actions" tabindex="-1" autofocus><img class="home-logo" src="${homeLogo}" width="200" height="100" alt="Битва знамён"><button id="home-continue" class="button primary" hidden>Продолжить игру</button><button id="home-new" class="button subtle">Новая игра</button><button id="home-learn" class="button subtle">Обучение</button></div></dialog><dialog id="sheet" aria-labelledby="mobile-title"><div class="dialog-header"><h2 id="mobile-title"></h2><button class="button subtle" id="mobile-close">Закрыть</button></div><div id="mobile-body"></div></dialog><div id="toast"`);
  const startHeader = '<div class="dialog-header"><div><h2 id="start-title">Новая игра</h2></div>';
  page = between(page, startHeader, '    <div id="start-settings"', `<header class="dialog-header"><button type="button" class="icon-button close-dialog" aria-label="Назад">${matchBack}</button><h2 id="start-title">Новая игра</h2></header>\n`);
  const guideStart = '<section id="rules-dialog" class="guide-screen" aria-label="Обучение" hidden>';
  page = between(page, guideStart, '<nav id="onboarding-progress"', `<section id="rules-dialog" class="guide-screen" aria-labelledby="guide-title" hidden>
    <header class="guide-toolbar"><button id="guide-back" class="icon-button" type="button" aria-label="Назад">${matchBack}</button><h1 id="guide-title">Обучение</h1></header>
    `);
  change('aria-label="Цель игры"></div>\n    </section>\n  </section>', 'aria-label="Цель игры"></div>\n  </section>');
  change('Урон от нескольких врагов складывается за один ход. Если фигура выжила, этот урон не переносится на следующий ход', 'Урон от нескольких врагов складывается за один ход. Если фигура выжила, этот урон не переносится на следующий ход');
  change('    <div class="lesson-scene training-card">\n    <div class="training-layout"><div class="showcase-field">', '    <div class="showcase-field">');
  change('    </div></div></section>`;', '    </section>`;');
  change('<div class="play-mode-field">', '<div class="play-mode-field" hidden>');
  change('<option value="local">Вдвоём на одном экране</option>', '');
  change("    playMode: input.playMode === 'local' ? 'local' : 'bot',", "    playMode: 'bot',");
  const orientation = "playMode === 'online' && roomView?.selfSeat === 0";
  page = page.replaceAll(orientation, '(' + orientation + " || playMode === 'bot' && humanTeam === 0)");
  page = between(page, 'boardDrag = new BoardDrag({', 'tableRattle = new TableRattle', '');
  page = between(page, "$('.board-wrap').addEventListener('click', event => {", "$('.board-wrap').addEventListener('contextmenu'", '');
  page = between(page, "$('#board').addEventListener('pointermove', hoverCell);", "$('#show-hint').addEventListener('click', requestHint);", '');
  change("event.preventDefault(); activateBoardCell(...cell.dataset.cell.split(',').map(Number)); hoverCell(event);", "event.preventDefault(); mobileTap(...cell.dataset.cell.split(',').map(Number));");
  change('  selected = null; hover = null; inspection = null;\n  hint = { positionKey, pending: true };', '  hover = null; inspection = null;\n  hint = { positionKey, pending: true };');
  change('  if (hint) selected = null;', '');
  change("trackHint('hint_shown');", "selected ??= result?.action?.id ?? null; trackHint('hint_shown');");
  change('  boardMarkup(restoredIds); paintAuras(); highlightSources();', '  boardMarkup(restoredIds); setMobileInspection(state); paintAuras(); highlightSources();');
  // Reuse the shared result and its loss classification for the compact mobile header.
  change("return { winner, title: winner === 'draw'", "return { winner, lossKind: winner === 'draw' ? null : loss[1 - winner], title: winner === 'draw'");
  page = between(page, '  const turnStatus = finished || reviewingTurn', '\n}\nfunction renderUpdateNotice()', '  return result;');
  change('  renderGameResult(state);', '  const result = renderGameResult(state);');
  change('  renderOnlineRoom();\n  save();', '  renderOnlineRoom();\n  renderMobileTurn(state, result);\n  syncMobileBoard();\n  save();');
  change("$('#board').setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);", `// Fit the outer hexes to the mobile frame with its narrower field and 1 px top inset.
  const mobilePadX = (maxX - minX) * .01177;
  const mobileTop = minY + (config.geometry === 'hex' ? 6.3 : 10);
  $('#board').setAttribute('viewBox', \`\${minX - mobilePadX} \${mobileTop} \${maxX - minX + 2 * mobilePadX} \${maxY - mobileTop}\`);`);
  // An existing bot match can continue on a phone. Keep native same-device saves
  // intact when starting a separate mobile match.
  if (preview) {
    change("const STORAGE = archiveIsSite ? 'lamps-prototype-v1' : 'lamps-local-playtest13-v1';", "const STORAGE = 'mobile-game-bot-112-v1';");
    change(`const archiveEndpoint = $('meta[name="game-archive-endpoint"]')?.content || '';`, "const archiveEndpoint = '';");
  } else {
    change("const STORAGE = archiveIsSite ? 'lamps-prototype-v1' : 'lamps-local-playtest13-v1';", "const desktopStorage = archiveIsSite ? 'lamps-prototype-v1' : 'lamps-local-playtest13-v1';\nconst STORAGE = desktopStorage + '-mobile';");
    change('const raw = localStorage.getItem(STORAGE);', `let raw = localStorage.getItem(STORAGE);
  if (raw === null) {
    const previous = localStorage.getItem(desktopStorage);
    if (previous && JSON.parse(previous).playMode === 'bot') raw = previous;
  }`);
  }
  change("if (gamePhase === 'playing') archiveRecorder.resume(archiveGameMetadata());", controller + `
if (gamePhase === 'setup') playMode = 'bot';
if (gamePhase === 'playing') archiveRecorder.resume(archiveGameMetadata());`);
  change("if (!initialRoomId && !freshNewGameRequested) startLocalOnArrival();", "if (!initialRoomId && !freshNewGameRequested) openMobileHome();");
  return page;
}
