// An agent's turns, as hooks/turn.sh records them: what the working tree was
// when a prompt was sent, and when the agent stopped. Plain functions over
// text; reading the folder is engine.js's.
//
// A turn's folder: start.json and end.json (the hook's input, as sent),
// start.meta and end.meta (`key=value` lines, written last), objects/.

/** The hook's JSON → { prompt, session, cwd, event }. A prompt cut short (the listing reads a bounded head) is still recovered. */
export function parseHook(text) {
  const s = String(text ?? "");
  let j = null;
  try { j = JSON.parse(s); } catch { j = null; }
  const get = (name) => {
    if (j && typeof j[name] === "string") return j[name];
    // The string up to where the text was cut, or its closing quote.
    const m = new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(s);
    if (!m) return null;
    try { return JSON.parse(`"${m[1].replace(/\\(u[0-9a-fA-F]{0,3})?$/, "")}"`); } catch { return m[1]; }
  };
  return { prompt: unwrap(get("prompt") ?? ""), session: get("session_id"), cwd: get("cwd"), event: get("hook_event_name") };
}

/** A prompt pasted in by `hc send` (another agent, or the walkthrough's own comments) comes wrapped as <hc from="t3">…</hc>. */
export const unwrap = (prompt) => /^<hc from="[^"]*">([\s\S]*?)(?:<\/hc>\s*)?$/.exec(prompt)?.[1] ?? prompt;

/** `key=value` lines → an object. */
export function parseMeta(text) {
  const out = {};
  for (const line of String(text ?? "").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return out;
}

const SHA = /^[0-9a-f]{40,64}$/;

// The listing engine.js prints: per turn "\x1e<name>\n", then per file "\x1f<file>\n<its text>".
// Claude Code's JSON escapes control characters, so neither separator can come from a prompt.
export const RECORD = "\x1e", FILE = "\x1f";

/**
 * The folder's listing → turns, newest first: { id, dir, started, ended,
 * startTree, endTree, session, terminal, prompt }. A turn whose start
 * snapshot isn't written yet (or failed) is left out.
 */
export function parseListing(out, folder) {
  const turns = [];
  for (const record of String(out ?? "").split(RECORD).slice(1)) {
    const nl = record.indexOf("\n");
    const id = (nl < 0 ? record : record.slice(0, nl)).trim();
    if (!/^\d+-\d+$/.test(id)) continue;
    const files = {};
    for (const part of (nl < 0 ? "" : record.slice(nl + 1)).split(FILE).slice(1)) {
      const at = part.indexOf("\n");
      files[at < 0 ? part : part.slice(0, at)] = at < 0 ? "" : part.slice(at + 1);
    }
    const start = parseMeta(files["start.meta"]), end = parseMeta(files["end.meta"]);
    if (!SHA.test(start.tree ?? "")) continue;
    const hook = parseHook(files["start.json"]);
    turns.push({
      id, dir: `${folder}/${id}`,
      started: Number(start.started) * 1000 || Number(id.split("-")[0]) * 1000,
      ended: SHA.test(end.tree ?? "") ? Number(end.ended) * 1000 || null : null,
      startTree: start.tree, endTree: SHA.test(end.tree ?? "") ? end.tree : null,
      session: start.session || hook.session || null, terminal: start.terminal || null, prompt: hook.prompt,
    });
  }
  return sortTurns(turns);
}

/** Newest first, by when they started, then by name. */
export const sortTurns = (turns) => [...turns].sort((a, b) => b.started - a.started || b.id.localeCompare(a.id));

/**
 * Where each turn ended. A turn the agent was stopped in (Esc: Claude Code
 * runs no Stop hook then) ended when its session's next prompt was sent; the
 * session's newest one without an end is still running, and is read up to now.
 * @returns {any[]} the turns, each with `endTree`, `endDir` (whose objects hold it) and `state`: "done" | "interrupted" | "running"
 */
export function resolveEnds(turns) {
  const sorted = sortTurns(turns);
  return sorted.map((t, i) => {
    if (t.endTree) return { ...t, endDir: t.dir, state: "done" };
    const next = sorted.slice(0, i).reverse().find((n) => n.session === t.session);
    if (next) return { ...t, endTree: next.startTree, endDir: next.dir, ended: next.started, state: "interrupted" };
    return { ...t, endDir: null, state: "running" };
  });
}

/** The turn to show first: the newest of the terminal it was opened over, else the newest. */
export function pickTurn(turns, terminal = null) {
  return (terminal && turns.find((t) => t.terminal === terminal)) || turns[0] || null;
}

/** The newest finished turn, of these terminals when given; null when the newest is still running. */
export function lastFinished(turns, terminals = null) {
  const mine = terminals ? turns.filter((t) => terminals.includes(t.terminal)) : turns;
  return mine[0] && mine[0].state !== "running" ? mine[0] : null;
}

/** A prompt's first line with text in it, cut to `max` characters. */
export function firstLine(prompt, max = 80) {
  const line = String(prompt ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** The source a turn is read as (see sources.js). */
export const turnSource = (t) => ({ kind: "turn", id: t.id, dir: t.dir, startTree: t.startTree, endTree: t.state === "running" ? null : t.endTree, endDir: t.endDir, prompt: t.prompt });

/** The listing script engine.js runs in a repository's turns folder ($0). Prompts are read up to 64 KB. */
export const LISTING = `cd "$0" 2>/dev/null || exit 0
for d in $(ls -1 | grep -E '^[0-9]+-[0-9]+$'); do
  printf '\\036%s\\n' "$d"
  for f in start.meta end.meta; do [ -f "$d/$f" ] && { printf '\\037%s\\n' "$f"; cat "$d/$f"; }; done
  [ -f "$d/start.json" ] && { printf '\\037start.json\\n'; head -c 65536 "$d/start.json"; }
done
exit 0`;

/** The hooks to add to ~/.claude/settings.json, for a turn.sh at `script`. */
export function hookSettings(script) {
  const hook = (event) => [{ hooks: [{ type: "command", command: `sh "${script}" ${event}`, timeout: 30 }] }];
  return JSON.stringify({ hooks: { UserPromptSubmit: hook("start"), Stop: hook("stop") } }, null, 2);
}
