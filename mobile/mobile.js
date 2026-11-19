// This adapter runs in the native game module and uses its live selection and move pipeline.
let mobileTarget = null, mobileInspected = null, mobileCoordinates = false;
function mobileAdvice() {
  if (hint && !hint.failed && !hint.pending) {
    menuPage('Совет', '<div id="mobile-advice-slot"></div>');
    $('#mobile-advice-slot').append($('#move-hint'));
    return;
  }
  requestHint();
}
// The waiting screen and the in-game sheet share the native room controls.
$('#room-first-choice').before($('#room-panel'));
$('#sheet').addEventListener('close', () => {
  const roomPanel = $('#mobile-room-slot #room-panel');
  if (roomPanel) $('#room-first-choice').before(roomPanel);
  const advice = $('#mobile-advice-slot #move-hint');
  if (advice) $('.left-panel').prepend(advice);
});
const cellLabel = p => 'АБВГДЕЖЗИКЛ'[p.q + config.size] + (p.r + config.size + 1);
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
  $('#team-name').textContent = TEAM_NAMES[turn];
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
  if (mobileCoordinates && !movement && !combat) {
    for (const el of $('#board').querySelectorAll('[data-cell]')) {
      const [q,r] = el.dataset.cell.split(',').map(Number);
      if (context.position.pieces.some(p => p.q === q && p.r === r) || el.querySelector('text')) continue;
      const pos = point({q,r});
      el.insertAdjacentHTML('beforeend','<text pointer-events="none" text-anchor="middle" font-size="9" fill="#756b5b" x="'+pos.x+'" y="'+(pos.y+20)+'">'+cellLabel({q,r})+'</text>');
    }
  }
  if (hint?.action && canRequestHint()) $('#show-hint').disabled = false;
  $('#show-hint').innerHTML = mobileIcon('hint') + (hint?.pending ? 'Расчёт…' : hint?.failed ? 'Повторить' : 'Совет');
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
  const lines = {hint:'M9 17h6m-5 3h4M8 12a6 6 0 1 1 8 0c-1.5 1.4-2 2-2 3h-4c0-1-.5-1.6-2-3Z',back:'m10 5-7 7 7 7M3 12h18',next:'m14 5 7 7-7 7M21 12H3', menu:'M3 6h18M3 12h18M3 18h18'};
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+lines[name]+'"/></svg>';
}
$('#menu').innerHTML = mobileIcon('menu');
$('#review-previous').innerHTML = mobileIcon('back')+'Назад';
$('#review-current').innerHTML = mobileIcon('next')+'Вперёд';
$('#undo span').textContent = 'Отменить';
$('#replay-combat span').textContent = 'Повтор';
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
function mobileMenu() {
  const entries=[[playMode === 'online' ? 'room' : 'start', playMode === 'online' ? 'Игровая комната' : 'Новая игра'],['rules','Правила'],['legend','Обозначения'],['log','Журнал ходов'],['settings','Настройки поля']];
  menuPage('Меню партии','<div class="rows">'+entries.map(([id,name])=>'<button class="button subtle" data-page="'+id+'">'+name+'</button>').join('')+'</div>');
}
$('#menu').onclick=mobileMenu;
$('#mobile-close').onclick=()=>$('#sheet').close();
function mobilePage(name,index=0) {
  if (name === 'start') {
    $('#sheet').close();
    if (gamePhase === 'playing') openNewGame(); else openStartSettings();
    return;
  }
  if (name === 'room') {
    menuPage('Игровая комната', '<div id="mobile-room-slot"></div>');
    $('#mobile-room-slot').append($('#room-panel'));
    return;
  }
  const pages={rules:['Выберите свою фигуру и подсвеченную клетку. Чтобы подтвердить ход, нажмите «Сделать ход».','Обе стороны атакуют одновременно. Фигура погибает, если входящий урон достигает её стойкости.','Уничтожьте вражеское знамя или всех щитоносцев и лукарей соперника.'],legend:['Зелёная подсветка показывает, куда можно пойти. Значки на фишке показывают урон и стойкость.','Стрелки показывают атакующих и цели. Череп отмечает фигуру, которая погибнет при расчёте.'],log:log.map(item=>[item.text,item.detail].filter(Boolean).join('. '))};
  if(name==='settings'){
    menuPage('Настройки поля','<label><input id="mobile-coords" type="checkbox" '+(mobileCoordinates?'checked':'')+'> Координаты пустых клеток</label>');$('#mobile-coords').onchange=e=>{mobileCoordinates=e.target.checked;};return;
  }
  const items=pages[name],heading={rules:'Правила',legend:'Обозначения',log:'Журнал ходов'}[name];
  menuPage(heading,'<p id="mobile-copy"></p>'+(items.length>1?'<div class="pages"><button class="button subtle" id="mp-prev">Назад</button><span>'+(index+1)+' / '+items.length+'</span><button class="button subtle" id="mp-next">Дальше</button></div>':''));
  $('#mobile-copy').textContent=items[index]??'Ходов пока нет.';
  if(items.length>1){for(const [id,delta] of [['mp-prev',-1],['mp-next',1]]){const i=index+delta;$('#'+id).disabled=i<0||i>=items.length;$('#'+id).onclick=()=>mobilePage(name,i);}}
}
$('#mobile-body').addEventListener('click',e=>{const page=e.target.closest('[data-page]')?.dataset.page;if(page)mobilePage(page,page==='log'?Math.max(0,log.length-1):0);});
