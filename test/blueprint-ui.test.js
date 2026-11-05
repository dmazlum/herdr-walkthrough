// Exercise the actual renderer's callbacks without automating the user's pointer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stub = `
export class Element {
  constructor() { this.nodes = []; this.handlers = {}; this.calls = {}; const proxy = new Proxy(this, { get: (o, k) => {
    if (k in o) return o[k];
    return (...args) => { o.calls[k] = args; if (String(k).startsWith('on_')) o.handlers[k] = args.at(-1); return proxy; };
  } }); return proxy; }
  child(n) { this.nodes.push(n); return this; }
  children(ns) { this.nodes.push(...ns); return this; }
  id(value) { this.key = value; return this; }
  when(condition, branch) { return condition ? branch(this) : this; }
}
export const div = () => new Element();
export const h_flex = div, v_flex = div, v_virtual_list = div;
export const Scrollbar = { vertical: div };
export const TextView = { markdown: (id, value) => div().id(id).child(value) };
const path = () => new Proxy({}, { get: () => (...args) => path() });
export const PathBuilder = { stroke: path, fill: path };
`;
const asUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const stubUrl = asUrl(stub);
const root = new URL('../mods/walkthrough/', import.meta.url);
async function load(name, overrides = {}) {
  const file = new URL(name, root);
  let source = await readFile(file, 'utf8');
  source = source.replace(/from "([^"]+)"/g, (all, specifier) => {
    const url = overrides[specifier] ?? (specifier === 'gpui-kit' || specifier === 'gpui-base' ? stubUrl : new URL(specifier, file).href);
    return `from "${url}"`;
  });
  return asUrl(source);
}
const ui = await load('ui.js');
const diagram = await load('diagram-view.js');
const view = await import(await load('blueprint-view.js', { './ui.js': ui, './diagram-view.js': diagram }));
const { Element } = await import(stubUrl);
globalThis.window = { paint_path: (_path, color) => Object.assign(new Element(), { paintColor: color }) };
const theme = Object.fromEntries(['foreground', 'surface', 'raised', 'ansi4', 'ansi6', 'ansi2', 'ansi3', 'muted', 'dim', 'accent', 'border', 'selected', 'hover', 'blocked'].map((key) => [key, '#808080']));
const architecture = {
  mermaid: 'flowchart TB\nA["Queue"]',
  components: [{ id: 'A', status: 'added', responsibility: 'Keeps jobs.', change: 'New queue.', paths: ['src/queue.js'], hunkIds: ['real-id'] }],
};
const files = [{ path: 'src/queue.js', scope: 'working', hunks: [{ id: 'real-id', header: '@@ -0,0 +1 @@', lines: ['+const jobs = [];'] }] }];
function find(root, key) {
  if (!root || typeof root !== 'object') return undefined;
  if (root.key === key) return root;
  for (const child of root.nodes ?? []) { const hit = find(child, key); if (hit) return hit; }
}
function strings(root) {
  if (typeof root === 'string') return root;
  return (root?.nodes ?? []).map(strings).join('\n');
}

const destinations = () => [{ index: 2, title: 'Queue behavior', kind: 'step' }];

test('component selection and file activation invoke the navigation callbacks', () => {
  const clicks = [], cx = { stop_propagation() {} };
  const root = view.blueprintView(architecture, theme, { files, selectedId: 'A', fileTargets: destinations,
    onSelect: (id, context) => clicks.push([id, context]), onFile: (path, context) => clicks.push([path, context]) });
  find(root, 'diagram-node-A').handlers.on_click({}, cx);
  const link = find(root, 'blueprint-file-0');
  link.handlers.on_click({}, cx);
  assert.deepEqual(clicks, [['A', cx], ['src/queue.js', cx]]);
  assert.match(link.calls.tooltip[0], /Go to Queue behavior/);
  assert.doesNotMatch(strings(root), /Supporting diff/);
});

test('stale evidence still permits navigation, while missing destinations disable file links', () => {
  let activated = false;
  const stale = view.blueprintView(architecture, theme, { selectedId: 'A', fileTargets: destinations,
    onFile: () => { activated = true; } });
  find(stale, 'blueprint-file-0').handlers.on_click({}, {});
  assert.equal(activated, true);
  assert.match(strings(stale), /changed or disappeared/);
  const missing = view.blueprintView(architecture, theme, { selectedId: 'A', onFile: () => { activated = false; } });
  find(missing, 'blueprint-file-0').handlers.on_click({}, {});
  assert.equal(activated, true, 'disabled destination must not fire');
});

test('legacy nodes remain unclassified and multiple section links explain the default', () => {
  const legacy = view.blueprintView({ mermaid: architecture.mermaid }, theme, { selectedId: 'A' });
  assert.match(strings(legacy), /Regenerate/);
  assert.doesNotMatch(strings(find(legacy, 'diagram-node-A')), /CONTEXT|ADDED|MODIFIED/);
  const root = view.blueprintView(architecture, theme, { files, selectedId: 'A', fileTargets: () => [...destinations(), ...destinations()] });
  assert.match(find(root, 'blueprint-file-0').calls.tooltip[0], /first of 2 matching sections/);
});

test('connection labels render as native callouts and disclose stale evidence', () => {
  const a = { ...architecture, mermaid: 'flowchart TB\nA["Queue"]\nB["Store"]\nA --> B',
    connections: [{ from: 'A', to: 'B', label: 'stores jobs', paths: ['src/queue.js'], hunkIds: ['real-id'] }] };
  const current = view.blueprintView(a, theme, { files });
  const label = find(current, 'diagram-edge-label-0');
  assert.match(strings(label), /stores jobs/);
  assert.doesNotMatch(label.calls.tooltip[0], /source changed/);
  const stale = view.blueprintView(a, theme, { files: [] });
  assert.match(find(stale, 'diagram-edge-label-0').calls.tooltip[0], /source changed/);
  assert.match(strings(stale), /Some connection labels refer to changed source/);
});

test('native group frames expose their titles, reasons and selected membership', () => {
  const a = { ...architecture, groups: [{ id: 'App', title: 'Application', reason: 'A owns the job queue.', nodes: ['A'], paths: ['src/queue.js'], hunkIds: ['real-id'] }] };
  const current = view.blueprintView(a, theme, { files, selectedId: 'A', fileTargets: destinations });
  assert.ok(find(current, 'diagram-group-App'));
  assert.match(strings(find(current, 'diagram-group-title-App')), /Application/);
  assert.match(strings(current), /Group: Application/);
  const clicks = [];
  const clickable = view.blueprintView(a, theme, { files, selectedId: 'A', onSelect: (id) => clicks.push(id) });
  find(clickable, 'diagram-node-A').handlers.on_click({}, {});
  assert.deepEqual(clicks, ['A']);
  const stale = view.blueprintView(a, theme, { files: [] });
  assert.match(strings(stale), /Some group boundaries refer to changed source/);
  assert.match(find(stale, 'diagram-group-title-App').calls.tooltip[0], /source changed/);
});

test('focus dims unrelated cards, wires, callouts and groups without moving the diagram', () => {
  const a = { ...architecture,
    mermaid: 'flowchart TB\nA["Queue"]\nB["Engine"]\nC["Storage"]\nA --> B\nB --> C',
    groups: [{ id: 'App', title: 'App', nodes: ['A', 'B'] }, { id: 'Data', title: 'Data', nodes: ['C'] }],
    connections: [{ from: 'A', to: 'B', label: 'requests jobs', paths: [], hunkIds: [] }, { from: 'B', to: 'C', label: 'stores jobs', paths: [], hunkIds: [] }],
  };
  const palette = { ...theme, surface: '#101820', foreground: '#f0f5ff', ansi4: '#34567a', ansi6: '#7fcdef', accent: '#4ad4df' };
  const all = view.blueprintView(a, palette);
  const focused = view.blueprintView(a, palette, { selectedId: 'A' });
  assert.equal(find(focused, 'diagram-edge-0').paintColor, palette.accent);
  assert.notEqual(find(focused, 'diagram-edge-1').paintColor, find(all, 'diagram-edge-1').paintColor);
  for (const id of ['A', 'B']) assert.equal(find(focused, `diagram-node-${id}`).calls.opacity[0], 1);
  assert.ok(find(focused, 'diagram-node-C').calls.opacity[0] < 0.5);
  assert.equal(find(focused, 'diagram-edge-0').calls.opacity[0], 1);
  assert.ok(find(focused, 'diagram-edge-1').calls.opacity[0] < 0.5);
  assert.equal(find(focused, 'diagram-edge-label-0').calls.opacity[0], 1);
  assert.ok(find(focused, 'diagram-edge-label-1').calls.opacity[0] < 0.5);
  assert.ok(find(focused, 'diagram-group-Data').calls.opacity[0] < 0.5);
  for (const id of ['A', 'B', 'C']) for (const key of ['left', 'top', 'w', 'h']) {
    assert.deepEqual(find(focused, `diagram-node-${id}`).calls[key], find(all, `diagram-node-${id}`).calls[key]);
  }
});

test('dimmed nodes remain clickable, and Show all clears selection without touching report data', () => {
  const a = { ...architecture, mermaid: 'flowchart TB\nA["Queue"]\nB["Unrelated"]' };
  const before = structuredClone(a);
  let selectedId = 'A';
  const render = () => view.blueprintView(a, theme, { selectedId,
    onSelect: (id) => { selectedId = id; }, onClose: () => { selectedId = null; } });
  find(render(), 'diagram-node-B').handlers.on_click({}, {});
  assert.equal(selectedId, 'B');
  find(render(), 'blueprint-show-all').handlers.on_click({}, {});
  assert.equal(selectedId, null);
  for (const id of ['A', 'B']) assert.equal(find(render(), `diagram-node-${id}`).calls.opacity[0], 1);
  assert.deepEqual(a, before);
  assert.doesNotMatch(strings(render()), /Focused:/);
});

const { contractPage } = await import(await load('contracts-view.js', { './ui.js': ui }));
const { LANGUAGES } = await import('../mods/walkthrough/lib/languages.js');
const { contractStrings } = await import('../mods/walkthrough/lib/contract-language.js');
test('actual contract renderer localizes headings, operations, placeholders and source controls for every selected language', () => {
  const page = { kind: 'database', title: 'Example', summary: 'Summary', compatibility: 'unknown', impact: 'Impact', paths: ['schema.sql'], rollout: [],
    changes: [{ name: 'field', operation: 'added', before: '', after: 'field text', detail: 'Detail' }, { name: 'old', operation: 'removed', before: 'old text', after: '', detail: 'Detail' }] };
  for (const l of LANGUAGES) {
    const words = contractStrings(l.tag);
    const rendered = contractPage(page, theme, { language: l.tag, missing: 2 });
    const text = strings(rendered);
    for (const expected of [words.kinds.database, words.before.toUpperCase(), words.after.toUpperCase(), words.absent, words.removed, words.compatibility.unknown, words.operations.added, words.operations.removed, words.rollout, words.noRollout, words.stale.replace('{count}', '2'), words.showSource]) assert.ok(text.includes(expected), l.tag + ': ' + expected);
    const opened = contractPage(page, theme, { language: l.tag, sourceOpen: true });
    assert.ok(strings(opened).includes(words.hideSource));
    if (l.tag !== 'pl') assert.doesNotMatch(text, /PO ZMIANIE|PRZED ZMIANĄ|Kolejność wdrożenia|Pokaż źródłowy diff/);
  }
});

test('contract change names and controls open exact evidence and navigate to their own steps', () => {
  const page = { kind:'database',title:'Fields',summary:'Summary',compatibility:'mixed',impact:'Impact',paths:['schema.sql'],rollout:[],
    changes:[{name:'status',operation:'modified',before:'old status',after:'new status',detail:'Status change'}, {name:'id',operation:'modified',before:'old id',after:'new id',detail:'ID change'}] };
  const calls = [], rendered = [];
  const root = contractPage(page, theme, { openChanges:new Set([0]),
    changeEvidence:[{found:[{hunk:{id:'status'}}],missing:0,targets:[{index:4,title:'Status step'}]}, {found:[{hunk:{id:'id'}}],missing:0,targets:[{index:5,title:'ID step'}]}],
    onToggleChange:(i,cx)=>calls.push(['toggle',i,cx]), onGoToStep:(i,target,cx)=>calls.push(['step',i,target,cx]),
    renderChangeSource:(i)=>{rendered.push(i);return new Element().child('source for '+i);} });
  const cx={};
  find(root,'contract-change-name-database-1').handlers.on_click({},cx);
  find(root,'contract-change-source-database-0').handlers.on_click({},cx);
  find(root,'contract-change-step-database-1-5').handlers.on_click({},cx);
  assert.deepEqual(calls,[['toggle',1,cx],['toggle',0,cx],['step',1,5,cx]]);
  assert.deepEqual(rendered,[0]);
  assert.ok(find(root,'contract-evidence-database-0'));
  assert.equal(find(root,'contract-evidence-database-1'),undefined);
});

test('per-change source warnings and no-step messages are localized for all selectable languages', () => {
  const page={kind:'api',title:'API',summary:'Summary',compatibility:'breaking',impact:'Impact',paths:['api.js'],rollout:[],changes:[{name:'GET /old',operation:'removed',before:'GET /old',after:'',detail:'Removed'}]};
  for(const l of LANGUAGES){
    const words=contractStrings(l.tag);
    const stale=contractPage(page,theme,{language:l.tag,openChanges:new Set([0]),changeEvidence:[{found:[],missing:1,targets:[]}]});
    const evidence=find(stale,'contract-evidence-api-0');
    assert.ok(strings(stale).includes(words.noStep));
    assert.ok(strings(evidence).includes(words.noSource));
    assert.ok(strings(evidence).includes(words.stale.replace('{count}','1')));
    const partial=contractPage(page,theme,{language:l.tag,openChanges:new Set([0]),changeEvidence:[{found:[{}],missing:1,targets:[{index:3,title:'Endpoint step'}]}],renderChangeSource:()=>new Element().child('remaining source')});
    assert.ok(strings(partial).includes(words.goToStep.replace('{title}','Endpoint step')));
    assert.ok(strings(find(partial,'contract-evidence-api-0')).includes('remaining source'));
    assert.ok(!strings(find(partial,'contract-evidence-api-0')).includes(words.noSource));
  }
});
