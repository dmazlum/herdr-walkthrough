import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blueprintFileTargets } from '../mods/walkthrough/lib/navigation.js';
const file = { path: 'src/queue.js', scope: 'working', hunks: [{ id: 'h1' }, { id: 'h2' }] };
const component = { paths: [file.path], hunkIds: ['h2'] };
const step = (id, title, ids) => ({ id, title, hunkIds: ids, found: ids.map((id) => ({ file, hunk: { id } })) });
const view = { steps: [step('s1', 'Setup', ['h1']), step('s2', 'Queue behavior', ['h2'])], uncovered: [] };
const w = { contracts: [{ kind: 'api', changes: [{ hunkIds: ['h2'] }] }] };

test('file links navigate to the step for component evidence, accounting for contract pages', () => {
  const targets = blueprintFileTargets(w, view, [file], component, file.path);
  assert.equal(targets[0].index, 3); assert.equal(targets[0].title, 'Queue behavior');
  assert.equal(targets[1].title, 'Setup');
  assert.equal(targets[2].kind, 'contract');
});
test('files shared by several steps use a stable reading order', () => {
  const targets = blueprintFileTargets({}, view, [file], { ...component, hunkIds: ['h1', 'h2'] }, file.path);
  assert.deepEqual(targets.map((t) => t.title), ['Setup', 'Queue behavior']);
});
test('single-file stale components can still navigate to their saved outdated step', () => {
  const stale = { ...view, steps: view.steps.map((s) => ({ ...s, found: [] })) };
  assert.equal(blueprintFileTargets({}, stale, [], component, file.path)[0].title, 'Queue behavior');
});
test('multi-file components never confuse another file\'s supporting hunks', () => {
  const other = { path: 'other.js', hunks: [{ id: 'other' }] };
  const multi = { paths: [file.path, other.path], hunkIds: ['h2', 'other'] };
  const v = { steps: [step('s0', 'Wrong file', ['other']), ...view.steps], uncovered: [] };
  v.steps[0].found = [{ file: other, hunk: other.hunks[0] }];
  assert.equal(blueprintFileTargets({}, v, [file, other], multi, file.path)[0].title, 'Queue behavior');
  assert.deepEqual(blueprintFileTargets({}, v, [], multi, 'missing.js'), []);
});
test('contract-only files and Not covered files have meaningful destinations', () => {
  const v = { steps: [], uncovered: [{ file, hunks: file.hunks }] };
  assert.equal(blueprintFileTargets(w, v, [file], component, file.path)[0].kind, 'contract');
  assert.equal(blueprintFileTargets({}, v, [file], component, file.path)[0].kind, 'tail');
  assert.deepEqual(blueprintFileTargets({}, { steps: [], uncovered: [] }, [], component, file.path), []);
  assert.deepEqual(blueprintFileTargets(w, view, [file], undefined, file.path), []);
  assert.deepEqual(blueprintFileTargets(w, null, [file], component, file.path), []);
});
