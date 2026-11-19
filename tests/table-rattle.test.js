import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { sampleTableRattle, sampleTableShake, tableRattlePhase, TableRattle, TableRattleAnimator,
  TABLE_RATTLE_DURATION, TABLE_RATTLE_REDUCED_DURATION, TABLE_RATTLE_SETTLED_AT,
  TABLE_RATTLE_DISAPPEAR_AT, TABLE_RATTLE_FADE_DURATION, TABLE_RATTLE_RETURN_AT } from '../dist/table-rattle.js';

const piece = Object.freeze({ dx: 60, dy: -30, lift: 20, rotation: 12, delay: 40 });

test('pieces rest for at least a second after landing, disappear, and reveal at their exact origin', () => {
  const before = JSON.stringify(piece);
  const initial = sampleTableRattle(0, piece);
  assert.equal(Math.abs(initial.x), 0); assert.equal(Math.abs(initial.y), 0);
  assert.equal(Math.abs(initial.groundY), 0); assert.equal(initial.opacity, 1); assert.equal(initial.scale, 1);
  const flight = sampleTableRattle(250, piece);
  assert.ok(flight.x > 0 && flight.x < piece.dx);
  assert.ok(flight.y < flight.groundY && flight.shadowScale < 1 && flight.scale > 1);
  const landed = sampleTableRattle(TABLE_RATTLE_SETTLED_AT, piece);
  assert.equal(landed.x, piece.dx); assert.equal(landed.groundY, piece.dy);
  assert.equal(landed.opacity, 1); assert.equal(landed.rotation, piece.rotation);
  assert.ok(TABLE_RATTLE_DISAPPEAR_AT - TABLE_RATTLE_SETTLED_AT >= 1000);
  for (const delay of [0, 65]) {
    for (const t of [TABLE_RATTLE_SETTLED_AT, TABLE_RATTLE_SETTLED_AT + 1000, TABLE_RATTLE_DISAPPEAR_AT - 1]) {
      const frame = sampleTableRattle(t, { ...piece, delay });
      assert.equal(frame.opacity, 1); assert.equal(frame.x, piece.dx);
      assert.ok(Math.abs(frame.y - piece.dy) < 1e-8); assert.equal(frame.scale, 1);
      assert.equal(tableRattlePhase(t), 'rest');
    }
  }
  const disappearing = sampleTableRattle(TABLE_RATTLE_DISAPPEAR_AT + TABLE_RATTLE_FADE_DURATION / 2, piece);
  assert.ok(disappearing.opacity > 0 && disappearing.opacity < 1);
  assert.ok(disappearing.scale < 1);
  assert.equal(sampleTableRattle(TABLE_RATTLE_DISAPPEAR_AT + TABLE_RATTLE_FADE_DURATION, piece).opacity, 0);
  assert.equal(tableRattlePhase(TABLE_RATTLE_DISAPPEAR_AT), 'disappear');
  assert.equal(sampleTableRattle(TABLE_RATTLE_RETURN_AT - 1, piece).opacity, 0);
  const reveal = sampleTableRattle(TABLE_RATTLE_RETURN_AT + 200, piece);
  assert.equal(reveal.x, 0); assert.ok(reveal.opacity > 0 && reveal.opacity < 1);
  assert.deepEqual(sampleTableRattle(TABLE_RATTLE_DURATION, piece), { x: 0, y: 0, groundY: 0, rotation: 0, scale: 1, opacity: 1, shadowScale: 1 });
  assert.equal(JSON.stringify(piece), before);
});

test('touchdown carries momentum into a decelerating slide with the shadow on the board', () => {
  const contact = piece.delay + 300;
  const at = offset => sampleTableRattle(contact + offset, piece);
  assert.ok(at(-1).y < at(-1).groundY);
  const landingSpeed = at(0).x - at(-1).x;
  assert.ok(Math.abs((at(1).x - at(0).x) / landingSpeed - 1) < .01);
  const frames = [0, 50, 100, 150, 200].map(at);
  let previousStep = Infinity;
  for (const [i, frame] of frames.entries()) {
    assert.equal(frame.y, frame.groundY);
    assert.equal(frame.shadowScale, 1);
    if (i === 0) continue;
    const step = frame.x - frames[i - 1].x;
    assert.ok(step > 0 && step < previousStep);
    assert.ok(frame.rotation > frames[i - 1].rotation);
    previousStep = step;
  }
  assert.deepEqual(at(230), at(400));
});

test('table shake settles in 250ms and reduced motion has no spatial movement', () => {
  assert.notEqual(sampleTableShake(35).x, 0);
  assert.ok(Math.abs(sampleTableShake(230).x) < Math.abs(sampleTableShake(35).x));
  assert.deepEqual(sampleTableShake(250), { x: 0, y: 0, rotation: 0 });
  for (const t of [0, 75, 150, 220, 300, 450]) {
    assert.deepEqual(sampleTableShake(t, true), { x: 0, y: 0, rotation: 0 });
    const frame = sampleTableRattle(t, piece, true);
    assert.equal(frame.x, 0); assert.equal(frame.y, 0); assert.equal(frame.rotation, 0); assert.equal(frame.scale, 1);
  }
  assert.equal(sampleTableRattle(TABLE_RATTLE_DISAPPEAR_AT - 1, piece, true).opacity, 1);
  assert.equal(sampleTableRattle(TABLE_RATTLE_DISAPPEAR_AT + 200, piece, true).opacity, 0);
  assert.equal(sampleTableRattle(TABLE_RATTLE_REDUCED_DURATION, piece, true).opacity, 1);
});

function animatorHarness() {
  let now = 0, serial = 0, finishes = 0;
  const pending = new Map(), frames = [];
  const animator = new TableRattleAnimator((t, reduced) => frames.push({ t, reduced }), () => finishes++, {
    now: () => now, requestFrame: callback => { pending.set(++serial, callback); return serial; },
    cancelFrame: handle => pending.delete(handle)
  });
  return { animator, pending, frames, time: value => { now = value; }, finishes: () => finishes };
}

test('cancellation and repeated launches cannot run stale frames or restore an old board', () => {
  const h = animatorHarness(); h.animator.start(); const stale = [...h.pending.values()][0];
  h.animator.cancel(); h.time(900); stale(); assert.equal(h.frames.length, 1); assert.equal(h.finishes(), 0);
  h.animator.start(); stale(); assert.equal(h.frames.length, 2);
  const current = [...h.pending.values()].at(-1);
  h.time(900 + TABLE_RATTLE_DURATION); current(); current(); stale();
  assert.equal(h.finishes(), 1); assert.equal(h.animator.active, false);
  assert.equal(h.frames.at(-1).t, TABLE_RATTLE_DURATION);
});

test('reduced motion keeps the rest/disappear sequence and finishes cleanly', () => {
  const h = animatorHarness(); h.animator.start(true);
  const tick = [...h.pending.values()].at(-1); h.time(TABLE_RATTLE_REDUCED_DURATION); tick();
  assert.equal(h.finishes(), 1); assert.equal(h.animator.active, false);
  assert.deepEqual(h.frames.at(-1), { t: TABLE_RATTLE_REDUCED_DURATION, reduced: true });
});

test('removal sound runs once after the rest, with no extra death markup and a per-piece shadow', () => {
  for (const reduced of [false, true]) {
    let sounds = 0;
    const attrs = {}, shadowAttrs = {}, body = { style: {} };
    const token = { ...piece, x: 30, y: 50, body,
      wrapper: { setAttribute: (name, value) => { attrs[name] = value; } },
      shadow: { setAttribute: (name, value) => { shadowAttrs[name] = value; } } };
    const context = { scene: { tokens: [token] },
      doc: { createElementNS: () => { throw Error('no death or skull layer should be created'); } },
      surface: { style: {} }, board: { dataset: {} },
      onDisappear: () => { sounds++; return () => {}; } };
    TableRattle.prototype.paint.call(context, 250, reduced);
    const flightShadow = body.style.filter;
    for (const t of [520, 1000, TABLE_RATTLE_DISAPPEAR_AT - 1]) TableRattle.prototype.paint.call(context, t, reduced);
    assert.equal(sounds, 0); assert.equal(attrs.opacity, '1');
    assert.equal(body.style.filter, 'drop-shadow(1px 2px 1.4px #3025183d)');
    assert.ok(Number(shadowAttrs.opacity) > 0);
    if (!reduced) assert.notEqual(flightShadow, body.style.filter);
    for (const t of [TABLE_RATTLE_DISAPPEAR_AT, TABLE_RATTLE_DISAPPEAR_AT + 100, TABLE_RATTLE_RETURN_AT]) TableRattle.prototype.paint.call(context, t, reduced);
    assert.equal(sounds, 1);
    for (const t of [TABLE_RATTLE_DISAPPEAR_AT + TABLE_RATTLE_FADE_DURATION,
      TABLE_RATTLE_RETURN_AT - 1, TABLE_RATTLE_RETURN_AT, TABLE_RATTLE_RETURN_AT + 200,
      reduced ? TABLE_RATTLE_REDUCED_DURATION : TABLE_RATTLE_DURATION]) {
      TableRattle.prototype.paint.call(context, t, reduced);
      assert.equal(body.style.filter, 'none', 'contact shadow never returns after removal');
      assert.equal(shadowAttrs.opacity, '0', 'ground shadow never returns after removal');
    }
    assert.equal(attrs.opacity, '1', 'pieces finish returning without effect shadows');
  }
});

test('hovering a hex during scatter plays its hover cue without starting a move forecast', () => {
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const cues = [];
  const ctx = vm.createContext({ tableRattle: { active: true }, boardDrag: null, restoringBoardFocus: false,
    combat: null, movement: null, gameAudio: { hover: key => cues.push(key) } });
  vm.runInContext(app.slice(app.indexOf('function hoverCell('), app.indexOf('function clearHover(')), ctx);
  const target = { closest: () => ({ dataset: { cell: '1,0' } }) };
  ctx.hoverCell({ type: 'pointermove', pointerType: 'mouse', target });
  ctx.hoverCell({ type: 'pointermove', pointerType: 'touch', target });
  assert.deepEqual(cues, ['board:1,0']);
});

test('presentation blocks player moves and cell clicks without changing a position', () => {
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const declaration = name => {
    const start = app.indexOf(`function ${name}(`), end = app.indexOf('\n', start);
    return app.slice(start, app.slice(start, end).endsWith('}') ? end : app.indexOf('\n}', end) + 2);
  };
  const state = { pieces: [], winner: null }, original = JSON.stringify(state);
  const ctx = vm.createContext({ state, tableRattle: { active: true }, gamePhase: 'playing', roomMovePreview: null,
    movement: null, combat: null, currentDeaths: [], reviewingTurn: false, reviewLoading: false,
    isBotTurn: () => false, playMode: 'local', roomView: null, visibleState: () => { throw Error('cell activation must be blocked'); } });
  for (const name of ['humanCanMove', 'onCell', 'activateBoardCell']) vm.runInContext(declaration(name), ctx);
  assert.equal(ctx.humanCanMove(), false); ctx.onCell(0, 0); ctx.activateBoardCell(0, 0);
  assert.equal(JSON.stringify(state), original);
  ctx.tableRattle.active = false; assert.equal(ctx.humanCanMove(), true);
});

test('a re-render cancels the presentation before any replacement board markup', () => {
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function render(deaths = [], restoredIds) {'), end = app.indexOf('\n}', start) + 2;
  const reached = new Error('normal rendering reached'); let cancellations = 0;
  const ctx = vm.createContext({ boardDrag: null, tableRattle: { cancel() { cancellations++; } }, tableKnocks: { reset() {} },
    previousGame: null, hint: null, renderHint() {}, renderUpdateNotice() { throw reached; } });
  vm.runInContext(app.slice(start, end), ctx);
  assert.throws(() => ctx.render(), error => error === reached);
  assert.equal(cancellations, 1);
});
