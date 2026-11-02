// The git side against real throwaway repositories.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoAt, currentHead, loadSections, defaultBase, baseChoices, recentCommits, sourceKey, describe, MAX_UNTRACKED_BYTES, pullRequests, ghError, turnsKey } from "../mods/walkthrough/lib/sources.js";
import { buildDigest } from "../mods/walkthrough/lib/digest.js";
import { jobScript, readOutcome } from "../mods/walkthrough/lib/job.js";
import { chmodSync, readFileSync, existsSync, utimesSync } from "node:fs";

const exec = (cmd, args, { cwd } = {}) => new Promise((resolve) => execFile(cmd, args, { cwd, maxBuffer: 1 << 26 },
  (e, stdout, stderr) => resolve({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout, stderr })));
const sh = async (cwd, ...args) => {
  const r = await exec("git", args, { cwd });
  if (r.code !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};

let dir;
before(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "walkthrough-")));
  await sh(dir, "init", "-q", "-b", "main");
  await sh(dir, "config", "user.email", "t@t");
  await sh(dir, "config", "user.name", "t");
  // The user's own diff settings must not change what is parsed.
  await sh(dir, "config", "diff.noprefix", "true");
  await sh(dir, "config", "color.diff", "always");
  writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
  writeFileSync(join(dir, "b.txt"), "b\n");
  await sh(dir, "add", "-A");
  await sh(dir, "commit", "-qm", "first");
});
after(() => rmSync(dir, { recursive: true, force: true }));

const paths = async (source) => {
  const { sections, unread } = await loadSections(exec, dir, source);
  const d = buildDigest(sections);
  return { files: d.files.map((f) => `${f.scope}:${f.path}:${f.status}`), unread };
};

test("repoAt and recent commits", async () => {
  mkdirSync(join(dir, "sub"), { recursive: true });
  const repo = await repoAt(exec, join(dir, "sub"));
  assert.deepEqual(repo, { top: dir, name: dir.split("/").pop(), branch: "main", born: true, gitDir: `${dir}/.git` });
  assert.equal(await repoAt(exec, tmpdir()), null);
  const commits = await recentCommits(exec, dir);
  assert.equal(commits[0].subject, "first");
  assert.equal(commits[0].hash.length, 40);
});

test("working tree scopes: staged, unstaged and new files apart", async () => {
  writeFileSync(join(dir, "a.txt"), "one\nTWO\n");
  await sh(dir, "add", "a.txt");
  writeFileSync(join(dir, "b.txt"), "B\n");
  writeFileSync(join(dir, "new file.txt"), "hello\n");
  assert.deepEqual((await paths({ kind: "staged" })).files, ["staged:a.txt:modified"]);
  assert.deepEqual((await paths({ kind: "unstaged" })).files, ["working:b.txt:modified", "working:new file.txt:added"]);
  assert.deepEqual((await paths({ kind: "uncommitted" })).files, ["staged:a.txt:modified", "working:b.txt:modified", "working:new file.txt:added"]);
});

test("large new files are listed, not read", async () => {
  writeFileSync(join(dir, "big.log"), "x".repeat(MAX_UNTRACKED_BYTES + 10));
  const { files, unread } = await paths({ kind: "unstaged" });
  assert.ok(!files.some((f) => f.includes("big.log")));
  assert.deepEqual(unread, [{ path: "big.log", why: "Not read: larger than 1 MB." }]);
  rmSync(join(dir, "big.log"));
});

test("an unreadable new file doesn't shift the sizes of the files after it", { skip: process.getuid?.() === 0 }, async () => {
  writeFileSync(join(dir, "a-locked.txt"), "secret\n");
  chmodSync(join(dir, "a-locked.txt"), 0);
  writeFileSync(join(dir, "b-big.log"), "x".repeat(MAX_UNTRACKED_BYTES + 10));
  writeFileSync(join(dir, "c-small.txt"), "small\n");
  const { files, unread } = await paths({ kind: "unstaged" });
  assert.ok(files.includes("working:c-small.txt:added"));
  assert.ok(!files.some((f) => f.includes("b-big.log")));
  assert.deepEqual(unread.map((u) => u.path).sort(), ["a-locked.txt", "b-big.log"]);
  for (const f of ["a-locked.txt", "b-big.log", "c-small.txt"]) rmSync(join(dir, f), { force: true });
});

test("new files keep git's order, a binary one included, and unchanged ones aren't diffed again", async () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "walkthrough-order-")));
  await sh(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "a\n");
  writeFileSync(join(repo, "b.bin"), Buffer.from([0, 1, 2, 0, 255]));
  for (let i = 0; i < 8; i++) writeFileSync(join(repo, `c${i}.txt`), `${i}\n`);
  let diffs = 0;
  const counting = (cmd, args, opts) => { if (args.includes("--no-index")) diffs++; return exec(cmd, args, opts); };
  const order = async () => buildDigest((await loadSections(counting, repo, { kind: "unstaged" })).sections).files.map((f) => f.path);
  const first = await order();
  assert.deepEqual(first, ["a.txt", "b.bin", ...Array.from({ length: 8 }, (_, i) => `c${i}.txt`)]);
  assert.equal(diffs, 10);
  for (let i = 0; i < 5; i++) assert.deepEqual(await order(), first);
  assert.equal(diffs, 10);
  // A changed file is read again, and only it.
  writeFileSync(join(repo, "a.txt"), "a changed\n");
  await order();
  assert.equal(diffs, 11);
  rmSync(repo, { recursive: true, force: true });
});

test("a commit against its parent, and the root commit against nothing", async () => {
  await sh(dir, "add", "-A");
  await sh(dir, "commit", "-qm", "second");
  const [second, first] = (await recentCommits(exec, dir)).map((c) => c.hash);
  assert.deepEqual((await paths({ kind: "commit", hash: second })).files, ["commit:a.txt:modified", "commit:b.txt:modified", "commit:new file.txt:added"]);
  assert.deepEqual((await paths({ kind: "commit", hash: first })).files, ["commit:a.txt:added", "commit:b.txt:added"]);
});

test("a branch against its base: committed and uncommitted work, not the base's", async () => {
  await sh(dir, "checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, "f.txt"), "feature\n");
  await sh(dir, "add", "-A");
  await sh(dir, "commit", "-qm", "feature");
  await sh(dir, "checkout", "-q", "main");
  writeFileSync(join(dir, "m.txt"), "main moved on\n");
  await sh(dir, "add", "-A");
  await sh(dir, "commit", "-qm", "main");
  await sh(dir, "checkout", "-q", "feature");
  writeFileSync(join(dir, "a.txt"), "edited on feature\n");
  writeFileSync(join(dir, "g.txt"), "untracked\n");
  assert.equal(await defaultBase(exec, dir, "feature"), "main");
  assert.equal(await defaultBase(exec, dir, "main"), null);
  assert.deepEqual(await baseChoices(exec, dir, "feature"), ["main"]);
  assert.deepEqual((await paths({ kind: "branch", base: "main" })).files, ["branch:a.txt:modified", "branch:f.txt:added", "branch:g.txt:added"]);
});

test("run.sh stops a claude that hangs, and the reason is the error", async () => {
  const job = mkdtempSync(join(tmpdir(), "walkthrough-job-"));
  const bin = join(job, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), "#!/bin/sh\nsleep 60\n");
  chmodSync(join(bin, "claude"), 0o755);
  for (const f of ["schema.json", "system.txt", "prompt.txt"]) writeFileSync(join(job, f), "{}");
  writeFileSync(join(job, "run.sh"), jobScript());
  const started = Date.now();
  await new Promise((resolve) => execFile("sh", [join(job, "run.sh"), "haiku", "1"], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }, resolve));
  assert.ok(Date.now() - started < 20_000);
  assert.ok(existsSync(join(job, "code")));
  assert.throws(() => readOutcome({ out: readFileSync(join(job, "out.json"), "utf8"), err: readFileSync(join(job, "err.txt"), "utf8"), code: readFileSync(join(job, "code"), "utf8") }), /Stopped after 1 seconds/);
  rmSync(job, { recursive: true, force: true });
});

test("a merge conflict in the working tree shows as conflicted, not as the file before it", async () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "walkthrough-merge-")));
  await sh(repo, "init", "-q", "-b", "main");
  await sh(repo, "config", "user.email", "t@t");
  await sh(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "a.txt"), "a\n");
  writeFileSync(join(repo, "b.txt"), "base\n");
  await sh(repo, "add", "-A");
  await sh(repo, "commit", "-qm", "base");
  await sh(repo, "checkout", "-q", "-b", "other");
  writeFileSync(join(repo, "b.txt"), "theirs\n");
  await sh(repo, "commit", "-qam", "theirs");
  await sh(repo, "checkout", "-q", "main");
  writeFileSync(join(repo, "b.txt"), "ours\n");
  await sh(repo, "commit", "-qam", "ours");
  await exec("git", ["merge", "other"], { cwd: repo }); // conflicts, exits 1
  writeFileSync(join(repo, "a.txt"), "A\n");
  const { sections } = await loadSections(exec, repo, { kind: "unstaged" });
  const files = buildDigest(sections).files.map((f) => `${f.path}:${f.status}:${f.hunks.length}`);
  assert.deepEqual(files.sort(), ["a.txt:modified:1", "b.txt:conflicted:0"]);
  rmSync(repo, { recursive: true, force: true });
});

test("a linked worktree reports its own git folder, and the head follows checkouts", async () => {
  const wt = join(tmpdir(), `walkthrough-wt-${process.pid}`);
  await sh(dir, "worktree", "add", "-q", "-b", "wt-branch", wt);
  const repo = await repoAt(exec, wt);
  assert.match(repo.gitDir, /\.git\/worktrees\//);
  assert.equal(await currentHead(exec, wt), "wt-branch");
  await sh(wt, "checkout", "-q", "--detach");
  assert.match(await currentHead(exec, wt), /^HEAD@[0-9a-f]+$/);
  await sh(dir, "worktree", "remove", "--force", wt);
});

test("source keys and descriptions", () => {
  assert.equal(sourceKey({ kind: "staged" }), "staged");
  // Each branch read against a base is its own walkthrough.
  assert.equal(sourceKey({ kind: "branch", base: "main", head: "feature-a" }), "branch:main...feature-a");
  assert.notEqual(sourceKey({ kind: "branch", base: "main", head: "feature-a" }), sourceKey({ kind: "branch", base: "main", head: "feature-b" }));
  assert.equal(sourceKey({ kind: "commit", hash: "abc" }), "commit:abc");
  assert.match(describe({ kind: "branch", base: "main" }, { branch: "feature" }), /branch "feature" adds to "main"/);
  assert.match(describe({ kind: "commit", hash: "0123456789abcdef", subject: "Fix" }, null), /Commit 0123456789ab \("Fix"\)/);
  // A pull request is one walkthrough whatever its head: when it moves on, the last one shows as outdated.
  assert.equal(sourceKey({ kind: "pr", number: 12, title: "T" }), "pr:12");
  assert.match(describe({ kind: "pr", number: 12, title: "Fix it", head: "fix", base: "main" }, null), /Pull request #12 \("Fix it"\), "fix" into "main"/);
});

// gh, faked: what it is asked, and what it answers.
const fakeGh = (answers) => {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    if (cmd !== "gh") throw new Error(`unexpected ${cmd}`);
    const a = answers[args.slice(0, 2).join(" ")];
    if (a === undefined) throw new Error("spawn gh ENOENT");
    return typeof a === "string" ? { code: 0, stdout: a, stderr: "" } : a;
  };
  return { exec, calls };
};

test("a pull request is read as GitHub shows it", async () => {
  const patch = "diff --git a/x.js b/x.js\nindex 1..2 100644\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\n";
  const { exec, calls } = fakeGh({ "pr diff": patch });
  const { sections, unread } = await loadSections(exec, "/repo", { kind: "pr", number: 7 });
  assert.deepEqual(calls, ["gh pr diff 7 --color=never"]);
  assert.deepEqual(sections, [{ scope: "pr", patch }]);
  assert.deepEqual(unread, []);
  assert.equal(buildDigest(sections).files[0].hunks.length, 1);
});

test("gh's failures say what to do", async () => {
  await assert.rejects(loadSections(fakeGh({}).exec, "/repo", { kind: "pr", number: 7 }), /isn't installed/);
  const failing = (stderr) => fakeGh({ "pr diff": { code: 1, stdout: "", stderr } }).exec;
  await assert.rejects(loadSections(failing("HTTP 406: Sorry, the diff exceeded the maximum number of files (300)."), "/repo", { kind: "pr", number: 7 }), /Read it as a Branch/);
  assert.match(ghError("To get started with GitHub CLI, please run:  gh auth login"), /isn't logged in/);
  assert.match(ghError("no git remotes found"), /no GitHub remote/);
  assert.match(ghError("GraphQL: Could not resolve to a PullRequest with the number of 99999. (repository.pullRequest)"), /wasn't found/);
  assert.equal(ghError("first\nsomething else\n"), "something else");
});

test("open pull requests, newest update first, the current branch's marked", async () => {
  const list = [
    { number: 1, title: "Old", headRefName: "a", baseRefName: "main", author: { login: "x" }, isDraft: false, updatedAt: "2026-10-01T00:00:00Z" },
    { number: 2, title: "Mine", headRefName: "feature", baseRefName: "main", author: { login: "y" }, isDraft: true, updatedAt: "2026-10-30T00:00:00Z" },
  ];
  const { exec, calls } = fakeGh({ "pr list": JSON.stringify(list) });
  const prs = await pullRequests(exec, "/repo", "feature");
  assert.match(calls[0], /^gh pr list --state open --limit 50 --json number,title,headRefName,baseRefName,author,isDraft,updatedAt$/);
  assert.deepEqual(prs.map((p) => [p.number, p.author, p.draft, p.current]), [[2, "y", true, true], [1, "x", false, false]]);
  await assert.rejects(pullRequests(fakeGh({ "pr list": "not json" }).exec, "/repo"), /something other than a list/);
});

// ——— Last turn: hooks/turn.sh against a real repository ———

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { parseListing, resolveEnds, turnSource, LISTING } from "../mods/walkthrough/lib/turns.js";

const TURN_SH = new URL("../mods/walkthrough/hooks/turn.sh", import.meta.url).pathname;

/** Every file under .git/objects with its size and time, and the index's bytes: what a snapshot must leave alone. */
function gitState(repo) {
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(`${p}:${statSync(p).size}:${statSync(p).mtimeMs}`); } };
  walk(join(repo, ".git/objects"));
  return { objects: files.sort(), index: readFileSync(join(repo, ".git/index")).toString("base64") };
}

test("a turn: the hooks snapshot before and after, and the turn reads as exactly what changed in between", async () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "walkthrough-turn-")));
  const home = realpathSync(mkdtempSync(join(tmpdir(), "walkthrough-home-")));
  await sh(repo, "init", "-q", "-b", "main");
  await sh(repo, "config", "user.email", "t@t");
  await sh(repo, "config", "user.name", "t");
  // The commit's own background maintenance would come and go under .git/objects while it is compared.
  await sh(repo, "config", "maintenance.auto", "false");
  await sh(repo, "config", "gc.auto", "0");
  writeFileSync(join(repo, "a.txt"), "one\ntwo\n");
  writeFileSync(join(repo, "keep.txt"), "kept\n");
  await sh(repo, "add", "-A");
  await sh(repo, "commit", "-qm", "first");
  // Work from before the turn is not the turn's.
  writeFileSync(join(repo, "keep.txt"), "edited before the turn\n");
  writeFileSync(join(repo, "early.txt"), "new before the turn\n");
  const before = gitState(repo);
  const hook = (event, input) => spawnSync("sh", [TURN_SH, event], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, HOME: home, HC_TERMINAL_ID: "t1" } });

  assert.equal(hook("start", { session_id: "s1", cwd: join(repo), hook_event_name: "UserPromptSubmit", prompt: "Make two TWO" }).status, 0);
  writeFileSync(join(repo, "a.txt"), "one\nTWO\n");
  writeFileSync(join(repo, "added.txt"), "added in the turn\n");
  writeFileSync(join(repo, "huge.log"), "x".repeat(MAX_UNTRACKED_BYTES + 10));
  mkdirSync(join(repo, "sub"));
  const listed = () => {
    const base = join(home, ".herdr/walkthrough/turns");
    const folder = join(base, readdirSync(base).find((n) => !n.startsWith("input.")));
    return resolveEnds(parseListing(spawnSync("sh", ["-c", LISTING, folder], { encoding: "utf8" }).stdout, folder));
  };
  const read = async (turn) => buildDigest((await loadSections(exec, repo, turnSource(turn))).sections).files.map((f) => `${f.scope}:${f.path}:${f.status}`);

  // Still running: read up to now.
  const [running] = listed();
  assert.equal(running.state, "running");
  assert.equal(running.prompt, "Make two TWO");
  assert.deepEqual(await read(running), ["turn:a.txt:modified", "turn:added.txt:added"]);
  const unread = async (turn) => (await loadSections(exec, repo, turnSource(turn))).unread;
  assert.deepEqual(await unread(running), [{ path: "huge.log", why: "Not read: larger than 1 MB." }]);

  assert.equal(hook("stop", { session_id: "s1", cwd: repo, hook_event_name: "Stop" }).status, 0);
  writeFileSync(join(repo, "after.txt"), "after the turn\n");
  const [done] = listed();
  assert.equal(done.state, "done");
  assert.equal(done.terminal, "t1");
  assert.deepEqual(await read(done), ["turn:a.txt:modified", "turn:added.txt:added"]);
  assert.deepEqual(await unread(done), [{ path: "huge.log", why: "Not read: larger than 1 MB." }]);
  assert.equal(sourceKey(turnSource(done)), `turn:${done.id}`);
  assert.match(describe(turnSource(done)), /answered the prompt "Make two TWO"/);

  // Neither the hooks nor the reads wrote to the repository's index or objects.
  assert.deepEqual(gitState(repo), before);
  const status = (await exec("git", ["status", "--porcelain"], { cwd: repo })).stdout.split("\n").filter(Boolean);
  assert.deepEqual(status, [" M a.txt", " M keep.txt", "?? added.txt", "?? after.txt", "?? early.txt", "?? huge.log"]);
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

/** A throwaway repository, the hook run in it, and its turns read back. */
async function turnRepo({ init = [], config = [] } = {}) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "walkthrough-turn-")));
  const home = realpathSync(mkdtempSync(join(tmpdir(), "walkthrough-home-")));
  await sh(repo, "init", "-q", "-b", "main", ...init);
  for (const [k, v] of [["user.email", "t@t"], ["user.name", "t"], ["maintenance.auto", "false"], ...config]) await sh(repo, "config", k, v);
  writeFileSync(join(repo, "a.txt"), "a\n");
  await sh(repo, "add", "-A");
  await sh(repo, "commit", "-qm", "first");
  const hook = (event) => assert.equal(spawnSync("sh", [TURN_SH, event], { input: JSON.stringify({ session_id: "s", cwd: repo, prompt: "p" }), encoding: "utf8", env: { ...process.env, HOME: home } }).status, 0);
  const base = join(home, ".herdr/walkthrough/turns");
  const turns = () => {
    const folder = join(base, readdirSync(base).find((n) => !n.startsWith("input.")));
    return resolveEnds(parseListing(spawnSync("sh", ["-c", LISTING, folder], { encoding: "utf8" }).stdout, folder));
  };
  const files = async (turn) => {
    const { sections, unread } = await loadSections(exec, repo, turnSource(turn));
    return { files: buildDigest(sections).files.map((f) => `${f.path}:${f.status}`), unread: unread.map((u) => u.path) };
  };
  const done = () => { rmSync(repo, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); };
  return { repo, base, hook, turns, files, done };
}

test("a new file that grows past 1 MB during a turn is listed unread, not shown unchanged or deleted", async () => {
  const r = await turnRepo();
  writeFileSync(join(r.repo, "data.json"), "{}\n");
  r.hook("start");
  writeFileSync(join(r.repo, "data.json"), "x".repeat(MAX_UNTRACKED_BYTES + 10));
  writeFileSync(join(r.repo, "a.txt"), "A\n");
  assert.deepEqual(await r.files(r.turns()[0]), { files: ["a.txt:modified"], unread: ["data.json"] });
  r.hook("stop");
  const [turn] = r.turns();
  assert.equal(turn.state, "done");
  assert.deepEqual(await r.files(turn), { files: ["a.txt:modified"], unread: ["data.json"] });
  // A file that was already that big when the turn began is no news.
  r.hook("start");
  writeFileSync(join(r.repo, "a.txt"), "AA\n");
  r.hook("stop");
  assert.deepEqual(await r.files(r.turns()[0]), { files: ["a.txt:modified"], unread: [] });
  r.done();
});

test("the mod names a SHA-256 repository's turns folder as the hook does", async () => {
  const r = await turnRepo({ init: ["--object-format=sha256"] });
  r.hook("start");
  writeFileSync(join(r.repo, "a.txt"), "b\n");
  r.hook("stop");
  const key = await turnsKey(exec, r.repo);
  assert.ok(existsSync(join(r.base, key)), `${key} in ${readdirSync(r.base)}`);
  assert.deepEqual((await r.files(r.turns()[0])).files, ["a.txt:modified"]);
  r.done();
});

test("a copied index git can't use (split, or broken): the hook and the mod's own snapshot both start over without it", async () => {
  const r = await turnRepo({ config: [["core.splitIndex", "true"]] });
  await sh(r.repo, "update-index", "--split-index");
  r.hook("start");
  writeFileSync(join(r.repo, "a.txt"), "changed\n");
  writeFileSync(join(r.repo, "n.txt"), "new\n");
  const [running] = r.turns();
  assert.equal(running.state, "running");
  assert.deepEqual((await r.files(running)).files, ["a.txt:modified", "n.txt:added"]);
  // Whatever makes the copy unusable, the snapshot drops it and starts over.
  writeFileSync(join(running.dir, "now.index"), "not an index");
  assert.deepEqual((await r.files(running)).files, ["a.txt:modified", "n.txt:added"]);
  writeFileSync(join(running.dir, "index"), "not an index");
  r.hook("stop");
  assert.deepEqual((await r.files(r.turns()[0])).files, ["a.txt:modified", "n.txt:added"]);
  r.done();
});

test("when every copy of the repository's index is one git can't use, the mod's own snapshot starts over without one, as the hook does", async () => {
  const r = await turnRepo();
  r.hook("start");
  writeFileSync(join(r.repo, "a.txt"), "changed\n");
  writeFileSync(join(r.repo, "n.txt"), "new\n");
  const [running] = r.turns();
  // Each copy (`cp -p <real> <index>`) comes out unreadable.
  const broken = (cmd, args, opts) => cmd === "sh" && /cp -p/.test(args[1]) ? exec("sh", ["-c", 'printf "not an index" > "$0"', args[3]], opts) : exec(cmd, args, opts);
  const { sections } = await loadSections(broken, r.repo, turnSource(running));
  assert.deepEqual(buildDigest(sections).files.map((f) => `${f.path}:${f.status}`), ["a.txt:modified", "n.txt:added"]);
  r.done();
});

test("a turn that can't be read says why: its folder was dropped, or git gc removed what its snapshots left to the repository", async () => {
  const r = await turnRepo();
  // Staged, never committed: the snapshot names the repository's object for it and keeps no copy.
  writeFileSync(join(r.repo, "staged.txt"), "staged\n");
  utimesSync(join(r.repo, "staged.txt"), 1, 1); // older than the index, or git hashes it again (racy git) and the turn keeps a copy
  await sh(r.repo, "add", "staged.txt");
  const blob = await sh(r.repo, "rev-parse", ":staged.txt");
  r.hook("start");
  writeFileSync(join(r.repo, "staged.txt"), "changed in the turn\n");
  r.hook("stop");
  const [turn] = r.turns();
  assert.deepEqual((await r.files(turn)).files, ["staged.txt:modified"]);
  // Unstaged, then pruned, as `git gc` would once nothing names it.
  await sh(r.repo, "reset", "-q", "--", "staged.txt");
  rmSync(join(r.repo, ".git/objects", blob.slice(0, 2), blob.slice(2)));
  await assert.rejects(r.files(turn), /git gc has removed/);
  rmSync(turn.dir, { recursive: true, force: true });
  await assert.rejects(r.files(turn), /only the newest 20 turns are kept/);
  r.done();
});
