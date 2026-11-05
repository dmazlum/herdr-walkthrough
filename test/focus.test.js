import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagramFocus } from '../mods/walkthrough/lib/focus.js';
const graph = {
  nodes: ['A', 'B', 'C', 'D', 'Isolated'].map((id) => ({ id })),
  edges: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }, { from: 'B', to: 'D' }, { from: 'A', to: 'A' }],
  groups: [{ id: 'App', nodes: ['A', 'B'] }, { id: 'Data', nodes: ['C'] }, { id: 'Other', nodes: ['D'] }],
};
test('focus includes incoming/outgoing neighbors and loops, never second-hop connections', () => {
  const before = structuredClone(graph), focus = diagramFocus(graph, 'A');
  assert.equal(focus.active, true);
  assert.deepEqual([...focus.nodes].sort(), ['A', 'B', 'C']);
  assert.deepEqual([...focus.edges], [0, 2, 4]);
  assert.deepEqual([...focus.groups], ['App', 'Data']);
  assert.deepEqual(graph, before);
});
test('clearing or invalidating selection restores every component, edge and group', () => {
  for (const id of [null, undefined, 'Missing']) {
    const focus = diagramFocus(graph, id);
    assert.equal(focus.active, false);
    assert.equal(focus.nodes.size, graph.nodes.length);
    assert.equal(focus.edges.size, graph.edges.length);
    assert.equal(focus.groups.size, graph.groups.length);
  }
});
test('isolated components remain focusable without inventing connections', () => {
  const focus = diagramFocus(graph, 'Isolated');
  assert.deepEqual([...focus.nodes], ['Isolated']);
  assert.equal(focus.edges.size, 0); assert.equal(focus.groups.size, 0);
});
test('parallel and reverse edges retain their individual identities in legacy graphs', () => {
  const g = { nodes: [{ id: 'A' }, { id: 'B' }], edges: [{ from: 'A', to: 'B' }, { from: 'A', to: 'B' }, { from: 'B', to: 'A' }] };
  assert.deepEqual([...diagramFocus(g, 'B').edges], [0, 1, 2]);
});
