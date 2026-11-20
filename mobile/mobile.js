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
  syncBoardZoom();
  $('#move-actions').hidden = !mobileTarget;
  const piece = inspectionContext().piece;
  const aura = piece ? (shieldCanRetreat(piece, config) ? config.shieldPromotion.allies ?? config.shieldPromotion : config.stats[piece.type]) : null;
  const bonuses = [];
  if (aura?.aura > 0) {
    if (piece.type === 'attackLamp' && config.drumShieldMoveBonus) bonuses.push('+' + config.drumShieldMoveBonus + ' к шагу ' + (config.drumMoveAllies ? 'союзников' : 'щитоносцев'));
    if (aura.damageBonus) bonuses.push('+' + aura.damageBonus + ' к урону союзников');
    if (aura.defenseBonus) bonuses.push('+' + aura.defenseBonus + ' к стойкости ' + (piece.type === 'shield' && config.shieldDefenseOnly ? 'щитоносцев' : 'союзников'));
    if (aura.rangeBonus) bonuses.push('+' + aura.rangeBonus + ' к дальности лукарей');
  }
  const caption = $('#aura-caption');
  const description = bonuses.length ? `Аура ${auraOwners[piece.type]} даёт ${bonuses.join(', ')}` : '';
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
    title = reviewingTurn ? combat ? 'Бой' : 'История' : ownTurn ? 'Ваш ход' : position.turn === 0 ? 'Ход синих' : 'Ход красных';
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
function enableBoardZoom() {
  const board = $('#board');
  const viewport = $('.board-wrap');
  const pointers = new Map();
  const maxScale = 4;
  let scale = 1, left = 0, top = 0, suppressTap = false;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function paint() {
    const {width, height} = viewport.getBoundingClientRect();
    const box = board.viewBox.baseVal;
    if (!width || !height || !box.width || !box.height) return;
    // xMidYMin anchors the unscaled SVG content at the top and centres it horizontally.
    const fit = Math.min(width / box.width, height / box.height);
    const fieldWidth = box.width * fit, fieldHeight = box.height * fit;
    const inset = (width - fieldWidth) * scale / 2;
    left = fieldWidth * scale <= width ? (width - fieldWidth * scale) / 2 - inset
      : clamp(left, width - fieldWidth * scale - inset, -inset);
    top = clamp(top, Math.min(0, height - fieldHeight * scale), 0);
    board.style.transform = scale === 1 ? 'none' : 'translate('+left+'px,'+top+'px) scale('+scale+')';
  }

  function zoomAt(nextScale, from, to = from) {
    const next = clamp(nextScale, 1, maxScale);
    const ratio = next / scale;
    left = to.x - (from.x - left) * ratio;
    top = to.y - (from.y - top) * ratio;
    scale = next;
    paint();
  }

  function relative(event) {
    const rect = viewport.getBoundingClientRect();
    return {x:event.clientX - rect.left, y:event.clientY - rect.top};
  }
  function pinch() {
    const [a,b] = pointers.values();
    return {x:(a.x+b.x)/2, y:(a.y+b.y)/2, distance:Math.hypot(a.x-b.x,a.y-b.y)};
  }
  function capture(id) {
    if (viewport.hasPointerCapture(id)) return;
    viewport.setPointerCapture(id);
  }

  viewport.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (!pointers.size) suppressTap = false;
    const p = relative(e);
    pointers.set(e.pointerId,{...p,start:p});
    if (pointers.size >= 2) {
      suppressTap = true;
      for (const id of pointers.keys()) capture(id);
    }
  });
  // Listen outside the board too so mouse release beyond its edge ends the gesture.
  window.addEventListener('pointermove', e => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    const p = relative(e);
    const before = pointers.size === 2 ? pinch() : null;
    pointers.set(e.pointerId,{...p,start:last.start});
    if (before) {
      const after = pinch();
      if (before.distance > 0 && after.distance > 0) zoomAt(scale * after.distance / before.distance, before, after);
    } else if (pointers.size === 1) {
      if (!suppressTap && Math.hypot(p.x-last.start.x,p.y-last.start.y) < 7) return;
      const origin = suppressTap ? last : last.start;
      suppressTap = true;
      if (scale > 1) {
        capture(e.pointerId);
        left += p.x-origin.x;
        top += p.y-origin.y;
        paint();
      }
    }
  });
  function finish(e) {
    pointers.delete(e.pointerId);
  }
  window.addEventListener('pointerup',finish);
  window.addEventListener('pointercancel',finish);
  window.addEventListener('blur',()=>{pointers.clear();suppressTap=true;});
  window.addEventListener('click',e=>{
    if (suppressTap && e.detail && viewport.contains(e.target)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  },true);
  viewport.addEventListener('wheel',e=>{
    if (!e.deltaY) return;
    e.preventDefault();
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientHeight : 1);
    zoomAt(scale * Math.exp(-clamp(dy,-240,240)*.003), relative(e));
  },{passive:false});
  new ResizeObserver(paint).observe(viewport);
  return paint;
}
const syncBoardZoom = enableBoardZoom();

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
mobileHome.querySelector('.home-actions').prepend($('.brand-logo').cloneNode(true));
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
  menuPage('Выйти из комнаты для новой игры?', '<button id="leave-and-start" class="button primary">Выйти и начать новую игру</button>');
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
guideClose.addEventListener('click', () => {
  openMobileHome();
  $('#home-learn').focus();
});
$('#rules-dialog').addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  event.preventDefault();
  guideClose.click();
});
$('#mobile-close').onclick=()=>$('#sheet').close();
