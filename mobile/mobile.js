// This adapter runs in the native game module and uses its live selection and move pipeline.
let mobileTarget = null, mobileInspected = null;
const auraOwners = {shield:'Щитоносца', archer:'Лукаря', attackLamp:'Барабана', defenseLamp:'Знамени', scoutLamp:'Командира', horn:'Горна'};
// Keep the room controls on the waiting screen.
$('#room-first-choice').before($('#room-panel'));
function setMobileInspection(position) {
  if (!selected) mobileInspected = null;
  if (mobileTarget && (!selected || !humanCanMove() || !available.some(c => c.q === mobileTarget.q && c.r === mobileTarget.r))) mobileTarget = null;
  const piece = position.pieces.find(p => p.id === mobileInspected) ?? position.pieces.find(p => p.id === selected);
  const cell = mobileTarget ?? piece;
  hover = null;
  inspection = null;
  $('#board .mobile-origin')?.classList.remove('mobile-origin');
  if (!cell || movement || combat || currentDeaths.length) return;
  // A touch selection supplies the same inspection target as hovering on desktop.
  hover = key(cell.q, cell.r);
  inspection = inspectCell(position, config, cell, selected, report);
  const origin = inspection.isPreview && position.pieces.find(p => p.id === selected);
  if (origin) $('#board [data-cell="' + key(origin.q, origin.r) + '"]')?.classList.add('mobile-origin');
}
function refreshMobileInspection() {
  setMobileInspection(visibleState());
  paintAuras();
  highlightSources();
  syncMobileBoard();
}
function syncMobileBoard() {
  $('#move-actions').hidden = !mobileTarget;
  const piece = inspectionContext().piece;
  const aura = piece ? (shieldCanRetreat(piece, config) ? config.shieldPromotion.allies ?? config.shieldPromotion : config.stats[piece.type]) : null;
  const bonuses = [];
  if (aura?.aura > 0) {
    if (piece.type === 'attackLamp' && config.drumShieldMoveBonus) bonuses.push('+' + config.drumShieldMoveBonus + ' к шагу ' + (config.drumMoveAllies ? 'союзников' : 'щитоносцев'));
    if (aura.damageBonus) bonuses.push('+' + aura.damageBonus + ' к урону союзников');
    if (aura.defenseBonus) bonuses.push('+' + aura.defenseBonus + ' к стойкости ' + (piece.type === 'shield' && config.shieldDefenseOnly ? 'щитоносцев' : 'союзников'));
    if (aura.rangeBonus) bonuses.push('+' + aura.rangeBonus + ' к дальности лукарей');
  }
  const caption = $('#aura-caption');
  const bonusText = bonuses.length < 2 ? bonuses[0] : `${bonuses.slice(0, -1).join(', ')} и ${bonuses.at(-1)}`;
  const description = bonuses.length ? `Аура ${auraOwners[piece.type]} даёт ${bonusText}` : '';
  if (caption.textContent !== description) caption.textContent = description;
}
function mobileTap(q,r) {
  if (movement || combat || currentDeaths.length || tableRattle?.active) return;
  if (editor) { activateBoardCell(q,r); return; }
  const piece = visibleState().pieces.find(p => p.q === q && p.r === r);
  const playerTeam = playMode === 'online' ? roomView?.selfSeat : humanTeam;
  if (piece) mobileTarget = null;
  if (piece && (piece.team !== playerTeam || reviewingTurn || isBotTurn())) {
    mobileInspected = piece.id;
    if (!selected || visibleState().pieces.find(p => p.id === selected)?.team !== playerTeam) { selected = piece.id; render(); }
    else refreshMobileInspection();
    return;
  }
  mobileInspected = null;
  if (piece) {
    if (hint?.action?.id === piece.id && selected === piece.id) render();
    else activateBoardCell(q,r);
  } else if (humanCanMove() && available.some(c => c.q === q && c.r === r)) {
    mobileTarget = {q,r};
    refreshMobileInspection();
  }
}
const mobileFlag = $('#team-flag');
function renderMobileTurn(position, result) {
  const newGame = $('#result-new-game');
  const player = playMode === 'online' ? roomView?.selfSeat : humanTeam;
  const waiting = document.body.classList.contains('room-waiting');
  newGame.hidden = !result;
  let title, detail, flagTeam = position.turn;
  if (waiting) {
    title = $('#room-title').textContent;
    detail = 'Ожидание игроков';
    flagTeam = null;
  } else if (result) {
    flagTeam = result.winner === 'draw' ? null : result.winner;
    title = flagTeam === null ? result.title : flagTeam === 0 ? 'Победа Синих' : 'Победа Красных';
    detail = {flag: 'Уничтожено знамя', combat: 'Уничтожены войска', all: 'Уничтожены войска'}[result.lossKind] ?? result.reason;
  } else {
    const ownTurn = position.turn === player;
    title = reviewingTurn ? combat ? 'Бой' : 'История' : ownTurn ? 'Ваш ход' : position.turn === 0 ? 'Ход Синих' : 'Ход Красных';
    const actor = !reviewingTurn && !ownTurn && playMode === 'bot'
      ? BOT_DIFFICULTIES[botDifficulty].label + (botDifficulty === 'hard' ? '' : ' бот')
      : TEAM_NAMES[position.turn];
    detail = `Ход ${position.ply + 1} · ${actor}`;
  }
  for (const [id, text] of [['#team-name', title], ['#move-counter', detail]]) {
    const label = $(id);
    if (label.textContent !== text) label.textContent = text;
  }
  mobileFlag.hidden = flagTeam === null;
  mobileFlag.dataset.side = flagTeam === null ? '' : flagTeam === 1 ? 'red' : 'blue';
}
$('#undo').setAttribute('aria-label', $('#undo').title);
$('#pass-turn').setAttribute('aria-label', 'Пропустить ход');
$('#pass-turn').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 5 10 7-10 7ZM19 5v14"/></svg>';
$('#cancel-move').onclick = () => {
  mobileTarget = mobileInspected = null;
  render();
};
$('#commit').onclick = () => {
  if (!mobileTarget || !humanCanMove()) return;
  const {q,r} = mobileTarget;
  mobileTarget = mobileInspected = null;
  activateBoardCell(q,r);
};
document.addEventListener('keydown', e => { if (['Tab','ArrowLeft','ArrowRight','ArrowDown','ArrowUp'].includes(e.key)) document.body.dataset.keys=''; },true);
document.addEventListener('pointerdown', () => { delete document.body.dataset.keys; },true);

let press = null;
$('#board').addEventListener('pointerdown', e => { press={x:e.clientX,y:e.clientY,cell:e.target.closest('[data-cell]')?.dataset.cell}; });
$('#board').addEventListener('pointercancel', () => { press=null; });
$('.board-wrap').addEventListener('click', e => {
  const k=e.target.closest('[data-cell]')?.dataset.cell;
  if (k && (e.detail===0 || (press?.cell===k && Math.hypot(e.clientX-press.x,e.clientY-press.y)<10))) {
    focusBoardCell(k); mobileTap(...k.split(',').map(Number));
  }
  press=null;
});
for (const id of ['undo','review-previous','review-current','show-hint']) {
  $('#'+id).addEventListener('click',()=>{mobileInspected=mobileTarget=null;},true);
}
function menuPage(title,html) {
  $('#mobile-title').textContent=title;
  $('#mobile-body').innerHTML=html;
  if (!$('#sheet').open) $('#sheet').showModal();
  $('#mobile-close').focus();
}
const mobileHome = $('#mobile-home');
const mobileTheme = $('meta[name="theme-color"]');
const baseMobileTheme = mobileTheme.content;
const mobileUpdateNotice = $('#update-notice');
const mobileFullScreens = [mobileHome, $('#start-dialog'), $('#sheet')];
const mobileThemeObserver = new MutationObserver(() => {
  const showBanner = !mobileUpdateNotice.hidden && !document.body.classList.contains('guide-open')
    && mobileFullScreens.every(dialog => !dialog.open);
  const color = showBanner ? getComputedStyle(mobileUpdateNotice).backgroundColor : baseMobileTheme;
  if (mobileTheme.content !== color) mobileTheme.content = color;
});
mobileThemeObserver.observe(mobileUpdateNotice, { attributeFilter: ['hidden'] });
mobileThemeObserver.observe(document.body, { attributeFilter: ['class'] });
for (const dialog of mobileFullScreens) mobileThemeObserver.observe(dialog, { attributeFilter: ['open'] });

function syncMobileHome() {
  const canContinue = gamePhase === 'playing' || playMode === 'online' || Boolean(previousGame);
  $('#home-continue').hidden = !canContinue;
  $('#home-new').classList.toggle('primary', !canContinue);
  $('#home-new').classList.toggle('subtle', canContinue);
}
function openMobileHome() {
  cancelBot();
  syncMobileHome();
  if (!mobileHome.open) mobileHome.showModal();
}
$('#home-back').onclick = openMobileHome;
mobileHome.addEventListener('cancel', event => event.preventDefault());
$('#home-continue').onclick = () => {
  mobileHome.close();
  if (previousGame && gamePhase === 'setup' && playMode !== 'online') returnToGame();
  $('#home-back').focus();
};
function openMobileStartSettings() {
  if (gamePhase === 'playing') openNewGame(); else openStartSettings();
}
function mobileNewGame() {
  if (playMode !== 'online') { openMobileStartSettings(); return; }
  menuPage('Выйти из комнаты для новой игры?', '<button id="leave-and-start" class="button primary">Выйти и начать новую игру</button>');
  $('#leave-and-start').onclick = async () => {
    $('#leave-and-start').disabled = true;
    await leaveOnlineRoom();
    $('#sheet').close();
    syncMobileHome();
    openMobileStartSettings();
  };
}
$('#home-new').onclick = $('#result-new-game').onclick = mobileNewGame;
$('#home-learn').onclick = () => {
  mobileHome.close();
  $('#rules-open').click();
};
const guideClose = $('#guide-back');
guideClose.addEventListener('click', openMobileHome);
$('#rules-dialog').addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  event.preventDefault();
  guideClose.click();
});
$('#mobile-close').onclick=()=>$('#sheet').close();
