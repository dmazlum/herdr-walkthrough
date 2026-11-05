import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contractChangeEvidence, contractChangeTargets } from '../mods/walkthrough/lib/contract-evidence.js';
const files = [
  { path: 'schema.sql', scope: 'working', hunks: [{ id: 'status' }, { id: 'id' }] },
  { path: 'schema.sql', scope: 'staged', hunks: [{ id: 'staged-status' }] },
];
test('per-change evidence excludes other hunks in the same file and other scopes', () => {
  const result = contractChangeEvidence({ hunkIds: ['status'] }, files);
  assert.deepEqual(result.found.map((h) => h.hunk.id), ['status']);
  assert.equal(result.missing, 0);
});
test('partial and disappeared evidence is counted by unique saved hunk identity', () => {
  const result = contractChangeEvidence({ hunkIds: ['status', 'gone', 'gone'] }, files);
  assert.equal(result.missing, 1); assert.equal(result.found.length, 1);
  assert.equal(contractChangeEvidence({ hunkIds: ['gone'] }, files).found.length, 0);
  assert.deepEqual(contractChangeEvidence(undefined, files), { found: [], missing: 0 });
});
test('step links use exact anchors and actual page indices, including conditional pages', () => {
  const pages = [{ kind: 'recap' }, { kind: 'contract' }, { kind: 'contract' },
    { kind: 'step', title: 'Other edit in same file', step: { id: 's1', hunkIds: ['id'] } },
    { kind: 'step', title: 'Status', step: { id: 's2', hunkIds: ['status'] } },
    { kind: 'step', title: 'Status details', step: { id: 's3', hunkIds: ['status', 'staged-status'] } },
    { kind: 'tail' }];
  assert.deepEqual(contractChangeTargets(pages, { hunkIds: ['status'] }).map((t) => [t.index, t.title]), [[4, 'Status'], [5, 'Status details']]);
  assert.deepEqual(contractChangeTargets(pages, { hunkIds: ['uncovered'] }), []);
  assert.deepEqual(contractChangeTargets(pages, undefined), []);
});
test('saved steps remain navigable even when current source is completely stale', () => {
  const pages = [{ kind: 'step', title: 'Status', step: { id: 's1', hunkIds: ['status'], found: [], outdated: true } }];
  assert.equal(contractChangeEvidence({ hunkIds: ['status'] }, []).missing, 1);
  assert.equal(contractChangeTargets(pages, { hunkIds: ['status'] })[0].index, 0);
});
