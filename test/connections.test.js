import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConnections } from '../mods/walkthrough/lib/connections.js';
import { layoutDiagram, mermaidWithConnections, parseMermaid } from '../mods/walkthrough/lib/diagram.js';
import { normalize, SCHEMA, PROMPT_VERSION } from '../mods/walkthrough/lib/walkthrough.js';
import { recapMarkdown } from '../mods/walkthrough/lib/export.js';
import { buildPrompt } from '../mods/walkthrough/lib/prompt.js';
const source = 'flowchart TB\nA["Panel"]\nB["Engine"]\nC["Cache"]\nA --> B\nB --> C';
const files = [{ path: 'engine.js', status: 'modified', aliases: ['h1'] }], aliases = { h1: 'id1' };
const connection = () => ({ from: 'B', to: 'C', label: 'stores report', hunks: ['h1'] });
const normalized = () => normalizeConnections([connection()], source, aliases, files);

test('connection descriptions preserve exact direction and real source anchors', () => {
  assert.deepEqual(normalized(), [{ from: 'B', to: 'C', label: 'stores report', paths: ['engine.js'], hunkIds: ['id1'] }]);
  const raw = { parts: [{ steps: [{ hunks: ['h1'], text: 'Persists report.' }] }], recap: {
    changes: [{ description: 'Saves reports.', motivation: 'Keep them.', paths: ['engine.js'] }],
    architecture: { description: 'Panel uses engine and cache.', mermaid: source, connections: [connection()] },
  } };
  assert.deepEqual(normalize(raw, aliases, files).recap.architecture.connections, normalized());
});

test('unsupported, reversed, duplicate and ambiguous connections cannot gain labels', () => {
  for (const patch of [{ from: 'Missing' }, { from: 'C', to: 'B' }, { hunks: [] }, { hunks: ['invented'] }, { hunks: ['toString'] }]) {
    assert.throws(() => normalizeConnections([{ ...connection(), ...patch }], source, aliases, files), /Connection:/);
  }
  assert.throws(() => normalizeConnections([connection(), connection()], source, aliases, files), /unique/);
  assert.throws(() => normalizeConnections([connection()], source + '\nB --> C', aliases, files), /unique/);
  assert.throws(() => normalizeConnections([connection()], source, aliases, [{ ...files[0], status: 'deleted' }]), /resulting code/);
});

test('labels must be short, plain, non-executable text with explicit evidence', () => {
  for (const label of ['', ' ', '<img>', '`code`', 'a|b', 'a"b', 'a\\b', 'a\nb', 'a\u0000b', 'x'.repeat(61)]) {
    assert.throws(() => normalizeConnections([{ ...connection(), label }], source, aliases, files), /plain text/);
  }
  const inline = source.replace('B --> C', 'B -->|"stores report"| C');
  assert.deepEqual(normalizeConnections([connection()], inline, aliases, files), normalized());
  assert.throws(() => normalizeConnections([], inline, aliases, files), /source evidence/);
  assert.throws(() => normalizeConnections([{ ...connection(), label: 'other claim' }], inline, aliases, files), /conflicts/);
});

test('legacy reports and unsupported flows retain unlabeled connections', () => {
  assert.equal(normalizeConnections(undefined, source, aliases, files), undefined);
  assert.deepEqual(normalizeConnections([], source, aliases, files), []);
  assert.equal(mermaidWithConnections(source), source);
  assert.ok(layoutDiagram(source).edges.every((e) => !e.labelBox));
  const graph = layoutDiagram(source, normalized());
  assert.equal(graph.edges[0].labelBox, undefined);
  assert.equal(graph.edges[1].label, 'stores report');
});

test('native labels and exported Mermaid agree, including localized text', () => {
  const connections = normalized().map((c) => ({ ...c, label: 'zapisuje raport' }));
  const exported = mermaidWithConnections(source, connections);
  assert.match(exported, /B -->\|"zapisuje raport"\| C/);
  assert.equal(parseMermaid(exported).edges[1].label, 'zapisuje raport');
  const recap = { changes: [], architecture: { description: 'Flow', mermaid: source, connections } };
  assert.ok(recapMarkdown(recap).includes(exported));
  assert.doesNotMatch(recapMarkdown(recap), /id1/);
});

const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
test('branch, loop, long and parallel edges keep labels inside the canvas and off cards and each other', () => {
  for (const direction of ['TB', 'LR']) {
    for (const edges of [
      ['A --> B', 'A --> C', 'B --> D', 'C --> D'],
      ['A --> B', 'B --> A', 'A --> A', 'B --> D', 'A --> D'],
      ['A --> B', 'B --> C', 'C --> D', 'A --> D'],
      ['A --> B', 'A --> B', 'B --> C', 'C --> D'],
    ]) {
      const diagram = `flowchart ${direction}\nA["Panel"]\nB["Engine"]\nC["Cache"]\nD["Store"]\n` + edges.join('\n');
      const labels = parseMermaid(diagram).edges.map((e, i) => ({ ...e, label: `connection ${i + 1} with a longer description` }));
      const graph = layoutDiagram(diagram, labels), boxes = graph.edges.map((e) => e.labelBox);
      for (const box of boxes) {
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= graph.width && box.y + box.height <= graph.height);
        assert.ok(!graph.nodes.some((n) => overlap(box, n)), 'label must not obscure component');
        assert.ok(!boxes.some((other) => other !== box && overlap(box, other)), 'labels must not overlap');
        assert.ok(box.anchor.every(Number.isFinite));
      }
      assert.deepEqual(layoutDiagram(diagram, labels), graph, 'stable placement');
    }
  }
});

test('new generation schema and localized prompt require evidence, not labels on every edge', () => {
  assert.equal(PROMPT_VERSION, 8);
  assert.ok(SCHEMA.properties.recap.properties.architecture.required.includes('connections'));
  const p = buildPrompt({ digest: 'diff', fileCount: 1, hunkCount: 1, what: 'Changes', language: 'pl' });
  assert.match(p.system, /Omit unsupported labels/);
  assert.match(p.system, /connection labels/);
});
