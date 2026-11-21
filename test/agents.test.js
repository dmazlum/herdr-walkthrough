// Agents with no hooks (pi, codex, opencode): reading their sessions, and
// recording their turns while a walkthrough is open.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSessionHeads, parsePiSession, parseCodexSession, parseOpencode, mergePrompts, inRepo, SESSION_HEADS } from "../mods/walkthrough/lib/agents.js";
import { recorderState, recorderStep, lookSince, RECORD_QUIET, RECORD_SETTLE, RECORD_LOOKBACK } from "../mods/walkthrough/lib/recorder.js";
import { parseListing, RECORDER_LOCK, RECORD } from "../mods/walkthrough/lib/turns.js";

const OPENCODE = join(dirname(fileURLToPath(import.meta.url)), "../mods/walkthrough/lib/opencode-prompts.py");
const jsonl = (...lines) => lines.map((l) => JSON.stringify(l)).join("\n");

test("a session belongs to a repository at its top or below, never a sibling", () => {
  assert.ok(inRepo("/x/repo", "/x/repo"));
  assert.ok(inRepo("/x/repo/sub", "/x/repo"));
  assert.ok(!inRepo("/x/repo-2", "/x/repo"));
  assert.ok(!inRepo(null, "/x/repo"));
});

test("pi sessions: the person's prompts in this repository since a moment", () => {
  const text = jsonl(
    { type: "session", cwd: "/x/repo" },
    { type: "message", timestamp: "2026-11-01T10:00:00Z", message: { role: "user", content: [{ type: "text", text: "old" }] } },
    { type: "message", timestamp: "2026-11-01T11:00:00Z", message: { role: "user", content: [{ type: "text", text: "Add a cache" }] } },
    { type: "message", timestamp: "2026-11-01T11:00:01Z", message: { role: "assistant", content: [{ type: "text", text: "Sure" }] } },
    { type: "message", timestamp: "2026-11-01T11:00:02Z", message: { role: "user", content: "/compact" } },
  );
  const since = Date.parse("2026-11-01T10:30:00Z");
  assert.deepEqual(parsePiSession(text, { top: "/x/repo", since, session: "pi:/s" }),
    [{ at: Date.parse("2026-11-01T11:00:00Z"), text: "Add a cache", session: "pi:/s", agent: "pi" }]);
  assert.deepEqual(parsePiSession(text, { top: "/x/other", since }), []);
});

test("codex rollouts: user messages, without the instructions codex sends first", () => {
  const text = jsonl(
    { type: "session_meta", payload: { cwd: "/x/repo/sub" } },
    { type: "response_item", timestamp: "2026-11-01T11:00:00Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions for /x/repo" }] } },
    { type: "response_item", timestamp: "2026-11-01T11:00:01Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>cwd</environment_context>" }] } },
    { type: "response_item", timestamp: "2026-11-01T11:00:02Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Fix the login bug" }] } },
  );
  assert.deepEqual(parseCodexSession(text, { top: "/x/repo", session: "codex:/r" }).map((p) => p.text), ["Fix the login bug"]);
});

test("session heads give each file's working folder, even from a first line cut short", () => {
  const out = `\x1e/s/a.jsonl\n1700000000\n{"type":"session","cwd":"/x/re\\"po"}\n\x1e/s/b.jsonl\n1700000001\n{"type":"session_meta","payload":{"cwd": "/y","instructions":"…cut`;
  assert.deepEqual(parseSessionHeads(out), [
    { path: "/s/a.jsonl", mtime: 1_700_000_000_000, cwd: '/x/re"po' },
    { path: "/s/b.jsonl", mtime: 1_700_000_001_000, cwd: "/y" },
  ]);
});

test("SESSION_HEADS lists only the sessions written lately, with their first line", () => {
  const root = mkdtempSync(join(tmpdir(), "walkthrough-sessions-"));
  mkdirSync(join(root, "p"));
  writeFileSync(join(root, "p", "new.jsonl"), `${JSON.stringify({ type: "session", cwd: "/x/repo" })}\n{"more":1}\n`);
  writeFileSync(join(root, "p", "old.jsonl"), `${JSON.stringify({ type: "session", cwd: "/x/repo" })}\n`);
  const hourAgo = new Date(Date.now() - 3600_000);
  utimesSync(join(root, "p", "old.jsonl"), hourAgo, hourAgo);
  const out = execFileSync("sh", ["-c", SESSION_HEADS, "5", root, join(root, "missing")], { encoding: "utf8" });
  const heads = parseSessionHeads(out);
  assert.deepEqual(heads.map((h) => [h.path, h.cwd]), [[join(root, "p", "new.jsonl"), "/x/repo"]]);
  assert.ok(Math.abs(heads[0].mtime - Date.now()) < 120_000);
  rmSync(root, { recursive: true, force: true });
});

test("opencode: a missing database is no prompts; a changed one is an error, told apart", () => {
  assert.deepEqual(parseOpencode(JSON.stringify({ prompts: [{ at: 5, text: "Do it", session: "s1" }, { at: 1, text: "old" }], active: 9 }), 2),
    { prompts: [{ at: 5, text: "Do it", session: "opencode:s1", agent: "opencode" }], active: 9, error: null });
  assert.equal(parseOpencode(JSON.stringify({ error: "no such table: session_v2" })).error, "no such table: session_v2");
  assert.ok(parseOpencode("not json").error);
});

const python = spawnSync("python3", ["-c", "import sqlite3"]).status === 0;

test("opencode-prompts.py matches the repository by prefix, without LIKE wildcards", { skip: !python && "no python3" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "walkthrough-opencode-"));
  const db = join(dir, "opencode.db");
  execFileSync("python3", ["-c", `
import sqlite3, sys, json
con = sqlite3.connect(sys.argv[1])
con.execute("create table session_v2 (id text, directory text)")
con.execute("create table session_message (session_id text, time_created int, type text, data text)")
for sid, d in [("a", "/x/my_repo"), ("b", "/x/my_repo/sub"), ("c", "/x/myXrepo"), ("d", "/x/myXrepo/sub"), ("e", "/x/my_repo2")]:
    con.execute("insert into session_v2 values (?, ?)", (sid, d))
    con.execute("insert into session_message values (?, 100, 'user', ?)", (sid, json.dumps({"text": "from " + sid})))
    con.execute("insert into session_message values (?, 200, 'assistant', '{}')", (sid,))
con.commit()
`, db]);
  const out = JSON.parse(execFileSync("python3", [OPENCODE, "/x/my_repo", "0", db], { encoding: "utf8" }));
  assert.deepEqual(out.prompts.map((p) => p.text).sort(), ["from a", "from b"]);
  assert.equal(out.active, 200);

  const missing = JSON.parse(execFileSync("python3", [OPENCODE, "/x/my_repo", "0", join(dir, "none.db")], { encoding: "utf8" }));
  assert.deepEqual(missing, { prompts: [], active: 0 });

  const other = join(dir, "other.db");
  execFileSync("python3", ["-c", "import sqlite3, sys; sqlite3.connect(sys.argv[1]).execute('create table x (y)')", other]);
  const changed = spawnSync("python3", [OPENCODE, "/x/my_repo", "0", other], { encoding: "utf8" });
  assert.equal(changed.status, 2);
  assert.match(JSON.parse(changed.stdout).error, /no such table/);
  rmSync(dir, { recursive: true, force: true });
});

test("prompts from several agents are merged oldest first, the same one once", () => {
  const a = { at: 2, text: "b" }, b = { at: 1, text: "a" };
  assert.deepEqual(mergePrompts([[a, b], [{ ...a }]]), [b, a]);
});

const prompt = (at, text, session = "pi:/s") => ({ at, text, session });

test("the recorder starts a turn on a new prompt, and ignores prompts from before it was opened", () => {
  const s = recorderState(1000);
  assert.deepEqual(recorderStep(s, { prompts: [prompt(500, "old")], now: 4000 }).start, null);
  const step = recorderStep(s, { prompts: [prompt(500, "old"), prompt(3000, "Add a cache")], now: 4000 });
  assert.deepEqual(step.start, { prompt: "Add a cache", session: "pi:/s", started: 3000 });
  assert.equal(step.end, null);
  assert.equal(step.seenAt, 3000);
});

test("a turn longer than the quiet time isn't cut while the agent or the tree is active", () => {
  const turn = { started: 0 };
  let s = { seenAt: 0, lastActivity: 0, turn };
  // Five minutes in: the agent kept writing to its session.
  let step = recorderStep(s, { active: 290_000, now: 300_000 });
  assert.equal(step.end, null);
  s = { ...s, lastActivity: step.lastActivity };
  // The session went still, but the working tree changed since.
  step = recorderStep(s, { active: 290_000, treeAt: 320_000, now: 290_000 + RECORD_QUIET + 1 });
  assert.equal(step.end, null);
  s = { ...s, lastActivity: step.lastActivity };
  // Both still for the quiet time: it ended, not interrupted.
  step = recorderStep(s, { active: 290_000, treeAt: 320_000, now: 320_000 + RECORD_QUIET + 1 });
  assert.deepEqual(step.end, { interrupted: false });
});

test("several prompts seen at once make one turn; a prompt sent mid-work interrupts the turn before", () => {
  const s = { seenAt: 0, lastActivity: 9_000, turn: { started: 1 } };
  const step = recorderStep(s, { prompts: [prompt(12_000, "second", "pi:/b"), prompt(10_000, "first")], now: 13_000 });
  assert.deepEqual(step.start, { prompt: "first\n\nsecond", session: "pi:/b", started: 10_000 });
  assert.deepEqual(step.end, { interrupted: true });
  // The agent had been still a while before the next prompt: the turn before ended normally.
  const calm = recorderStep({ ...s, lastActivity: 10_000 - RECORD_SETTLE - 1 }, { prompts: [prompt(10_000, "next")], now: 11_000 });
  assert.deepEqual(calm.end, { interrupted: false });
});

test("the recorder looks back only as far as its window", () => {
  assert.equal(lookSince({ seenAt: 5_000 }, 10_000), 5_001);
  assert.equal(lookSince({ seenAt: 0 }, 1_000_000), 1_000_000 - RECORD_LOOKBACK);
});

test("a recorded turn is told apart in the listing", () => {
  const A = "a".repeat(40);
  const [t] = parseListing(`${RECORD}1-1\n\x1fstart.meta\ntree=${A}\nstarted=1\nsession=pi:/s\nrecorder=1\n`, "/t");
  assert.equal(t.recorded, true);
  assert.equal(t.session, "pi:/s");
  const [h] = parseListing(`${RECORD}1-1\n\x1fstart.meta\ntree=${A}\nstarted=1\n`, "/t");
  assert.equal(h.recorded, false);
});

test("one window at a time holds the recorder lock, and a lapsed one is taken over", () => {
  const dir = mkdtempSync(join(tmpdir(), "walkthrough-lock-"));
  const lock = join(dir, "repo");
  const claim = (owner) => execFileSync("sh", ["-c", RECORDER_LOCK, lock, owner], { encoding: "utf8" }).trim() === "ok";
  assert.ok(claim("a"));
  assert.ok(claim("a"));
  assert.ok(!claim("b"));
  // a stops renewing it.
  const old = new Date(Date.now() - 5 * 60_000);
  utimesSync(join(lock, "owner"), old, old);
  utimesSync(lock, old, old);
  assert.ok(claim("b"));
  assert.ok(!claim("a"));
  assert.ok(existsSync(join(lock, "owner")));
  rmSync(dir, { recursive: true, force: true });
});
