import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { analyze, inspectCell, cells, key } from '../dist/engine.js';
import { inspectionIncomingArrows, inspectionDamageArrows, renderDamageArrows, hexGridPoint } from '../dist/board-presentation.js';
import { createShowcaseBattle, renderShowcaseBattle } from '../dist/onboarding-showcase.js';

const p = (id, type, team, q, r) => ({ id, type, team, q, r });
const selected = p('selected', 'shield', 1, 3, -1);
const enemy = p('enemy', 'shield', 0, 0, 0);
const position = { turn: 1, ply: 0, winner: null, pieces: [selected, enemy,
  p('ally-a', 'archer', 1, 0, -2), p('ally-b', 'archer', 1, -2, 0), p('incoming', 'archer', 0, 3, -3)] };
const report = analyze(position, DEFAULT_CONFIG);

test('hovering an enemy while an unrelated ally is selected shows every allied contributor', () => {
  const arrows = inspectionIncomingArrows(enemy, position, report);
  assert.deepEqual(arrows.filter(a => a.target.id === enemy.id).map(a => a.source.id).sort(), ['ally-a', 'ally-b']);
  assert.ok(arrows.every(a => a.target.id === enemy.id));
  assert.deepEqual(inspectionIncomingArrows(null, position, report), []);
  assert.equal(new Set(arrows.map(a => `${a.source.id}:${a.target.id}`)).size, arrows.length);
});

test('hovering either team inspects only that unit', () => {
  const selectedArrows = inspectionIncomingArrows(selected, position, report);
  assert.ok(selectedArrows.length > 0);
  assert.ok(selectedArrows.every(a => a.target.id === selected.id));
  const hovered = inspectionIncomingArrows(enemy, position, report);
  assert.deepEqual(hovered.map(a => a.source.id).sort(), ['ally-a', 'ally-b']);
});

test('movement preview keeps incoming arrows aimed at the preview position', () => {
  const preview = inspectCell(position, DEFAULT_CONFIG, { q: 2, r: -1 }, selected.id);
  assert.equal(preview.isPreview, true);
  const arrows = inspectionIncomingArrows(preview.piece, preview.position, preview.report);
  assert.equal(arrows.length, preview.report.get(selected.id).attackers.length);
  for (const arrow of arrows) assert.deepEqual([arrow.target.q, arrow.target.r], [2, -1]);
});

test('live board draws only hovered incoming arrows and clears them during motion or combat', () => {
  const source = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const layer = { innerHTML: '' };
  const context = vm.createContext({ config: DEFAULT_CONFIG, selected: selected.id, hover: null,
    playMode: 'local', humanTeam: 1, movement: null, combat: null, report,
    inspectionContext: () => ({ piece: enemy, position, report, isPreview: false }),
    inspectionIncomingArrows, inspectionDamageArrows, renderDamageArrows, cells, key,
    document: { querySelectorAll: () => [] }, $: () => layer,
    point: hexGridPoint, paintAttackReach() {}, renderInspector() {} });
  vm.runInContext(source.slice(source.indexOf('function highlightSources()'), source.indexOf('function paintAttackReach(')), context);
  context.highlightSources();
  assert.doesNotMatch(layer.innerHTML, /class="attack-ray"/);
  context.hover = '0,0'; context.highlightSources();
  assert.equal((layer.innerHTML.match(/class="attack-ray"/g) || []).length, 2);
  assert.match(layer.innerHTML, /data-source="ally-a" data-target="enemy"/);
  assert.match(layer.innerHTML, /data-source="ally-b" data-target="enemy"/);
  for (const mode of ['movement', 'combat']) {
    context[mode] = {}; context.highlightSources(); assert.equal(layer.innerHTML, ''); context[mode] = null;
  }
  context.hover = null; context.highlightSources();
  assert.doesNotMatch(layer.innerHTML, /class="attack-ray"/);
});

test('training uses the same hover-only behavior', () => {
  const battle = { ...createShowcaseBattle(), config: DEFAULT_CONFIG, position, selectedId: selected.id };
  assert.doesNotMatch(renderShowcaseBattle(battle), /class="attack-ray"/);
  battle.hoverCell = { q: enemy.q, r: enemy.r };
  const html = renderShowcaseBattle(battle);
  assert.equal((html.match(/class="attack-ray"/g) || []).length, 2);
  battle.hoverCell = null;
  assert.doesNotMatch(renderShowcaseBattle(battle), /class="attack-ray"/);
});
