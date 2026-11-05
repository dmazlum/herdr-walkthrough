import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeComponents, componentEvidence } from '../mods/walkthrough/lib/blueprint.js';
import { buildDigest } from '../mods/walkthrough/lib/digest.js';
import { normalize, PROMPT_VERSION, SCHEMA } from '../mods/walkthrough/lib/walkthrough.js';
import { recapMarkdown } from '../mods/walkthrough/lib/export.js';
import { buildPrompt } from '../mods/walkthrough/lib/prompt.js';

const mermaid = 'flowchart TB\nA["Existing module"]\nB["New module"]\nC["External context"]\nA --> B\nC --> A';
const files = [{ path: 'src/a.js', status: 'modified', aliases: ['h1'] }, { path: 'src/b.js', status: 'added', aliases: ['h2'] }];
const aliases = { h1: 'id1', h2: 'id2' };
const components = () => [
  { id: 'A', status: 'modified', responsibility: 'Delegates work.', change: 'Uses the new module.', paths: ['src/a.js'], hunks: ['h1'] },
  { id: 'B', status: 'added', responsibility: 'Keeps pending work.', change: 'New implementation.', paths: ['src/b.js'], hunks: ['h2'] },
  { id: 'C', status: 'context', responsibility: 'An existing external caller.', change: '', paths: [], hunks: [] },
];
const norm = (raw = components(), f = files) => normalizeComponents(raw, mermaid, aliases, f);

test('component identities, status and exact source evidence survive report normalization', () => {
  const raw = { title: 'Modules', parts: [{ steps: [{ hunks: ['h1'], text: 'Delegates work.' }] }],
    recap: { changes: [{ description: 'Changed modules.', motivation: 'Use a queue.', paths: files.map((f) => f.path) }],
      architecture: { description: 'Caller delegates.', mermaid, components: components() } } };
  const w = normalize(raw, aliases, files);
  assert.deepEqual(w.recap.architecture.components, norm());
  assert.deepEqual(norm()[0].hunkIds, ['id1']);
  assert.equal(norm()[1].status, 'added');
  assert.deepEqual(norm()[2].hunkIds, []);
});

test('invented IDs, duplicate nodes, missing nodes and unsupported status are rejected', () => {
  for (const mutate of [
    (c) => c.pop(), (c) => { c[0].id = 'Unknown'; }, (c) => { c[1].id = 'A'; },
    (c) => { c[0].status = 'removed'; }, (c) => { c[0].responsibility = ''; },
  ]) { const c = components(); mutate(c); assert.throws(() => norm(c), /Blueprint:/); }
});

test('source anchors must exist and belong to exactly the declared paths', () => {
  for (const mutate of [
    (c) => { c[0].hunks = ['h9']; }, (c) => { c[0].hunks = ['h2']; },
    (c) => { c[0].paths = ['invented.js']; }, (c) => { c[0].paths.push('src/b.js'); },
    (c) => { c[0].hunks = []; }, (c) => { c[0].change = ''; },
    (c) => { c[0].hunks = ['toString']; },
  ]) { const c = components(); mutate(c); assert.throws(() => norm(c), /Blueprint:/); }
});

test('Added needs added-file evidence and Context cannot claim changes', () => {
  const c = components(); c[0].status = 'added';
  assert.throws(() => norm(c), /newly added source/);
  assert.throws(() => norm(components(), files.map((f) => ({ ...f, status: 'modified' }))), /newly added source/);
  for (const mutate of [
    (c) => { c[2].change = 'An unsupported change'; },
    (c) => { c[2].paths = ['src/a.js']; }, (c) => { c[2].hunks = ['h1']; },
  ]) { const c = components(); mutate(c); assert.throws(() => norm(c), /context must not claim/); }
  assert.throws(() => norm(components(), [{ ...files[0], status: 'deleted' }, files[1]]), /deleted source/);
});

test('source resolution distinguishes scopes and detects stale or moved evidence', () => {
  const component = { ...norm()[0], hunkIds: ['id1', 'id-staged'] };
  const live = [
    { path: 'src/a.js', scope: 'working', hunks: [{ id: 'id1' }] },
    { path: 'src/a.js', scope: 'staged', hunks: [{ id: 'id-staged' }] },
  ];
  assert.equal(componentEvidence(component, live).found.length, 2);
  assert.equal(componentEvidence(component, live).missing, 0);
  assert.equal(componentEvidence(component, live.slice(0, 1)).missing, 1);
  assert.equal(componentEvidence(component, [{ ...live[0], path: 'wrong.js' }]).missing, 2);
  assert.deepEqual(componentEvidence(undefined, live), { found: [], missing: 0 });
});

test('digest retains added/modified status for conservative classification', () => {
  const d = buildDigest([{ scope: 'working', patch: 'diff --git a/src/b.js b/src/b.js\nnew file mode 100644\n--- /dev/null\n+++ b/src/b.js\n@@ -0,0 +1 @@\n+export const queue = [];\n' }]);
  assert.equal(d.digestFiles[0].status, 'added');
});

test('new generations require components; legacy diagrams stay unclassified and readable', () => {
  assert.equal(PROMPT_VERSION, 7);
  assert.ok(SCHEMA.properties.recap.properties.architecture.required.includes('components'));
  assert.equal(normalizeComponents(undefined, mermaid, aliases, files), undefined);
  const p = buildPrompt({ digest: 'diff', fileCount: 2, hunkCount: 2, what: 'Changes' });
  assert.match(p.system, /exactly one entry per Mermaid node/);
  assert.match(p.system, /newly added in the digest/);
});

test('Markdown preserves component meaning and files without leaking internal anchors', () => {
  const recap = { changes: [], architecture: { description: 'Flow', mermaid, components: norm() } };
  const md = recapMarkdown(recap);
  assert.match(md, /A · Modified/); assert.match(md, /B · Added/); assert.match(md, /C · Context/);
  assert.match(md, /`src\/a.js`/); assert.match(md, /Uses the new module/);
  assert.doesNotMatch(md, /id1|id2/);
  assert.doesNotMatch(recapMarkdown(recap, { diagram: false, architecture: false }), /#### Components/);
});
