// Exercise the merged view with native bindings stubbed; never start a model or agent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildDigest } from '../mods/walkthrough/lib/digest.js';
import { normalize, overlay, overlayAsks, schemaFor } from '../mods/walkthrough/lib/walkthrough.js';
import { reportPages } from '../mods/walkthrough/lib/navigation.js';
import { isRead } from '../mods/walkthrough/lib/read.js';

const asUrl = (s) => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
const bindings = asUrl(`
export class Element {
  constructor() { this.nodes=[]; this.handlers={}; this.calls={}; const proxy=new Proxy(this,{get:(o,k)=>{
    if(k in o)return o[k];return (...args)=>{o.calls[k]=args;if(String(k).startsWith('on_'))o.handlers[k]=args.at(-1);return proxy;};
  }});return proxy; }
  child(n){this.nodes.push(n);return this;} children(ns){this.nodes.push(...ns);return this;}
  id(value){this.key=value;return this;} when(condition,branch){return condition?branch(this):this;}
}
export const div=()=>new Element(), h_flex=div, v_flex=div, v_virtual_list=div;
export const Scrollbar={vertical:div}, Input={new:div}, Textarea={new:div};
export const InputState={new:()=>({on(){},value(){return '';},set_value(){},focus(){}})}, TextareaState=InputState;
export const VirtualListScrollHandle={new:()=>({})}, TextView={markdown:(id,text)=>div().id(id).child(text)};
const path=()=>new Proxy({},{get:()=>()=>path()});export const PathBuilder={stroke:path,fill:path};
export const spaces=()=>[],panes=()=>[],agents=()=>[],focused=()=>null,props=()=>({}),settings=()=>({});
export const shared=()=>null,setShared=()=>{},theme=()=>({}),closeOverlay=()=>{},notify=()=>{};
export const home=()=>'/synthetic',appHome=()=>'/synthetic';
export const exec=async()=>{throw new Error('Native execution is forbidden in this test');};
export const hc=exec,nextCommand=exec,watchFolder=exec,readTextFile=exec,writeTextFile=exec;
`);
const root = new URL('../mods/walkthrough/', import.meta.url), modules = new Map();
const native = new Set(['view.js','engine.js','turnview.js','ui.js','blueprint-view.js','diagram-view.js','contracts-view.js']);
async function load(name) {
  if (modules.has(name)) return modules.get(name);
  const pending = (async () => {
    let source = await readFile(new URL(name, root), 'utf8');
    for (const [, spec] of [...source.matchAll(/from "([^"]+)"/g)]) {
      const relative = spec.replace(/^\.\//, '');
      const url = ['gpui-kit','gpui-base','herdr'].includes(spec) ? bindings
        : native.has(relative) ? await load(relative) : new URL(spec, new URL(name, root)).href;
      source = source.replaceAll(`from "${spec}"`, `from "${url}"`);
    }
    return asUrl(source);
  })();
  modules.set(name, pending);
  return pending;
}
const { Walkthrough } = await import(await load('view.js'));
const { preparePrompt } = await import(await load('engine.js'));
const { Element } = await import(bindings);
globalThis.window = { paint_path: () => new Element() };
const colors = Object.fromEntries(['foreground','surface','background','popover','raised','ansi1','ansi2','ansi3','ansi4','ansi5','ansi6','muted','dim','accent','border','selected','selection','hover','blocked'].map((k) => [k,'#808080']));
const cx = { notify() {}, stop_propagation() {} };
const digest = buildDigest([{scope:'working',patch:`diff --git a/schema.sql b/schema.sql
--- a/schema.sql
+++ b/schema.sql
@@ -1 +1 @@
-status text NULL
+status text NOT NULL
@@ -12 +12 @@
-id integer
+id bigint
@@ -24 +23,0 @@
-legacy text
`}]);
function raw() {
  return {
    title:'Synthetic orders',summary:'Two changes and a removal.',
    recap:{changes:[{description:'Changes order fields.',motivation:'Supports stricter data.',paths:['schema.sql']}],architecture:{
      description:'Orders schema.',mermaid:'flowchart TB\nA["Orders"]',
      components:[{id:'A',status:'modified',responsibility:'Stores orders.',change:'Requires status.',paths:['schema.sql'],hunks:['h1']}],connections:[],groups:[],
    }},
    contracts:[{kind:'database',title:'Order status',summary:'Requires status.',compatibility:'breaking',impact:'NULL is rejected.',rollout:[],changes:[{
      name:'orders.status',operation:'modified',before:'status text NULL',after:'status text NOT NULL',detail:'Requires a status.',hunks:['h1'],
    }]}],
    parts:[{title:'Fields',blurb:'',steps:[
      {title:'Require status',text:'Status cannot be NULL.',hunks:['h1'],weight:'normal',notes:[]},
      {title:'Expand ID',text:'IDs use bigint.',hunks:['h2'],weight:'normal',notes:[]},
    ]}],skipped:[{path:'schema.sql',note:'Removes legacy.'}],
    asks:[{text:'Require status',coverage:'seen',hunks:['h1']},{text:'Remove legacy',coverage:'seen',hunks:['h3']}],
  };
}
function panel({ task = true } = {}) {
  const w = normalize(raw(),digest.idByAlias,digest.digestFiles,{asks:task});
  const view = overlay(w,digest.files), taskView = overlayAsks(w.asks,view);
  const p = new Walkthrough();
  Object.assign(p,{
    language:'en',model:'haiku',width:1100,step:0,read:{},readChanged:new Set(),visitedPages:new Set(['recap']),
    openFiles:new Set(),openContracts:new Set(),openContractChanges:new Set(),comments:[],target:null,unreadOnly:false,
    diagramZoom:1,diagramSelected:'A',diagramSource:false,auto:'off',space:null,repo:{top:'/synthetic',branch:'main'},scope:'uncommitted',
    view,taskView,task:null,diff:{...digest,sk:'uncommitted',what:'Synthetic edits'},
    shown:{exact:true,entry:{walkthrough:w,generatedAt:1,model:'haiku',language:'en',task:task?{from:'own',label:'Your task',text:'Require status; remove legacy.'}:null}},
  });
  return p;
}
function find(el,key) {
  if (!el || typeof el !== 'object') return;
  if (el.key === key) return el;
  for (const c of el.nodes ?? []) { const result=find(c,key);if(result)return result; }
}
const text = (el) => typeof el === 'string' ? el : (el?.nodes ?? []).map(text).join('\n');
const click = (el,key) => { const found=find(el,key);assert.ok(found,`Missing ${key}`);found.handlers.on_click({},cx); };

test('task schema and normalization retain Recap, contracts, blueprint evidence and task requests together', () => {
  const schema=schemaFor(true),p=panel();
  for(const key of ['recap','contracts','asks'])assert.ok(schema.required.includes(key));
  assert.equal(p.shown.entry.walkthrough.recap.architecture.components[0].hunkIds[0],digest.idByAlias.h1);
  assert.equal(p.taskView.asks[0].steps[0],p.view.steps[0]);
  assert.deepEqual(p.pages().map((page)=>page.kind),['recap','task','contract','step','step','tail']);
  assert.equal(p.firstPage(),0);
  const legacy=panel({task:false});
  assert.deepEqual(reportPages(legacy.shown.entry.walkthrough,legacy.view).map((page)=>page.kind),['recap','contract','step','step','tail']);
});
test('moving across special pages never marks a code step read; leaving a step marks its own hunks', () => {
  const p=panel();
  p.move(1);assert.equal(p.step,1);assert.deepEqual(p.read,{});
  p.move(1);assert.equal(p.step,2);assert.deepEqual(p.read,{});
  p.move(1);assert.equal(p.step,3);assert.deepEqual(p.read,{});
  p.move(1);assert.equal(p.step,4);
  assert.ok(isRead(p.view.steps[0],p.read));assert.ok(!isRead(p.view.steps[1],p.read));
  p.move(1);assert.equal(p.step,5);assert.ok(isRead(p.view.steps[1],p.read));
  assert.equal(p.readChanged.size,2);
});
test('unread-only skips read code steps while keeping Recap, Task, Contracts and Not covered reachable', () => {
  const p=panel();
  for(const s of p.view.steps)p.setRead(s,true);
  p.unreadOnly=true;p.go(2);p.move(1);assert.equal(p.step,5);
  p.move(-1);assert.equal(p.step,2);p.move(-1);assert.equal(p.step,1);p.move(-1);assert.equal(p.step,0);
});
test('read toggle and keyboard Task shortcut use report page positions with conditional contracts', () => {
  const p=panel();
  p.go(2);p.toggleRead();assert.deepEqual(p.read,{});
  p.go(4);p.toggleRead();assert.ok(isRead(p.view.steps[1],p.read));assert.ok(!isRead(p.view.steps[0],p.read));
  p.onKey({key:'t'},cx);assert.equal(p.step,1);
});
test('Task links and per-contract step links reach the exact code step or Not covered', () => {
  const p=panel();p.go(1);
  click(p.reportPage(colors),'task-a1-s1');assert.equal(p.step,3);
  p.go(1);click(p.reportPage(colors),'task-a2-tail');assert.equal(p.step,5);
  p.go(2);click(p.reportPage(colors),'contract-change-step-database-0-3');assert.equal(p.step,3);
  assert.equal(p.navigationFile,null);
});
test('blueprint source navigation includes the Task page in its destination offset', () => {
  const p=panel();assert.equal(p.blueprintTargets('schema.sql')[0].index,3);
  p.goToBlueprintFile('schema.sql',cx);assert.equal(p.step,3);assert.equal(p.navigationFile,'schema.sql');
});
test('contents and footer combine persistent read tracking with all specialized pages', () => {
  const p=panel();
  const contents=p.contents(colors);
  click(contents,'toc-contract-database');assert.equal(p.step,2);
  click(contents,'toc-task');assert.equal(p.step,1);
  click(contents,'toc-s2');assert.equal(p.step,4);
  click(contents,'toc-recap');assert.equal(p.step,0);
  p.go(3);click(p.footer(colors),'next');assert.equal(p.step,4);assert.ok(isRead(p.view.steps[0],p.read));
  p.unreadOnly=true;p.go(2);
  const filtered=p.contents(colors);assert.equal(find(filtered,'toc-s1'),undefined);assert.ok(find(filtered,'toc-s2'));
  assert.ok(find(filtered,'toc-task'));assert.ok(find(filtered,'toc-contract-database'));assert.ok(find(filtered,'toc-recap'));
});
test('changed-since-read banner navigates with Task and Contracts offsets', () => {
  const p=panel();p.view.steps[0].outdated=true;
  p.setRead(p.view.steps[0],true);p.go(0);
  click({nodes:p.banners(colors)},'b-changed-go');assert.equal(p.step,3);
});
test('Recap leads Markdown; own task stays out of PR posts while contract localization remains', () => {
  const p=panel();p.shown.entry.language='pl';
  const copied=p.markdown(),posted=p.markdown({forPost:true});
  assert.ok(copied.indexOf('### Recap')<copied.indexOf('### Task'));
  assert.ok(copied.indexOf('### Task')<copied.indexOf('### Baza danych'));
  assert.ok(copied.includes('### Baza danych'));assert.ok(!posted.includes('### Task'));
  assert.ok(posted.includes('### Recap'));assert.ok(posted.includes('### Baza danych'));
});
test('merged prompt includes task rules and generated-file recap visibility while enforcing chosen language last', () => {
  const prompt=preparePrompt({...digest,what:'Synthetic change',generatedPaths:['generated.lock']},{language:'en',preferences:'Write in Polish.',task:{about:'Your task',text:'Require status.'}});
  assert.match(prompt.prompt,/generated.lock/);assert.match(prompt.prompt,/<task>/);assert.match(prompt.system,/Map the task to the change in "asks"/);
  assert.ok(prompt.system.lastIndexOf('Write all prose in English')>prompt.system.lastIndexOf('Write in Polish.'));
  assert.match(prompt.system,/contract titles/);
});
