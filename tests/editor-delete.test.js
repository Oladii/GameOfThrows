import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const handler = app.slice(app.indexOf('function deleteEditorSelection('), app.indexOf('function onCell('));
function setup() {
  const history = [], state = { pieces: [{ id: 'own' }, { id: 'enemy' }], winner: 1 };
  const context = vm.createContext({ editor: true, selected: 'enemy', state, inspection: {}, hover: {},
    document: { activeElement: { tagName: 'BODY' } }, $: () => null,
    checkpoint: () => history.push(structuredClone(state)), render() {} });
  vm.runInContext(handler, context);
  return { context, history, key: (extra = {}) => {
    const event = { key: 'Backspace', preventDefault() { this.prevented = true; }, ...extra };
    context.deleteEditorSelection(event); return event;
  } };
}
test('Backspace removes the selected setup piece and checkpoints it for undo', () => {
  const { context, history, key } = setup();
  assert.equal(key().prevented, true);
  assert.deepEqual(Array.from(context.state.pieces, p => p.id), ['own']);
  assert.equal(context.selected, null);
  assert.equal(context.inspection, null);
  assert.equal(context.state.winner, null);
  assert.equal(history[0].pieces.length, 2);
  key(); assert.equal(history.length, 1);
});
test('Backspace preserves text, dialogs and pieces during play', () => {
  for (const override of [
    { editor: false }, { selected: null }, { $: () => ({}) },
    ...['INPUT', 'SELECT', 'TEXTAREA'].map(tagName => ({ document: { activeElement: { tagName } } })),
    { document: { activeElement: { isContentEditable: true } } }
  ]) {
    const { context, history, key } = setup(); Object.assign(context, override);
    assert.equal(key().prevented, undefined);
    assert.equal(context.state.pieces.length, 2); assert.equal(history.length, 0);
  }
});
