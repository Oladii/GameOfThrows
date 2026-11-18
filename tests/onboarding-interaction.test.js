import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGuideController } from '../dist/guide-controller.js';
import { UNIT_BATTLE_SCENES } from '../dist/onboarding-showcase.js';

// Small DOM adapter: controllers and renderers are real; only browser plumbing is stubbed.
function setup(audio) {
  const analytics = [];
  const scenes = new Map(), timers = new Map(), classes = new Set();
  let nextTimer = 0, opened = 0, closed = 0, tabs;
  const node = () => ({ hidden: true, innerHTML: '', listeners: {}, attrs: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    setAttribute(name, value) { this.attrs[name] = value; }, focus() {},
    querySelector() { return null; }, querySelectorAll() { return []; } });
  const nodes = Object.fromEntries(['rules-dialog', 'rules-open', 'guide-back', 'onboarding-body', 'onboarding-progress'].map(id => ['#' + id, node()]));
  const root = nodes['#onboarding-body'];
  Object.defineProperty(root, 'innerHTML', { set(html) {
    scenes.clear();
    const starts = [...html.matchAll(/<section class="showcase-scene[^>]*data-showcase-battle="([^"]+)"/g)];
    starts.forEach((m, index) => {
      const scene = node(); scene.dataset = { showcaseBattle: m[1] };
      scene.html = html.slice(m.index, starts[index + 1]?.index ?? html.length);
      Object.defineProperty(scene, 'outerHTML', { set(value) { scene.html = value; } });
      scene.querySelector = () => node();
      scenes.set(m[1], scene);
    });
    this.html = html;
  }, get() { return this.html; } });
  root.querySelector = selector => scenes.get(selector.match(/data-showcase-battle="([^"]+)"/)?.[1]) || null;
  const doc = { querySelector: selector => nodes[selector], activeElement: null,
    createElement: () => ({ content: { querySelector: () => node() }, innerHTML: '' }),
    body: { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } } };
  const win = { scrollY: 235, scrollTo(x, y) { this.scrollY = y; }, matchMedia: () => ({ matches: true }),
    gameTabs: { render(labels, selected, change) { tabs = { labels, selected, change }; } } };
  const controller = createGuideController({ audio, onAnalytics:(type,extra)=>analytics.push({type,...extra}), document: doc, window: win, beforeOpen: () => opened++, onClose: () => closed++,
    clock: { setTimer(fn) { timers.set(++nextTimer, fn); return nextTimer; }, clearTimer: id => timers.delete(id) } });
  const control = (key, data) => ({ dataset: data, closest(selector) {
    if (selector === '[data-showcase-battle]') return scenes.get(key);
    if (selector === '[data-showcase-cell]') return data.showcaseCell !== undefined ? this : null;
    return this;
  } });
  return { controller, nodes, win, classes, scenes, timers, analytics, tabs: () => tabs,
    calls: () => ({ opened, closed }), html: key => scenes.get(key)?.html || '',
    click(key, data, keyboard = false) {
      const target = control(key, data);
      root.listeners[keyboard ? 'keydown' : 'click']({ target, key: 'Enter', preventDefault() {} });
    },
    flush() {
      let remaining = 80;
      while (timers.size && remaining-- > 0) {
        const [id, fn] = [...timers][0]; timers.delete(id); fn();
      }
      assert.ok(remaining > 0, 'timers must settle');
    }
  };
}

test('guide opens as a separate screen and Back restores the game scroll position', () => {
  const ui = setup();
  ui.nodes['#rules-open'].listeners.click();
  assert.equal(ui.nodes['#rules-dialog'].hidden, false);
  assert.ok(ui.classes.has('guide-open'));
  assert.equal(ui.win.scrollY, 0);
  assert.deepEqual(ui.tabs().labels, ['Цель игры', 'Фигуры']);
  assert.match(ui.html('main'), /Учебный бой/);
  assert.doesNotMatch(ui.html('main'), /data-showcase-action="(?:undo|previous|next)"/);
  ui.nodes['#guide-back'].listeners.click();
  assert.equal(ui.nodes['#rules-dialog'].hidden, true);
  assert.equal(ui.classes.has('guide-open'), false);
  assert.equal(ui.win.scrollY, 235);
  assert.deepEqual(ui.calls(), { opened: 1, closed: 1 });
});

test('clicking the selected tutorial piece or its cell plays the soft click', () => {
  const softClicks = [];
  const ui = setup({ stopAll() {}, click(key, { soft }) { softClicks.push(soft); } });
  ui.controller.open();
  ui.click('main', { showcasePiece: 's-shield-right' });
  ui.click('main', { showcasePiece: 's-shield-right' });
  ui.click('main', { showcaseCell: '-1,1' });
  ui.click('main', { showcaseCell: '-1,1' });
  ui.click('main', { showcasePiece: 's-shield-right' });
  ui.click('main', { showcaseCell: '1,1' }); // Reachable preview keeps the selection.
  ui.click('main', { showcaseCell: '-3,0' }); // Unreachable empty cell clears it.
  ui.click('main', { showcaseCell: '-3,0' });
  assert.deepEqual(softClicks, [false, true, false, true, false, false, true, false]);
});

test('tutorial accepts its guided move, pauses after the enemy and resumes only with Дальше', () => {
  const ui = setup(); ui.controller.open();
  ui.click('main', { showcasePiece: 's-shield-right' });
  ui.click('main', { showcaseCell: '-1,0' });
  assert.match(ui.html('main'), /data-ply="0"/);
  ui.click('main', { showcaseCell: '-1,1' }, true);
  ui.click('main', { showcaseCell: '-1,0' }, true); ui.flush();
  assert.match(ui.html('main'), /data-phase="awaiting-combat"/);
  assert.match(ui.html('main'), /data-showcase-action="continue">Дальше/);
  assert.equal(ui.timers.size, 0);
  ui.controller.goToStep(1); ui.controller.goToStep(0);
  assert.match(ui.html('main'), /data-phase="awaiting-combat"/);
  ui.click('main', { showcaseAction: 'continue' }); ui.flush();
  assert.match(ui.html('main'), /data-ply="2"/);
  ui.click('main', { showcasePiece: 's-shield-left' });
  ui.click('main', { showcaseCell: '0,-1' }); ui.flush();
  assert.match(ui.html('main'), /Победа!/);
  assert.match(ui.html('main'), /Сыграть ещё раз/);
  ui.click('main', { showcaseAction: 'restart' });
  assert.match(ui.html('main'), /data-ply="0"/);
});

test('seven demos keep their own positions, restart independently and reset on reopening', () => {
  const ui = setup(); ui.controller.open(); ui.tabs().change(1);
  assert.deepEqual([...ui.scenes.keys()], UNIT_BATTLE_SCENES);
  ui.click('unit-archer-veteran', { showcasePiece: 'blue' });
  ui.click('unit-archer-veteran', { showcaseCell: '0,-3' }); ui.flush();
  assert.match(ui.html('unit-archer-veteran'), /data-ply="1"/);
  assert.match(ui.html('unit-archer-veteran'), /уничтожил знамя/);
  for (const key of UNIT_BATTLE_SCENES.filter(key => key !== 'unit-archer-veteran')) assert.match(ui.html(key), /data-ply="0"/);
  ui.click('unit-shield', { showcaseAction: 'restart' });
  assert.match(ui.html('unit-archer-veteran'), /data-ply="1"/);
  ui.controller.close(); ui.controller.open(); ui.controller.goToStep(1);
  assert.match(ui.html('unit-archer-veteran'), /data-ply="0"/);
});

test('closing cancels pending enemy replies and stale callbacks cannot change the reopened guide', () => {
  const ui = setup(); ui.controller.open();
  ui.click('main', { showcasePiece: 's-shield-left' }); ui.click('main', { showcaseCell: '-1,0' });
  const stale = [...ui.timers.values()];
  assert.ok(stale.length);
  ui.controller.close(); assert.equal(ui.timers.size, 0);
  ui.controller.open(); const fresh = ui.html('main');
  stale.forEach(fn => fn());
  assert.equal(ui.html('main'), fresh);
  assert.equal(ui.timers.size, 0);
});

test('guide module has no dependency on real game storage, archive or bot', () => {
  const source = fs.readFileSync(new URL('../dist/guide-controller.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|archiveRecorder|BotRunner|onboarding-examples/);
});

test('real-game bot waits while the guide is open, including an already scheduled callback', async () => {
  const vm = await import('node:vm');
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  let scheduled, starts = 0;
  const guide = { hidden: false };
  const context = vm.createContext({ ready: true, isBotTurn: () => true, movement: null, combat: null,
    currentDeaths: [], reviewingTurn: false, botIssue: '', botSuspended: false, botRunner: { active: false }, botTimer: null,
    $: selector => selector === '#rules-dialog' ? guide : null,
    setTimeout(fn) { scheduled = fn; return 1; }, startBot() { starts++; } });
  vm.runInContext(app.slice(app.indexOf('function queueBot()'), app.indexOf('function startBot()')), context);
  context.queueBot(); assert.equal(scheduled, undefined);
  guide.hidden = true; context.queueBot(); assert.equal(typeof scheduled, 'function');
  guide.hidden = false; scheduled(); assert.equal(starts, 0);
});

test('real-game keyboard commands cannot change the hidden match while learning', async () => {
  const vm = await import('node:vm');
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  let handler;
  const context = vm.createContext({ document: { addEventListener(type, fn) { handler = fn; } },
    $: () => ({ hidden: false }),
    deleteEditorSelection() { assert.fail('hidden game editor must not receive guide keys'); },
    render() { assert.fail('guide keys must not render or advance the hidden match'); } });
  vm.runInContext(app.split('\n').find(line => line.startsWith("document.addEventListener('keydown'") && line.includes('deleteEditorSelection(event)')), context);
  for (const key of ['Escape', 'Backspace', 'z']) handler({ key, ctrlKey: key === 'z' });
});


test('analytics separates opening the guide from finishing a lesson and deduplicates rerenders', () => {
  const ui=setup();ui.controller.open();
  assert.deepEqual(ui.analytics,[{type:'tutorial_open'}]);
  ui.controller.goToStep(1);
  ui.click('unit-archer-veteran',{showcasePiece:'blue'});
  ui.click('unit-archer-veteran',{showcaseCell:'0,-3'});ui.flush();
  assert.deepEqual(ui.analytics[1],{type:'lesson_complete',lesson:'unit-archer-veteran'});
  ui.controller.goToStep(0);ui.controller.goToStep(1);
  assert.equal(ui.analytics.filter(e=>e.type==='lesson_complete').length,1);
});
