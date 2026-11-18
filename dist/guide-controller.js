import { cells } from './engine.js';
import { boardNavigationTarget } from './board-navigation.js';
import { renderUnitExamples } from './onboarding-units.js';
import { renderShowcaseBattle, ShowcaseBattle } from './onboarding-showcase.js';

// Owns the standalone guide screen and its isolated battle controllers.
export function createGuideController({ document: doc = globalThis.document, window: win = globalThis.window,
  icons = {}, renderBadges = () => '', beforeOpen = () => {}, onClose = () => {}, clock = {}, audio = null, onAnalytics = () => {} } = {}) {
  const $ = selector => doc.querySelector(selector);
  const onboardingSteps = ['Цель игры', 'Фигуры'];
  let onboardingStep = 0, onboardingShowcase = null, onboardingUnitBattles = {};
  let guideReturnScroll = 0, onboardingPreviewByKeyboard = false;
  const reducedMotion = () => win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function suppressGuideTabStops() {
    $('#rules-dialog').querySelectorAll?.('button,a,input,select,textarea,summary,[tabindex]').forEach(element => {
      if (element.closest?.('[data-slot="tabs"], [data-onboarding-step], .showcase-board, .close-dialog')) return;
      element.setAttribute('tabindex', '-1');
    });
  }
  function renderOnboarding() {
    if (onboardingStep === 0) onboardingShowcase?.resume();
    if (win.gameTabs) win.gameTabs.render(onboardingSteps, onboardingStep, step => goToStep(step, true));
    else $('#onboarding-progress').innerHTML = onboardingSteps.map((label, index) => `<button type="button" data-onboarding-step="${index}"${index === onboardingStep ? ' aria-current="step"' : ''} aria-label="Шаг ${index + 1}: ${label}"><span class="step-number">${index + 1}</span>${label}</button>`).join('');
    let content = '';
    if (onboardingStep === 0) content =
      '<ul class="onboarding-principles" id="onboarding-title"><li>Уничтожь вражеское знамя и не потеряй своё</li><li>Показывать своим фишкам кого бить — не надо</li><li>Обе армии автоматически атакуют доступные цели в конце хода</li><li>Урон от нескольких врагов складывается за один ход. Если фигура выжила, этот урон не переносится на следующий ход</li></ul>' +
      renderShowcaseBattle(ensureShowcaseBattle('main'), icons, renderBadges);
    if (onboardingStep === 1) content = renderUnitExamples(onboardingUnitBattles, icons, renderBadges);
    $('#onboarding-body').innerHTML = content;
    $('#onboarding-body').setAttribute('aria-label', onboardingSteps[onboardingStep]);
    suppressGuideTabStops();
  }
  function stop() {
    audio?.stopAll();
    onboardingShowcase?.stop();
    Object.values(onboardingUnitBattles).forEach(battle => battle.stop());
  }
  function open() {
    completedLessons.clear();
    onAnalytics('tutorial_open');
    stop(); beforeOpen();
    onboardingStep = 0; onboardingPreviewByKeyboard = false;
    onboardingShowcase = null; onboardingUnitBattles = {};
    guideReturnScroll = win.scrollY;
    doc.body.classList.add('guide-open');
    $('#rules-dialog').hidden = false;
    renderOnboarding();
    win.scrollTo(0, 0);
    $('#onboarding-body').focus({ preventScroll: true });
  }
  function goToStep(step, keepTabFocus = false) {
    stop(); onboardingPreviewByKeyboard = false;
    onboardingStep = Math.max(0, Math.min(onboardingSteps.length - 1, step));
    renderOnboarding(); win.scrollTo(0, 0);
    if (!keepTabFocus) $('#onboarding-body').focus({ preventScroll: true });
  }
  function close() {
    stop();
    $('#rules-dialog').hidden = true;
    doc.body.classList.remove('guide-open');
    onClose(); win.scrollTo(0, guideReturnScroll);
  }
  $('#guide-back').addEventListener('click', close);
  $('#rules-open').addEventListener('click', open);
  $('#onboarding-progress').addEventListener('click', event => {
    const button = event.target.closest('[data-onboarding-step]');
    if (button) goToStep(Number(button.dataset.onboardingStep));
  });
  function showcaseSceneKey(element) {
    return element?.closest?.('[data-showcase-battle]')?.dataset.showcaseBattle || 'main';
  }
  function showcaseScene(sceneKey) {
    return $('#onboarding-body').querySelector(`[data-showcase-battle="${sceneKey}"]`);
  }
  const completedLessons = new Set();
  function redrawShowcase(sceneKey='main') {
    const battle=sceneKey==='main'?onboardingShowcase:onboardingUnitBattles[sceneKey];
    if (onboardingStep !== (sceneKey==='main'?0:1) || !battle) return;
    if (battle.phase === 'finished' && battle.position.winner !== 0 && !completedLessons.has(sceneKey)) { completedLessons.add(sceneKey); onAnalytics('lesson_complete',{lesson:sceneKey}); }
    const scene=showcaseScene(sceneKey);
    if (!scene) return;
    const focused = doc.activeElement?.closest?.('[data-showcase-cell]');
    const focusCell=focused&&showcaseSceneKey(focused)===sceneKey?focused.dataset.showcaseCell:null;
    scene.outerHTML = renderShowcaseBattle(battle, icons, renderBadges);
    if (focusCell) showcaseScene(sceneKey)?.querySelector(`[data-showcase-cell="${focusCell}"]`)?.focus({preventScroll:true});
  }
  function ensureShowcaseBattle(sceneKey='main') {
    const create=()=>new ShowcaseBattle({
      sceneKey:sceneKey==='main'?null:sceneKey,
      onChange:()=>redrawShowcase(sceneKey),onPreview:()=>refreshShowcasePreview(sceneKey),
      reducedMotion, clock, audio,
      onFrame:frame=>{
        const token=showcaseScene(sceneKey)?.querySelector(`#${sceneKey==='main'?'training':sceneKey}-moving-token`);
        if(token)token.setAttribute('transform',`translate(${frame.x},${frame.y})`);
      }
    });
    if(sceneKey==='main')return onboardingShowcase ||= create();
    return onboardingUnitBattles[sceneKey] ||= create();
  }
  function updateShowcaseBattle(control) {
    if (control.disabled) return;
    onboardingPreviewByKeyboard = false;
    const battle=ensureShowcaseBattle(showcaseSceneKey(control));
    if (control.dataset.showcasePiece) {
      const piece = battle.position.pieces.find(piece => piece.id === control.dataset.showcasePiece);
      if (piece) battle.focusCell = `${piece.q},${piece.r}`;
      battle.selectPiece(control.dataset.showcasePiece);
      if (piece) battle.preview(piece);
    }
    else if (control.dataset.showcaseCell !== undefined) {
      const [q, r] = control.dataset.showcaseCell.split(',').map(Number);
      battle.focusCell = `${q},${r}`;
      const occupant = battle.position.pieces.find(piece => piece.q === q && piece.r === r);
      if (occupant) { battle.selectPiece(occupant.id); battle.preview(occupant); return; }
      const destination = { q, r };
      if (!battle.previewMoves.some(cell => cell.q === q && cell.r === r)) battle.clearSelection();
      else if (!battle.moveTo(destination)) battle.preview(destination);
    } else if (control.dataset.showcaseAction === 'continue') battle.continueCombat();
    else if (control.dataset.showcaseAction === 'restart') { completedLessons.delete(showcaseSceneKey(control)); battle.restart(); }
  }
  function refreshShowcasePreview(sceneKey='main') {
    const scene=showcaseScene(sceneKey),battle=sceneKey==='main'?onboardingShowcase:onboardingUnitBattles[sceneKey];
    if (!scene || !battle) return;
    const prefix=sceneKey==='main'?'training':sceneKey;
    const template = doc.createElement('template');
    template.innerHTML = renderShowcaseBattle(battle, icons, renderBadges);
    for(const suffix of ['effects','overlays'])scene.querySelector(`#${prefix}-${suffix}`).innerHTML=template.content.querySelector(`#${prefix}-${suffix}`).innerHTML;
    scene.querySelectorAll('[data-showcase-cell]').forEach(cell => {
      const source = template.content.querySelector(`[data-showcase-cell="${cell.dataset.showcaseCell}"]`);
      cell.setAttribute('class', source.getAttribute('class'));
    });
    // Keep hit targets in place while updating the regular battle forecast.
    scene.querySelectorAll('[data-showcase-piece]').forEach(piece => {
      const source = template.content.querySelector(`[data-showcase-piece="${piece.dataset.showcasePiece}"]`);
      piece.innerHTML = source.innerHTML;
      piece.setAttribute('class', source.getAttribute('class'));
    });
  }
  function previewShowcaseMove(event) {
    const scene=event.target.closest?.('[data-showcase-battle]');
    if(!scene) {
      if (event.type === 'pointermove' && event.pointerType !== 'touch') audio?.hover(null);
      return;
    }
    const battle=ensureShowcaseBattle(scene.dataset.showcaseBattle||'main');
    if (battle.busy) return;
    const cell = event.target.closest?.('[data-showcase-cell]');
    const unit = event.target.closest?.('[data-showcase-piece]');
    if (event.type === 'focusin' && (cell || unit)) onboardingPreviewByKeyboard = true;
    else if (onboardingPreviewByKeyboard) {
      if (event.type !== 'pointermove' || !event.movementX && !event.movementY) return;
      onboardingPreviewByKeyboard = false;
    }
    const [q, r] = cell ? cell.dataset.showcaseCell.split(',').map(Number) : [];
    const piece = unit && battle.position.pieces.find(piece => piece.id === unit.dataset.showcasePiece);
    const hovered = cell ? { q, r } : piece || null;
    if (event.type === 'pointermove' && event.pointerType !== 'touch') {
      audio?.hover(hovered ? `guide:${scene.dataset.showcaseBattle || 'main'}:${hovered.q},${hovered.r}` : null);
    }
    battle.preview(hovered);
  }
  $('#onboarding-body').addEventListener('pointerover', previewShowcaseMove);
  $('#onboarding-body').addEventListener('pointermove', previewShowcaseMove);
  $('#onboarding-body').addEventListener('focusin', previewShowcaseMove);
  $('#onboarding-body').addEventListener('pointerout', event => {
    if (onboardingPreviewByKeyboard) return;
    const scene=event.target.closest?.('[data-showcase-battle]');
    if(scene&&scene!==event.relatedTarget?.closest?.('[data-showcase-battle]')) ensureShowcaseBattle(scene.dataset.showcaseBattle||'main').preview(null);
  });
  $('#onboarding-body').addEventListener('pointerleave', () => audio?.hover(null));
  $('#onboarding-body').addEventListener('contextmenu', event => {
    if (event.button !== 2 || !event.target.closest('.showcase-field')) return;
    const battle = ensureShowcaseBattle(showcaseSceneKey(event.target));
    if (battle.selectedId === null) return;
    event.preventDefault();
    battle.clearSelection();
    if (battle.selectedId === null) audio?.click(undefined, { soft: true });
  });
  $('#onboarding-body').addEventListener('click', event => {
    if (event.target.closest('.showcase-field')) {
      const sceneKey = showcaseSceneKey(event.target), cell = event.target.closest('[data-showcase-cell]');
      const unit = event.target.closest('[data-showcase-piece]');
      const battle = ensureShowcaseBattle(sceneKey);
      const cellId = cell?.dataset.showcaseCell;
      const piece = battle.position.pieces.find(piece => unit?.dataset.showcasePiece === piece.id || cellId === `${piece.q},${piece.r}`);
      const cellKey = cellId ?? (piece ? `${piece.q},${piece.r}` : null);
      const deselecting = !battle.busy && battle.selectedId !== null && (piece
        ? piece.id === battle.selectedId
        : cellId !== undefined && !battle.previewMoves.some(move => cellId === `${move.q},${move.r}`));
      audio?.click(cellKey ? `guide:${sceneKey}:${cellKey}` : null, { soft: deselecting });
    }
    const control = event.target.closest('[data-showcase-action],[data-showcase-piece],[data-showcase-cell]');
    if (control) updateShowcaseBattle(control);
    else if (event.target.closest('.showcase-field')) ensureShowcaseBattle(showcaseSceneKey(event.target)).clearSelection();
  });
  $('#onboarding-body').addEventListener('keydown', event => {
    const trainingCell = event.target.closest('[data-showcase-cell]');
    if (trainingCell?.dataset?.showcaseCell !== undefined) {
      if (['Enter', ' '].includes(event.key)) { event.preventDefault(); audio?.click(); updateShowcaseBattle(trainingCell); }
      else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const battle = ensureShowcaseBattle(showcaseSceneKey(trainingCell));
        onboardingPreviewByKeyboard = true;
        const [q, r] = trainingCell.dataset.showcaseCell.split(',').map(Number);
        const target = boardNavigationTarget(cells(battle.config), {q,r}, event.key, battle.config.geometry, event.ctrlKey || event.metaKey);
        battle.focusCell = `${target.q},${target.r}`;
        const scene = trainingCell.closest('[data-showcase-battle]');
        scene.querySelectorAll('[data-showcase-cell]').forEach(cell => cell.setAttribute('tabindex', cell.dataset.showcaseCell === battle.focusCell ? '0' : '-1'));
        scene.querySelector(`[data-showcase-cell="${battle.focusCell}"]`)?.focus({preventScroll:true});
        battle.preview(target);
      }
      return;
    }
  });
  return { open, close, goToStep, stop };
}
