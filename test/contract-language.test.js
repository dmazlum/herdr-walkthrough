import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES } from '../mods/walkthrough/lib/languages.js';
import { contractStrings, CONTRACT_TRANSLATIONS } from '../mods/walkthrough/lib/contract-language.js';
import { contractMarkdown, toMarkdown } from '../mods/walkthrough/lib/export.js';
import { reportPages, blueprintFileTargets } from '../mods/walkthrough/lib/navigation.js';
import { buildPrompt } from '../mods/walkthrough/lib/prompt.js';
const page = { kind: 'database', title: 'Order status', summary: 'Source-backed summary.', compatibility: 'mixed', impact: 'Consumer impact.',
  changes: [{ name: 'orders.status', operation: 'added', before: '', after: "status text DEFAULT 'pending'", detail: 'Change detail.', hunkIds: ['id1'] }], rollout: [], paths: ['schema.sql'] };
const walkthrough = { title: 'Orders', parts: [], contracts: [page] }, view = { steps: [], parts: [], uncovered: [] };

test('every selectable language has a complete contract catalog and locale/name resolution', () => {
  for (const l of LANGUAGES) {
    assert.ok(Object.hasOwn(CONTRACT_TRANSLATIONS, l.tag), l.tag);
    const words = contractStrings(l.tag);
    assert.deepEqual(contractStrings(l.name), words);
    assert.deepEqual(contractStrings(l.english), words);
    assert.deepEqual(contractStrings(l.tag + '-XX'), words);
    for (const value of Object.values(words)) {
      const strings = typeof value === 'object' ? Object.values(value) : [value];
      assert.ok(strings.every((s) => typeof s === 'string' && s.length), l.tag);
    }
  }
  assert.deepEqual(contractStrings('unsupported'), contractStrings('en'));
});

test('contract navigation and Markdown use the requested language without translating source', () => {
  for (const l of LANGUAGES) {
    const words = contractStrings(l.tag);
    assert.equal(reportPages(walkthrough, view, l.tag)[1].title, words.kinds.database);
    const md = contractMarkdown(page, l.tag);
    for (const text of [words.kinds.database, words.before, words.after, words.absent, words.operations.added, words.compatibility.mixed, words.rollout, words.noRollout]) assert.ok(md.includes(text), l.tag + ': ' + text);
    assert.ok(md.includes(page.changes[0].after));
    assert.ok(toMarkdown(view, walkthrough, { language: l.name }).includes(md));
    if (l.tag !== 'pl') assert.doesNotMatch(md, /Kolejność wdrożenia|Nie istniało|Zmiany mieszane/);
  }
  assert.match(contractMarkdown(page), /### Database/);
  assert.match(contractMarkdown(page), /Deployment order/);
});

test('blueprint contract destinations use localized page titles with the same page index', () => {
  const c = { paths: ['schema.sql'], hunkIds: ['id1'] };
  assert.equal(blueprintFileTargets(walkthrough, view, [], c, 'schema.sql', 'de')[0].title, 'Datenbank');
  assert.equal(blueprintFileTargets(walkthrough, view, [], c, 'schema.sql', 'de')[0].index, 1);
});

test('every generation language explicitly covers all contract prose after reader preferences', () => {
  for (const l of LANGUAGES) {
    const { system } = buildPrompt({ digest: 'diff', fileCount: 1, hunkCount: 1, what: 'Change', language: l.tag, preferences: 'Be brief.' });
    assert.ok(system.includes(`Write all prose in ${l.english}`));
    assert.match(system, /contract titles, summaries, impact, details and rollout steps/);
    assert.match(system, /selected output language/);
    assert.ok(system.indexOf(`Write all prose in ${l.english}`) > system.indexOf('</preferences>'));
    assert.match(system, /contract kind, compatibility and operation enum values/);
  }
});
