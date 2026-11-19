// This adapter runs in the native game module and uses its live selection and move pipeline.
let mobileTarget = null, mobileInspected = null;
function mobileAdvice() {
  if (hint && !hint.failed && !hint.pending) {
    menuPage('Совет', '<div id="mobile-advice-slot"></div>');
    $('#mobile-advice-slot').append($('#move-hint'));
    return;
  }
  requestHint();
}
// Keep the room controls on the waiting screen.
$('#room-first-choice').before($('#room-panel'));
$('#sheet').addEventListener('close', () => {
  const advice = $('#mobile-advice-slot #move-hint');
  if (advice) $('.left-panel').prepend(advice);
});
function syncMobileBoard() {
  syncBoardZoom();
  if (!selected || !humanCanMove() || !available.some(c => c.q === mobileTarget?.q && c.r === mobileTarget?.r)) mobileTarget = null;
  if (mobileTarget) {
    hover = key(mobileTarget.q, mobileTarget.r);
    inspection = inspectCell(state, config, mobileTarget, selected, report);
    paintAuras();
    highlightSources();
    const origin = state.pieces.find(piece => piece.id === selected);
    if (origin) $('#board [data-cell="' + key(origin.q, origin.r) + '"]').classList.add('mobile-origin');
  }
  $('#move-actions').hidden = !mobileTarget;
  const turn = visibleState().turn;
  $('#team-flag').dataset.side = turn === 1 ? 'red' : 'blue';
  const context = inspectionContext();
  const piece = context.position.pieces.find(p => p.id === (mobileInspected || selected));
  const aura = piece ? (shieldCanRetreat(piece, config) ? config.shieldPromotion.allies ?? config.shieldPromotion : config.stats[piece.type]) : null;
  const bonuses = [];
  if (aura?.aura > 0) {
    if (piece.type === 'attackLamp' && config.drumShieldMoveBonus) bonuses.push('+' + config.drumShieldMoveBonus + ' к шагу ' + (config.drumMoveAllies ? 'союзников' : 'щитоносцев'));
    if (aura.damageBonus) bonuses.push('+' + aura.damageBonus + ' к урону союзников');
    if (aura.defenseBonus) bonuses.push('+' + aura.defenseBonus + ' к стойкости ' + (piece.type === 'shield' && config.shieldDefenseOnly ? 'щитоносцев' : 'союзников'));
    if (aura.rangeBonus) bonuses.push('+' + aura.rangeBonus + ' к дальности лукарей');
  }
  $('#aura-caption').textContent = bonuses.length ? 'Аура · ' + bonuses.join(', ') : '';
  if (hint?.action && canRequestHint()) $('#show-hint').disabled = false;
  const advice = $('#show-hint');
  advice.innerHTML = mobileIcon('hint');
  advice.setAttribute('aria-label', hint?.pending ? 'Совет рассчитывается' : hint?.failed ? 'Повторить запрос совета' : 'Совет');
  advice.setAttribute('aria-busy', String(Boolean(hint?.pending)));
}
function mobileTap(q,r) {
  if (movement || combat || currentDeaths.length || tableRattle?.active) return;
  if (editor) { activateBoardCell(q,r); return; }
  const piece = visibleState().pieces.find(p => p.q === q && p.r === r);
  const playerTeam = playMode === 'online' ? roomView?.selfSeat : humanTeam;
  if (piece && (piece.team !== playerTeam || reviewingTurn || isBotTurn())) {
    mobileInspected = piece.id;
    if (!selected || visibleState().pieces.find(p => p.id === selected)?.team !== playerTeam) { selected = piece.id; render(); }
    else syncMobileBoard();
    return;
  }
  mobileInspected = null;
  if (piece) {
    mobileTarget = null;
    if (hint?.action?.id === piece.id && selected === piece.id) render();
    else activateBoardCell(q,r);
  } else if (humanCanMove() && available.some(c => c.q === q && c.r === r)) {
    mobileTarget = {q,r};
    syncMobileBoard();
  }
}
function mobileIcon(name) {
  const lines = {pass:'m5 5 10 7-10 7ZM19 5v14',hint:'M9 17h6m-5 3h4M8 12a6 6 0 1 1 8 0c-1.5 1.4-2 2-2 3h-4c0-1-.5-1.6-2-3Z',back:'m10 5-7 7 7 7M3 12h18',next:'m14 5 7 7-7 7M21 12H3'};
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+lines[name]+'"/></svg>';
}
function renderMobileTurn(position) {
  const player = playMode === 'online' ? roomView?.selfSeat : humanTeam;
  const waiting = playMode === 'online' && gamePhase === 'setup';
  const team = TEAM_NAMES[position.turn];
  const actor = position.turn === player ? 'ВЫ' : playMode === 'bot' ? BOT_DIFFICULTIES[botDifficulty].label
    : player == null ? '' : 'Соперник';
  $('#team-name').textContent = waiting ? $('#room-title').textContent : [team, actor].filter(Boolean).join(' · ');
  $('#team-flag').hidden = waiting;
  $('#move-counter').textContent = waiting ? 'Ожидание игроков' : 'Ход ' + (position.ply + 1);
}
$('#review-previous').innerHTML = mobileIcon('back');
$('#review-current').innerHTML = mobileIcon('next');
$('#undo').setAttribute('aria-label', $('#undo').title);
$('#undo span').remove();
$('#pass-turn').setAttribute('aria-label', 'Пропустить ход');
$('#pass-turn').innerHTML = mobileIcon('pass');
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
for (const id of ['undo','review-previous','review-current','show-hint','replay-combat']) {
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
function openMobileHome() {
  cancelBot();
  $('#home-continue').disabled = gamePhase !== 'playing' && playMode !== 'online' && !previousGame;
  if (!mobileHome.open) mobileHome.showModal();
  ($('#home-continue').disabled ? $('#home-new') : $('#home-continue')).focus();
}
$('#home-back').innerHTML = mobileIcon('back');
$('#home-back').onclick = openMobileHome;
mobileHome.addEventListener('cancel', event => event.preventDefault());
$('#home-continue').onclick = () => {
  mobileHome.close();
  if (previousGame && gamePhase === 'setup' && playMode !== 'online') returnToGame();
  $('#home-back').focus();
};
function mobileNewGame() {
  if (gamePhase === 'playing') openNewGame(); else openStartSettings();
}
$('#home-new').onclick = () => {
  if (playMode !== 'online') { mobileNewGame(); return; }
  menuPage('Выйти из комнаты для новой игры?', '<button id="leave-and-start" class="button primary">Выйти и начать новую игру</button>');
  $('#leave-and-start').onclick = async () => {
    $('#leave-and-start').disabled = true;
    await leaveOnlineRoom();
    $('#sheet').close();
    $('#home-continue').disabled = gamePhase !== 'playing' && !previousGame;
    mobileNewGame();
  };
};
$('#home-learn').onclick = () => {
  mobileHome.close();
  $('#rules-open').click();
};
$('#guide-back').addEventListener('click', openMobileHome);
$('#mobile-close').onclick=()=>$('#sheet').close();
