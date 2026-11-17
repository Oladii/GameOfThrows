import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG, TEAM_NAMES, LABELS } from '../dist/rules.js';
import { analyze, inspectCell, cells, key, shieldCanRetreat, archerHasEdgeBonus } from '../dist/engine.js';
import { renderDamageArrows, inspectionDamageArrows, damageArrowMarkers } from '../dist/board-presentation.js';

const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
function declaration(name) {
  const start = app.indexOf(`function ${name}(`), lineEnd = app.indexOf('\n', start);
  return app.slice(start, app.slice(start, lineEnd).endsWith('}') ? lineEnd : app.indexOf('\n}', lineEnd) + 2);
}
function setup() {
  const config = structuredClone(DEFAULT_CONFIG);
  const state = { pieces: [{ id: 'mover', type: 'archer', team: 0, q: 0, r: 1 }, { id: 'enemy', type: 'archer', team: 1, q: 2, r: 1 }], turn: 1, ply: 1, winner: null };
  const cell = { dataset: { cell: '0,1' }, hasAttribute: () => true, closest: () => cell };
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', setAttribute() {}, contains: () => true,
      focus() { context.document.activeElement = cell; context.hoverCell({ target: cell }); } });
    return nodes.get(selector);
  };
  const context = vm.createContext({ tableRattle: null, boardDrag: null, config, state, report: analyze(state, config), selected: null, hover: null, inspection: null,
    boardFocus: '0,1', restoringBoardFocus: false, fieldView: null, movement: null, combat: null, currentDeaths: [],
    available: [], editor: false, playMode: 'local', humanTeam: 0, gamePhase: 'playing', reviewingTurn: false,
    TEAM_NAMES, LABELS, cells, key, shieldCanRetreat, archerHasEdgeBonus, inspectCell, renderDamageArrows, inspectionDamageArrows, damageArrowMarkers, ICON_PATHS: {},
    $: node, gameAudio: { hover() {} }, document: { activeElement: cell, querySelectorAll: () => [] },
    visibleState: () => state, isBotTurn: () => false, paintAuras() {}, paintAttackReach() {}, renderInspector() {},
    point: p => ({ x: p.q * 57, y: p.r * 49.5 }), polygon: () => '',
    unitAppearance: () => ({}), renderTokenBody: () => '', unitBadges: () => '', renderDeathEffects: () => '', hintTrace: () => '', lastMoveTrace: () => '', movingTokenMarkup: () => '' });
  for (const name of ['inspectionContext', 'highlightSources', 'boardMarkup', 'hoverCell', 'clearHover']) vm.runInContext(declaration(name), context);
  return { context, layer: node('#attack-lines'), cell, node };
}

test('restoring board focus after a turn clears forecast arrows without reopening inspection', () => {
  const { context, layer } = setup();
  context.hoverCell({ target: context.document.activeElement });
  assert.match(layer.innerHTML, /class="attack-ray"/);
  // render() clears the old inspection before replacing the board's cells.
  context.hover = null; context.inspection = null;
  context.boardMarkup(); context.highlightSources();
  assert.equal(context.inspection, null);
  assert.equal(layer.innerHTML, '');
  assert.equal(context.document.activeElement.dataset.cell, '0,1');
  assert.equal(context.restoringBoardFocus, false);
});

test('intentional focus and pointer inspection still show arrows after the turn', () => {
  for (const type of ['focusin', 'pointermove']) {
    const { context, layer, cell } = setup();
    context.boardMarkup(); context.highlightSources();
    context.hoverCell({ type, target: cell });
    assert.match(layer.innerHTML, /class="attack-ray"/);
    context.clearHover();
    assert.equal(layer.innerHTML, '');
  }
});
test('clearing visual inspection on focusout does not reset the audio pointer cell', () => {
  const {context,cell}=setup(),audioEvents=[];
  context.gameAudio.hover=key=>audioEvents.push(key);
  context.hoverCell({type:'pointermove',target:cell});
  context.clearHover(); // Focus can leave the old SVG node during selection/render.
  context.boardMarkup();
  context.hoverCell({type:'pointermove',target:cell});
  assert.deepEqual(audioEvents,['board:0,1','board:0,1']);
  assert.ok(!audioEvents.includes(null),'only a physical pointer leave may reset the audio cell');
});

test('the focus restoration guard is released if the browser rejects focus', () => {
  const { context, node } = setup();
  node('#board [tabindex="0"]').focus = () => { throw new Error('focus interrupted'); };
  assert.throws(() => context.boardMarkup(), /focus interrupted/);
  assert.equal(context.restoringBoardFocus, false);
});

test('forecast highlights the destination and clearing it restores the selected origin', () => {
  const { context } = setup();
  context.state.turn = 0;
  context.selected = 'mover';
  const origin = { dataset: { cell: '0,1' }, classes: new Set(['selected']) };
  const destination = { dataset: { cell: '0,0' }, classes: new Set() };
  for (const cell of [origin, destination]) cell.classList = {
    toggle(name, active) { active ? cell.classes.add(name) : cell.classes.delete(name); }
  };
  context.document.querySelectorAll = selector => selector.endsWith('[data-cell]') ? [origin, destination] : [];
  context.inspection = inspectCell(context.state, context.config, { q: 0, r: 0 }, 'mover', context.report);
  assert.equal(context.inspection.isPreview, true);
  context.highlightSources();
  assert.equal(origin.classes.has('selected'), false);
  assert.equal(destination.classes.has('selected'), true);
  assert.equal(origin.classes.has('move-destination'), false);
  assert.equal(destination.classes.has('move-destination'), true);
  context.clearHover();
  assert.equal(origin.classes.has('selected'), true);
  assert.equal(destination.classes.has('selected'), false);
  assert.equal(destination.classes.has('move-destination'), false);
  assert.deepEqual([context.state.pieces[0].q, context.state.pieces[0].r], [0, 1]);
});

test('opponent turns and opponent animations do not highlight selected or moving cells', () => {
  for (const mode of ['bot', 'online']) {
    const { context, node } = setup();
    context.playMode = mode; context.humanTeam = 0; context.roomView = { selfSeat: 0 };
    context.selected = 'mover'; context.state.turn = 1;
    context.boardMarkup();
    assert.doesNotMatch(node('#board').innerHTML, /class="cell[^\"]*\b(selected|move-destination|movement-range)\b/);
    assert.doesNotMatch(node('#board').innerHTML, /own-moving-origin/);
    const cell = { dataset: { cell: '0,1' }, classes: new Set(['selected']) };
    cell.classList = { toggle(name, active) { active ? cell.classes.add(name) : cell.classes.delete(name); } };
    context.document.querySelectorAll = selector => selector.endsWith('[data-cell]') ? [cell] : [];
    context.highlightSources();
    assert.equal(cell.classes.has('selected'), false);
    context.movement = { piece: context.state.pieces[1], action: { to: { q: 2, r: 0 } } };
    context.boardMarkup();
    assert.doesNotMatch(node('#board').innerHTML, /class="cell[^\"]*\b(selected|move-destination|movement-range)\b/);
    assert.doesNotMatch(node('#board').innerHTML, /own-moving-origin/);
    assert.match(node('#board').innerHTML, /class="piece[^\"]*\bmoving-origin\b/);
    // After committing our own move the state turn has already changed, but
    // its animation still belongs to our piece.
    context.movement.piece = context.state.pieces[0];
    context.boardMarkup();
    assert.match(node('#board').innerHTML, /class="cell[^\"]*\bmove-destination\b/);
    assert.match(node('#board').innerHTML, /moving-origin own-moving-origin/);
  }
});
