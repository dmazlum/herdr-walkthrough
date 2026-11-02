import { test } from "node:test";
import assert from "node:assert/strict";
import { readKey, pathOf, hunkRead, stepRead, isRead, markStep, unmarkStep, prune, mergeRead, changedSince } from "../mods/walkthrough/lib/read.js";
import { parseDiff } from "../mods/walkthrough/lib/hunks.js";

const PATCH = `diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -1,3 +1,3 @@
 keep
-old
+new
 keep
`;

test("readKey drops the scope and keeps the path and digest", () => {
  assert.equal(readKey("staged:src/a.js:1f2e3d4c"), "src/a.js:1f2e3d4c");
  assert.equal(readKey("branch:dir/x:y.js:1f2e3d4c-2"), "dir/x:y.js:1f2e3d4c-2");
  assert.equal(pathOf(readKey("pr:dir/x:y.js:1f2e3d4c")), "dir/x:y.js");
});

test("the same edit staged, unstaged or on its branch is one hunk read", () => {
  const [staged] = parseDiff(PATCH, "staged")[0].hunks;
  const [working] = parseDiff(PATCH, "working")[0].hunks;
  const [branch] = parseDiff(PATCH, "branch")[0].hunks;
  assert.notEqual(staged.id, working.id);
  assert.equal(readKey(staged.id), readKey(working.id));
  const read = markStep({ hunkIds: [working.id] }, {}, 1);
  assert.ok(hunkRead(staged.id, read));
  assert.ok(hunkRead(branch.id, read));
  // An edit is another digest: not read.
  const [edited] = parseDiff(PATCH.replace("+new", "+newer"), "working")[0].hunks;
  assert.ok(!hunkRead(edited.id, read));
});

test("stepRead: every hunk of the step, and never an empty step", () => {
  const step = { hunkIds: ["working:a.js:1", "working:b.js:2"] };
  assert.ok(!stepRead(step, {}));
  assert.ok(!stepRead(step, { "a.js:1": 1 }));
  assert.ok(stepRead(step, { "a.js:1": 1, "b.js:2": 1 }));
  assert.ok(!stepRead({ hunkIds: [] }, { "a.js:1": 1 }));
  // An outdated step isn't read, whatever was read of it.
  assert.ok(!isRead({ ...step, outdated: true }, { "a.js:1": 1, "b.js:2": 1 }));
});

test("a regenerated step whose hunks were read is read, in any scope", () => {
  const read = markStep({ hunkIds: ["working:a.js:1", "working:b.js:2"] }, {}, 5);
  // Another walkthrough of the same code (or of it once staged) groups it anew.
  assert.ok(stepRead({ hunkIds: ["staged:b.js:2"] }, read));
  assert.ok(stepRead({ hunkIds: ["staged:a.js:1", "working:b.js:2"] }, read));
  assert.ok(!stepRead({ hunkIds: ["staged:a.js:1", "working:c.js:3"] }, read));
});

test("markStep and unmarkStep return new records", () => {
  const step = { hunkIds: ["staged:a.js:1"] };
  const before = { "z.js:9": 1 };
  const read = markStep(step, before, 7);
  assert.deepEqual(read, { "z.js:9": 1, "a.js:1": 7 });
  assert.deepEqual(before, { "z.js:9": 1 });
  assert.deepEqual(unmarkStep({ hunkIds: ["working:a.js:1"] }, read), { "z.js:9": 1 });
});

test("prune keeps the newest marks", () => {
  const read = { a: 1, b: 4, c: 2, d: 3 };
  assert.equal(prune(read, 10), read);
  assert.deepEqual(Object.keys(prune(read, 2)).sort(), ["b", "d"]);
  assert.equal(Object.keys(prune(Object.fromEntries(Array.from({ length: 5003 }, (_, i) => [`k${i}`, i])))).length, 5000);
});

test("mergeRead lays this window's changes over another's", () => {
  const disk = { a: 1, b: 2, theirs: 3 };
  const mine = { a: 1, c: 4 }; // b unmarked here, c marked here
  assert.deepEqual(mergeRead(disk, mine, ["b", "c"]), { a: 1, theirs: 3, c: 4 });
  assert.deepEqual(mergeRead(null, mine, ["c"]), { c: 4 });
  assert.deepEqual(mergeRead({ a: 1, b: 2 }, {}, []), { a: 1, b: 2 });
});

test("changedSince: steps read before whose code changed", () => {
  const read = { "a.js:1": 1, "b.js:2": 1, "c.js:3": 1 };
  const steps = [
    { id: "s1", hunkIds: ["working:a.js:1"] }, // read, unchanged
    { id: "s2", hunkIds: ["working:b.js:2"], outdated: true }, // read, then its code moved
    { id: "s3", hunkIds: ["working:c.js:3", "working:c.js:8"] }, // one of two hunks is new
    { id: "s4", hunkIds: ["working:d.js:4"] }, // never read
    { id: "s5", hunkIds: ["working:e.js:9"] }, // regenerated after its one read hunk was edited
  ];
  const before = ["working:a.js:1", "working:e.js:5"];
  const current = ["working:a.js:1", "working:c.js:3", "working:c.js:8", "working:d.js:4", "working:e.js:9"];
  assert.deepEqual(changedSince(steps, read, { before, current }).map((s) => s.id), ["s2", "s3"]);
  assert.deepEqual(changedSince(steps, { ...read, "e.js:5": 1 }, { before, current }).map((s) => s.id), ["s2", "s3", "s5"]);
  // Nothing read: nothing changed since.
  assert.deepEqual(changedSince(steps, {}, { before, current }), []);
});
