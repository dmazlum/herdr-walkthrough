import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGroups } from '../mods/walkthrough/lib/groups.js';
import { parseMermaid, layoutDiagram, mermaidWithConnections } from '../mods/walkthrough/lib/diagram.js';
import { normalize, SCHEMA, PROMPT_VERSION } from '../mods/walkthrough/lib/walkthrough.js';
import { recapMarkdown } from '../mods/walkthrough/lib/export.js';
import { buildPrompt } from '../mods/walkthrough/lib/prompt.js';
const source = 'flowchart TB\nA["Panel"]\nB["Engine"]\nC["Cache"]\nD["External context"]\nA --> B\nB --> C\nB --> D';
const files = [{ path: 'app.js', status: 'modified', aliases: ['h1', 'h2'] }, { path: 'cache.js', status: 'added', aliases: ['h3'] }];
const aliases = { h1: 'id1', h2: 'id2', h3: 'id3' };
const components = [{ id: 'A', hunkIds: ['id1'] }, { id: 'B', hunkIds: ['id2'] }, { id: 'C', hunkIds: ['id3'] }, { id: 'D', hunkIds: [] }];
const raw = () => [
  { id: 'App', title: 'Application', nodes: ['A', 'B'], reason: 'The panel and engine share the application module.', hunks: ['h1', 'h2'] },
  { id: 'Data', title: 'Storage', nodes: ['C'], reason: 'The cache owns persisted state.', hunks: ['h3'] },
];
const norm = (groups = raw()) => normalizeGroups(groups, source, components, aliases, files);
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const contains = (a, b) => b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;

test('boundaries preserve exact membership, explanation and real source evidence', () => {
  const groups = norm();
  assert.deepEqual(groups[0].nodes, ['A', 'B']);
  assert.deepEqual(groups[0].hunkIds, ['id1', 'id2']);
  assert.deepEqual(groups[0].paths, ['app.js']);
  assert.equal(groups[1].reason, raw()[1].reason);
  assert.equal(normalizeGroups(undefined, source, components, aliases, files), undefined);
  assert.deepEqual(norm([]), []);
});

test('invented, duplicate, colliding and evidence-free group members are refused', () => {
  for (const mutate of [
    (g) => { g[0].nodes.push('Unknown'); }, (g) => { g[1].nodes.push('A'); },
    (g) => { g[0].nodes.push('A'); }, (g) => { g[0].id = 'A'; },
    (g) => { g[1].id = 'App'; }, (g) => { g[0].id = 'bad id'; },
    (g) => { g[0].nodes.push('D'); }, (g) => { g[0].hunks = ['h1']; },
    (g) => { g[0].hunks = ['invented']; }, (g) => { g[0].hunks = ['toString']; },
    (g) => { g[0].hunks = []; }, (g) => { g[0].reason = ''; }, (g) => { g[0].nodes = []; },
  ]) { const groups = raw(); mutate(groups); assert.throws(() => norm(groups), /Group:/); }
  assert.throws(() => normalizeGroups(raw(), source, components, aliases, files.map((f) => ({ ...f, status: 'deleted' }))), /resulting code/);
  for (const title of ['<script>', 'x"y', 'x|y', '`x`', 'a\nb', 'x'.repeat(49)]) {
    const groups = raw(); groups[0].title = title; assert.throws(() => norm(groups), /plain title/);
  }
});

test('group frames contain only their members and cannot overlap in TB/LR/cyclic graphs', () => {
  for (const direction of ['TB', 'LR']) for (const suffix of ['', '\nC --> A\nB --> B']) {
    const diagram = source.replace('TB', direction) + suffix;
    const connections = [{ from: 'A', to: 'B', label: 'requests report' }, { from: 'B', to: 'C', label: 'stores report' }];
    const graph = layoutDiagram(diagram, connections, norm());
    assert.equal(graph.nodes.length, 4); assert.equal(graph.edges.length, parseMermaid(diagram).edges.length);
    for (const group of graph.groups) {
      assert.ok(group.x >= 0 && group.y >= 0 && group.x + group.width <= graph.width && group.y + group.height <= graph.height);
      for (const node of graph.nodes) assert.equal(contains(group, node), group.nodes.includes(node.id));
      assert.ok(!graph.groups.some((g) => g !== group && overlaps(group, g)));
      const header = { ...group, height: 36 };
      assert.ok(!graph.nodes.some((n) => overlaps(header, n)), 'group title space is reserved');
      assert.ok(!graph.edges.some((e) => e.labelBox && overlaps(header, e.labelBox)), 'labels avoid group headers');
    }
    for (const edge of graph.edges) {
      const target = graph.nodes.find((n) => n.id === edge.to), [x, y] = edge.arrow[0];
      assert.ok(x >= target.x && x <= target.x + target.width && y >= target.y && y <= target.y + target.height);
    }
    assert.deepEqual(layoutDiagram(diagram, connections, norm()), graph);
  }
});

test('grouped Mermaid exports round-trip names, membership, ungrouped nodes and labels', () => {
  const connections = [{ from: 'B', to: 'C', label: 'stores report' }];
  const exported = mermaidWithConnections(source, connections, norm());
  const graph = parseMermaid(exported);
  assert.deepEqual(graph.groups, raw().map(({ id, title, nodes }) => ({ id, title, nodes })));
  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.edges.find((e) => e.from === 'B' && e.to === 'C').label, 'stores report');
  assert.equal(layoutDiagram(exported).groups.length, 2);
  const md = recapMarkdown({ changes: [], architecture: { description: 'Flow', mermaid: source, groups: norm(), connections } });
  assert.ok(md.includes(exported)); assert.match(md, /share the application module/); assert.doesNotMatch(md, /id1|id2/);
  const conflicting = exported.replace('Application', 'Invented boundary');
  assert.throws(() => normalizeGroups(raw(), conflicting, components, aliases, files), /agree/);
});

test('Mermaid group subset rejects nesting, empty groups, unclosed blocks and active content', () => {
  for (const diagram of [
    'flowchart TB\nend', 'flowchart TB\nsubgraph G["Empty"]\nend\nA["A"]',
    'flowchart TB\nsubgraph G["Group"]\nA["A"]',
    'flowchart TB\nsubgraph G["Outer"]\nsubgraph H["Inner"]\nA["A"]\nend\nend',
    'flowchart TB\nsubgraph A["Collision"]\nA["A"]\nend',
    'flowchart TB\nsubgraph G["<script>"]\nA["A"]\nend',
  ]) assert.throws(() => parseMermaid(diagram));
});

test('schema and generation require evidence while old ungrouped reports remain unchanged', () => {
  assert.equal(PROMPT_VERSION, 7);
  assert.ok(SCHEMA.properties.recap.properties.architecture.required.includes('groups'));
  const prompt = buildPrompt({ digest: 'diff', fileCount: 2, hunkCount: 3, what: 'Modules', language: 'pl' });
  assert.match(prompt.system, /Do not infer a boundary merely from folder names/);
  assert.match(prompt.system, /Leave uncertain and source-unanchored context components ungrouped/);
  assert.equal(layoutDiagram(source).groups.length, 0);
  assert.equal(mermaidWithConnections(source), source);
});

test('report normalization retains evidenced groups alongside complete component metadata', () => {
  const componentData = components.map((c, i) => ({ id: c.id,
    status: i === 3 ? 'context' : i === 2 ? 'added' : 'modified', responsibility: 'Role in this example.',
    change: i === 3 ? '' : 'Changes behavior.', paths: i === 3 ? [] : [i === 2 ? 'cache.js' : 'app.js'],
    hunks: i === 3 ? [] : [`h${i + 1}`] }));
  const w = normalize({ parts: [{ steps: [{ hunks: ['h1'], text: 'Requests report.' }] }], recap: {
    changes: [{ description: 'Changed workflow.', motivation: 'Stores reports.', paths: ['app.js', 'cache.js'] }],
    architecture: { description: 'Panel uses engine and cache.', mermaid: source, components: componentData, groups: raw() },
  } }, aliases, files);
  assert.deepEqual(w.recap.architecture.groups, norm());
});
