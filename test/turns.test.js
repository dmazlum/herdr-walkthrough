// Turns: reading what hooks/turn.sh leaves, and the script's own bookkeeping.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, realpathSync, readdirSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHook, parseMeta, parseListing, sortTurns, resolveEnds, pickTurn, keepTurn, lastFinished, autoWritable, firstLine, ago, turnSource, hookSettings, LISTING, RECORD, FILE, QUIET, UNKNOWN, HOOK_TIMEOUT, HOOK_WAIT } from "../mods/walkthrough/lib/turns.js";

const SCRIPT = new URL("../mods/walkthrough/hooks/turn.sh", import.meta.url).pathname;
const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);

test("the hook's JSON: prompt, session and folder, even cut short", () => {
  const json = JSON.stringify({ session_id: "s1", transcript_path: "/t.jsonl", cwd: "/repo", hook_event_name: "UserPromptSubmit", prompt: "Fix the \"bug\"\nthen test" });
  assert.deepEqual(parseHook(json), { prompt: "Fix the \"bug\"\nthen test", session: "s1", cwd: "/repo", event: "UserPromptSubmit" });
  // The listing reads a bounded head of a long prompt: what is there is kept, a broken escape at the cut dropped.
  const cut = json.slice(0, json.indexOf("then") + 2);
  assert.equal(parseHook(cut).prompt, "Fix the \"bug\"\nth");
  assert.equal(parseHook(`${json.slice(0, json.indexOf("\\n") + 1)}`).prompt, "Fix the \"bug\"");
  assert.deepEqual(parseHook(""), { prompt: "", session: null, cwd: null, event: null });
  // `hc send` wraps what it pastes; a cut prompt may have lost the closing tag.
  assert.equal(parseHook(JSON.stringify({ prompt: '<hc from="t3m">Add subtract</hc>' })).prompt, "Add subtract");
  assert.equal(parseHook(JSON.stringify({ prompt: '<hc from="t3m">Add sub' })).prompt, "Add sub");
  assert.equal(parseHook(JSON.stringify({ prompt: "Use <hc> tags" })).prompt, "Use <hc> tags");
});

test("meta lines", () => {
  assert.deepEqual(parseMeta("tree=abc\nstarted=12\nsession=\nterminal=t3\n"), { tree: "abc", started: "12", session: "", terminal: "t3" });
});

const listing = (turns) => turns.map(({ id, start, end, json, big }) => `${RECORD}${id}\n`
  + (start ? `${FILE}start.meta\n${start}` : "") + (end ? `${FILE}end.meta\n${end}` : "") + (big ? `${FILE}end.big\n${big}` : "") + (json ? `${FILE}start.json\n${json}` : "")).join("");

test("a listing → turns, newest first, an unfinished start snapshot left out", () => {
  const out = listing([
    { id: "100-000001", start: `tree=${A}\nstarted=100\nsession=s\nterminal=t1\n`, end: `tree=${B}\nended=130\n`, json: JSON.stringify({ prompt: "first" }) },
    { id: "200-000002", start: `tree=${B}\nstarted=200\nsession=s\nterminal=\n`, json: JSON.stringify({ prompt: "second" }) },
    { id: "300-000003", json: JSON.stringify({ prompt: "snapshot still being taken" }) },
    { id: "junk" },
  ]);
  const turns = parseListing(out, "/turns/r");
  assert.deepEqual(turns.map((t) => t.id), ["200-000002", "100-000001"]);
  assert.deepEqual(turns[1], { id: "100-000001", dir: "/turns/r/100-000001", started: 100_000, ended: 130_000, startTree: A, endTree: B, frozen: false,
    startBig: [], endBig: [], session: "s", terminal: "t1", prompt: "first" });
  assert.equal(turns[0].endTree, null);
  assert.equal(turns[0].terminal, null);
  // An end the walkthrough froze, and the big files a snapshot left out.
  const [frozen] = parseListing(listing([{ id: "1-1", start: `tree=${A}\nstarted=1\n`, end: `tree=${B}\nended=2\ninterrupted=1\n`, big: "big.log\nsub/x.bin\n" }]), "/t");
  assert.equal(frozen.frozen, true);
  assert.deepEqual(frozen.endBig, ["big.log", "sub/x.bin"]);
  assert.equal(resolveEnds([frozen])[0].state, "interrupted");
});

test("where turns end: done, interrupted (the session went on), running", () => {
  const t = (id, started, session, endTree = null) => ({ id, dir: `/d/${id}`, started, ended: endTree ? started + 5 : null, startTree: `${id}`.padEnd(40, "0"), endTree, session, terminal: session === "s1" ? "t1" : "t2" });
  const turns = resolveEnds([t("1", 1, "s1", A), t("2", 2, "s1"), t("3", 3, "s2"), t("4", 4, "s1")], { now: 5 });
  assert.deepEqual(turns.map((x) => [x.id, x.state]), [["4", "running"], ["3", "running"], ["2", "interrupted"], ["1", "done"]]);
  const interrupted = turns.find((x) => x.id === "2");
  assert.equal(interrupted.endTree, turns[0].startTree);
  assert.equal(interrupted.endDir, "/d/4");
  assert.equal(interrupted.ended, 4);
  // A running turn is read up to now; the others against their end, in the end's folder.
  assert.equal(turnSource(turns[0]).endTree, null);
  assert.deepEqual(turnSource(interrupted), { kind: "turn", id: "2", dir: "/d/2", startTree: interrupted.startTree, endTree: turns[0].startTree, endDir: "/d/4",
    startBig: [], endBig: [], prompt: undefined });
  assert.equal(turnSource(turns[0]).endBig, null);
  assert.equal(pickTurn(turns, "t2").id, "3");
  assert.equal(pickTurn(turns, "t9").id, "4");
  assert.equal(pickTurn([], "t1"), null);
  assert.equal(lastFinished(turns), null);
  assert.equal(lastFinished(turns.slice(2)).id, "2");
  assert.equal(lastFinished(turns, ["t2"]), null);
});

test("a turn no Stop hook ended: over at the terminal's next prompt, or once its agent is quiet", () => {
  const t = (id, started, session, terminal) => ({ id, dir: `/d/${id}`, started, ended: null, startTree: id.padEnd(40, "0"), endTree: null, startBig: [id], session, terminal });
  const now = 10 * UNKNOWN;
  // /clear started a new session in the same terminal: the old session's turn ended there.
  const cleared = resolveEnds([t("1", now - 5000, "s1", "t1"), t("2", now - 1000, "s2", "t1")], { now });
  assert.deepEqual(cleared.map((x) => x.state), ["running", "interrupted"]);
  assert.deepEqual(cleared[1].endBig, ["2"]);
  const one = [t("1", now - QUIET * 3, "s1", "t1")];
  assert.equal(resolveEnds(one, { now, idleSince: () => null })[0].state, "running"); // working
  assert.equal(resolveEnds(one, { now, idleSince: () => now - QUIET / 2 })[0].state, "running"); // just stopped: a Stop hook may still come
  assert.equal(resolveEnds(one, { now, idleSince: () => now - QUIET * 2 })[0].state, "stale");
  // Quiet since before it began counts from its start.
  assert.equal(resolveEnds([t("1", now - 1000, "s1", "t1")], { now, idleSince: () => now - QUIET * 9 })[0].state, "running");
  // No agent to ask (recorded outside Herdr): over only when old.
  assert.equal(resolveEnds([t("1", now - 1000, "s1", null)], { now })[0].state, "running");
  assert.equal(resolveEnds([t("1", now - UNKNOWN - 1, "s1", null)], { now })[0].state, "stale");
  const stale = resolveEnds(one, { now, idleSince: () => 0 });
  assert.equal(lastFinished(stale), null);
  assert.equal(turnSource(stale[0]).endTree, null);
});

test("turns with no session recorded aren't one session: each ends only at its own terminal's next prompt", () => {
  const t = (id, started, terminal) => ({ id, dir: `/d/${id}`, started, ended: null, startTree: id.padEnd(40, "0"), endTree: null, session: null, terminal });
  assert.deepEqual(resolveEnds([t("1", 1, "t1"), t("2", 2, "t2")], { now: 3 }).map((x) => [x.id, x.state]), [["2", "running"], ["1", "running"]]);
  assert.deepEqual(resolveEnds([t("1", 1, "t1"), t("2", 2, "t1")], { now: 3 }).map((x) => [x.id, x.state]), [["2", "running"], ["1", "interrupted"]]);
  assert.deepEqual(resolveEnds([t("1", 1, null), t("2", 2, null)], { now: 3 }).map((x) => x.state), ["running", "running"]);
});

test("a turn the walkthrough froze is written only on Generate; one its agent ended, without a click", () => {
  const t = (state, frozen = false) => ({ id: "1", state, frozen });
  assert.equal(autoWritable(t("done")), true);
  assert.equal(autoWritable(t("interrupted")), true); // ended by the next prompt's snapshot
  assert.equal(autoWritable(t("interrupted", true)), false);
  assert.equal(autoWritable(t("running")), false);
  assert.equal(autoWritable(t("stale")), false);
  assert.equal(autoWritable(null), false);
});

test("waits on a Stop hook cover its timeout, and no more than that by much", () => {
  assert.equal(JSON.parse(hookSettings("/x")).hooks.Stop[0].hooks[0].timeout, HOOK_TIMEOUT);
  assert.ok(HOOK_WAIT > HOOK_TIMEOUT * 1000);
  // A frozen end takes in what happened after the agent stopped: the sooner, the less.
  assert.ok(QUIET <= HOOK_WAIT);
});

test("a turn picked by hand stays shown while it is listed; once it is gone, the picked one is shown and nothing is pinned", () => {
  const turns = [{ id: "3", terminal: "t1" }, { id: "2", terminal: "t2" }, { id: "1", terminal: "t1" }];
  assert.deepEqual(keepTurn(turns, { id: "1" }, true, "t2"), { turn: turns[2], pinned: true });
  assert.deepEqual(keepTurn(turns, { id: "1" }, false, "t2"), { turn: turns[1], pinned: false });
  const gone = keepTurn(turns, { id: "0" }, true, "t2");
  assert.deepEqual(gone, { turn: turns[1], pinned: false });
  // And a newer turn of the terminal is followed again.
  const newer = [{ id: "4", terminal: "t2" }, ...turns];
  assert.equal(keepTurn(newer, gone.turn, gone.pinned, "t2").turn.id, "4");
  assert.deepEqual(keepTurn([], { id: "1" }, true), { turn: null, pinned: false });
});

test("newest first, ties by name", () => {
  assert.deepEqual(sortTurns([{ id: "1-1", started: 1 }, { id: "1-2", started: 1 }, { id: "0-9", started: 0 }]).map((t) => t.id), ["1-2", "1-1", "0-9"]);
});

test("a prompt's first line, and how long ago", () => {
  assert.equal(firstLine("\n  Add the turn scope  \nand tests"), "Add the turn scope");
  assert.equal(firstLine("x".repeat(100), 10), `${"x".repeat(9)}…`);
  assert.equal(firstLine(null), "");
  const now = 1_000_000_000;
  assert.equal(ago(now - 5_000, now), "just now");
  assert.equal(ago(now - 5 * 60_000, now), "5 min ago");
  assert.equal(ago(now - 3 * 3600_000, now), "3 h ago");
  assert.equal(ago(now - 86400_000, now), "1 day ago");
});

test("the settings snippet is JSON naming both hooks", () => {
  const s = JSON.parse(hookSettings("/x/turn.sh"));
  assert.equal(s.hooks.UserPromptSubmit[0].hooks[0].command, 'sh "/x/turn.sh" start');
  assert.equal(s.hooks.Stop[0].hooks[0].command, 'sh "/x/turn.sh" stop');
});

// ——— the script ———

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const hook = (home, event, input, env = {}) => spawnSync("sh", [SCRIPT, event], { input, encoding: "utf8", env: { ...process.env, HOME: home, ...env } });

function repository() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "walkthrough-turns-")));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "first");
  return dir;
}

const folderOf = (home) => {
  const base = join(home, ".herdr/walkthrough/turns");
  return join(base, readdirSync(base).find((n) => !n.startsWith("input.")));
};

test("the script prints nothing and exits 0, in a repository or not", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "walkthrough-home-")));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "walkthrough-nogit-")));
  for (const [event, input] of [["start", JSON.stringify({ cwd: outside, prompt: "x" })], ["stop", "not json"], ["bogus", ""]]) {
    const r = hook(home, event, input);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "");
  }
  rmSync(home, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test("the script keeps a repository's newest 20 turns, each with its objects; the listing reads them back", () => {
  const repo = repository(), home = realpathSync(mkdtempSync(join(tmpdir(), "walkthrough-home-")));
  for (let i = 0; i < 22; i++) {
    writeFileSync(join(repo, `new${i}.txt`), `${i}\n`); // something for each turn's objects to hold
    assert.equal(hook(home, "start", JSON.stringify({ session_id: "s", cwd: repo, prompt: `turn ${i}` }), { HC_TERMINAL_ID: "t7" }).status, 0);
  }
  const folder = folderOf(home);
  const names = readdirSync(folder).filter((n) => /^\d+-\d+$/.test(n));
  assert.equal(names.length, 20);
  for (const n of names) assert.ok(existsSync(join(folder, n, "objects")));
  // Only the newest keeps an index to snapshot again.
  assert.equal(names.filter((n) => existsSync(join(folder, n, "index"))).length, 1);
  const turns = parseListing(execFileSync("sh", ["-c", LISTING, folder], { encoding: "utf8" }), folder);
  assert.equal(turns.length, 20);
  assert.ok(turns.every((t) => t.terminal === "t7" && t.session === "s" && /^turn \d+$/.test(t.prompt)));
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

const metaOf = (dir) => parseMeta(existsSync(dir) ? readFileSync(dir, "utf8") : "");

test("a Stop ends its session's newest turn again, but never an older one in place of a turn with no start snapshot", () => {
  const repo = repository(), home = realpathSync(mkdtempSync(join(tmpdir(), "walkthrough-home-")));
  const input = JSON.stringify({ session_id: "s", cwd: repo, prompt: "p" });
  hook(home, "start", input);
  writeFileSync(join(repo, "a.txt"), "b\n");
  hook(home, "stop", input);
  const folder = folderOf(home);
  const [id] = readdirSync(folder).filter((n) => /^\d+-\d+$/.test(n));
  const end = () => metaOf(join(folder, id, "end.meta")).tree;
  const first = end();
  // A stop hook kept the agent going: the same turn ends again, later.
  writeFileSync(join(repo, "a.txt"), "c\n");
  hook(home, "stop", input);
  const second = end();
  assert.notEqual(second, first);
  // The next prompt's snapshot failed (or its hook's timeout cut it short): start.json, no start.meta.
  const next = join(folder, `${id.split("-")[0]}-999999`);
  mkdirSync(next);
  writeFileSync(join(next, "start.json"), input);
  writeFileSync(join(repo, "a.txt"), "d\n");
  hook(home, "stop", input);
  assert.equal(end(), second);
  assert.equal(existsSync(join(next, "end.meta")), false);
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("a new turn drops the indexes of ended turns and of its session's earlier ones, not another session's running turn's", () => {
  const repo = repository(), home = realpathSync(mkdtempSync(join(tmpdir(), "walkthrough-home-")));
  const input = (session) => JSON.stringify({ session_id: session, cwd: repo, prompt: session });
  const indexes = () => {
    const folder = folderOf(home);
    return readdirSync(folder).filter((n) => /^\d+-\d+$/.test(n)).sort()
      .map((n) => `${metaOf(join(folder, n, "start.meta")).session}:${existsSync(join(folder, n, "end.meta")) ? "ended" : "open"}:${existsSync(join(folder, n, "index")) ? "index" : "-"}`);
  };
  hook(home, "start", input("a"));
  hook(home, "start", input("b"));
  assert.deepEqual(indexes(), ["a:open:index", "b:open:index"]);
  hook(home, "start", input("b")); // b's first turn was stopped with Esc
  assert.deepEqual(indexes(), ["a:open:index", "b:open:-", "b:open:index"]);
  hook(home, "stop", input("a"));
  hook(home, "start", input("b"));
  assert.deepEqual(indexes(), ["a:ended:-", "b:open:-", "b:open:-", "b:open:index"]);
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});
