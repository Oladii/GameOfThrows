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

export async function mobilePage(web) {
  const [css, controller] = await Promise.all(['mobile.css', 'mobile.js'].map(file => readFile(new URL(file, import.meta.url), 'utf8')));
  let page = routePage(web, true);
  const change = (from, to) => { page = edit(page, from, to); };
  change('width=device-width,initial-scale=1"', 'width=device-width,initial-scale=1,viewport-fit=cover"');
  change('</head>', '<style>' + css + '</style>\n</head>');
  change('#board .cell.move-destination .tile{fill:', '#board .cell:is(.selected,.mobile-origin,.move-destination) .tile{fill:');
  page = page.replace(/(\.cell(?:\.(?:reachable|selected|movement-range))?):hover \.tile/g, '$1.mobile-hover-unused .tile');
  // Room navigation stays reachable while players are choosing their sides.
  change("  $('.arena-top').hidden = online && $('.board-wrap').hidden;", '');
  change('<body>', '<body class="mobile-game">');
  change('<span id="move-counter" class="move-counter" role="status" aria-live="polite" aria-atomic="true">Ход 1</span>', '<button id="home-back" class="button subtle" aria-label="На главный экран"></button><strong id="team-name"></strong><span id="team-flag" aria-hidden="true"></span>');
  change('<section class="arena" aria-label="Игровая доска">', '<span id="move-counter" class="move-counter" role="status" aria-live="polite" aria-atomic="true">Ход 1</span><section class="arena" aria-label="Игровая доска">');
  change("if (playMode === 'online' && gamePhase === 'setup') $('#move-counter').textContent = 'Ожидание игроков';", "renderMobileTurn(position);");
  change('<div class="board-footer">', '<div class="mobile-context"><span id="aura-caption" aria-live="polite"></span></div><div class="board-footer"><div id="move-actions" hidden><button id="cancel-move" class="button">Отмена</button><button id="commit" class="button">Сделать ход</button></div>');
  change("previousGame = null; selected = null; $('#start-dialog').close(); render();", "previousGame = null; selected = null; $('#mobile-home').close(); $('#start-dialog').close(); render();");
  change('<div id="toast"', '<dialog id="mobile-home" aria-label="Главный экран"><div class="home-actions"><button id="home-continue" class="button primary">Продолжить игру</button><button id="home-new" class="button outline">Новая игра</button><button id="home-learn" class="button subtle">Обучение</button></div></dialog><dialog id="sheet" aria-labelledby="mobile-title"><div class="dialog-header"><h2 id="mobile-title"></h2><button class="button subtle" id="mobile-close">Закрыть</button></div><div id="mobile-body"></div></dialog><div id="toast"');
  change('<option value="local">Вдвоём на одном экране</option>', '');
  const orientation = "playMode === 'online' && roomView?.selfSeat === 0";
  page = page.replaceAll(orientation, '(' + orientation + " || playMode === 'bot' && humanTeam === 0)");
  page = between(page, 'boardDrag = new BoardDrag({', 'tableRattle = new TableRattle', '');
  page = between(page, "$('.board-wrap').addEventListener('click', event => {", "$('.board-wrap').addEventListener('contextmenu'", '');
  page = between(page, "$('#board').addEventListener('pointermove', hoverCell);", "$('#show-hint').addEventListener('click', requestHint);", '');
  change("$('#show-hint').addEventListener('click', requestHint);", "$('#show-hint').addEventListener('click', mobileAdvice);");
  change("event.preventDefault(); activateBoardCell(...cell.dataset.cell.split(',').map(Number)); hoverCell(event);", "event.preventDefault(); mobileTap(...cell.dataset.cell.split(',').map(Number));");
  change("if (event.key === 'Tab' && playMode !== 'online' && !event.target.closest('dialog') && !soundControl.contains(event.target)) { event.preventDefault(); soundButton.focus(); return; }", '');
  change('  if (hint) selected = null;', '');
  change("trackHint('hint_shown');", "selected ??= result?.action?.id ?? null; trackHint('hint_shown');");
  change('  renderOnlineRoom();\n  save();', '  renderOnlineRoom();\n  syncMobileBoard();\n  save();');
  // An existing bot match can continue on a phone. Keep native same-device saves
  // intact when starting a separate mobile match.
  change("const STORAGE = archiveIsSite ? 'lamps-prototype-v1' : 'lamps-local-playtest13-v1';", "const desktopStorage = archiveIsSite ? 'lamps-prototype-v1' : 'lamps-local-playtest13-v1';\nconst STORAGE = desktopStorage + '-mobile';");
  change('const raw = localStorage.getItem(STORAGE);', `let raw = localStorage.getItem(STORAGE);
  if (raw === null) {
    const previous = localStorage.getItem(desktopStorage);
    if (previous && JSON.parse(previous).playMode === 'bot') raw = previous;
  }`);
  change("if (gamePhase === 'playing') archiveRecorder.resume(archiveGameMetadata());", controller + `
if (autoStartFreshGame) {
  humanTeam = 0; firstMove = 'north'; playMode = 'bot';
}
if (gamePhase === 'playing') archiveRecorder.resume(archiveGameMetadata());`);
  change("if ((autoStartFreshGame || autoStartSavedBot && !freshNewGameRequested) && !initialRoomId) startGame();", "if (!initialRoomId && !freshNewGameRequested) openMobileHome();");
  return page;
}
