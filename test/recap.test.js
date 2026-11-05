import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, overlay, validateMermaid, SCHEMA } from "../mods/walkthrough/lib/walkthrough.js";
import { buildPrompt } from "../mods/walkthrough/lib/prompt.js";
import { recapMarkdown, toMarkdown } from "../mods/walkthrough/lib/export.js";

const files = [{ path: "src/a.js", aliases: ["h1"] }, { path: "test/a.js", aliases: ["h2"] }, { path: "lock.json", aliases: [] }];
const recap = () => ({
  changes: [
    { description: "Retries now use a queue.", motivation: "Inferred: preserve failed work.", paths: ["src/a.js", "test/a.js"] },
    { description: "Generated lockfile changed; contents not read.", motivation: "Unknown from supplied material.", paths: ["lock.json"] },
  ],
  architecture: { description: "The caller delegates to a queue.", mermaid: 'flowchart TB\nCaller["Caller"]\nQueue["Retry queue"]\nCaller --> Queue' },
});
const raw = () => ({ title: "Retries", summary: "Failed jobs can retry.", recap: recap(), skipped: [], parts: [{ title: "Queue", blurb: "", steps: [{ title: "Persist", text: "Keep failed jobs.", hunks: ["h1"], weight: "key", notes: [] }] }] });
const norm = (r) => normalize(r, { h1: "id1", h2: "id2" }, files);

test("new reports require a structured recap and normalization preserves complete recap", () => {
  assert.ok(SCHEMA.required.includes("recap"));
  assert.deepEqual(norm(raw()).recap, recap());
  const w = norm(raw());
  const md = toMarkdown(overlay(w, []), w);
  assert.match(md, /### Recap/);
  assert.ok(md.indexOf("### Recap") < md.indexOf("### Queue"), "Recap precedes reading steps in export");
  assert.match(md, /\*\*Motivation:\*\* Inferred:/);
  assert.match(md, /`lock.json`/);
  assert.ok(md.includes('```mermaid\n' + recap().architecture.mermaid + '\n```'));
});

test("recap cannot silently omit supporting or generated files", () => {
  const r = raw(); r.recap.changes.pop();
  assert.throws(() => norm(r), /omitted changed files/);
});

test("recap rejects missing rationale, imaginary file anchors and empty architecture", () => {
  for (const mutate of [
    (r) => { r.recap.changes[0].motivation = ""; },
    (r) => { r.recap.changes[0].paths = ["invented.js"]; },
    (r) => { r.recap.architecture.description = ""; },
    (r) => { r.recap.architecture.mermaid = ""; },
  ]) { const r = raw(); mutate(r); assert.throws(() => norm(r)); }
});

test("Mermaid subset handles isolated nodes and cycles, rejects invalid or active content", () => {
  validateMermaid('flowchart LR\nA["Documentation"]');
  validateMermaid('flowchart TB\nA["A"]\nB["B"]\nA --> B\nB --> A');
  for (const s of ['graph TB', 'flowchart TB\nA --> B', 'flowchart TB\nA["A"]\nclick A "https://x"', 'flowchart TB\nA["<script>"]', 'flowchart TB\nA["A"]\nA["B"]', 'flowchart TB\n```']) assert.throws(() => validateMermaid(s));
});

test("legacy saved reports remain readable and recap page offers regeneration", () => {
  const r = raw(); delete r.recap;
  assert.equal(norm(r).recap, null);
  assert.match(recapMarkdown(null), /Regenerate/);
});

test("generation asks for all changes, evidence-based motivations and localized Mermaid labels", () => {
  const p = buildPrompt({ digest: "diff", fileCount: 3, hunkCount: 2, what: "Changes", language: "pl" });
  assert.match(p.system, /ALL changes/);
  assert.match(p.system, /label inferred motivation as inferred/);
  assert.match(p.system, /architecture description and diagram labels/);
  assert.match(p.system, /No HTML, backticks, links/);
});
