// Lo que se escribió a pi, opencode o codex trabajando en un repositorio desde un
// momento dado: los prompts que la pestaña "Matched against" usa como tarea del
// cambio. Claude Code se lee aparte (lib/task.js, engine.transcriptMessages).
//
// Todo es local: ficheros de sesión de pi y codex, y la SQLite de opencode.

import { isNoise, clip, MAX_MESSAGE_CHARS } from "./task.js";

const cap = (t) => clip(t, MAX_MESSAGE_CHARS);
const textOf = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b && typeof b.text === "string" &&
    (b.type === "text" || b.type === "input_text" || b.type === "output_text")).map((b) => b.text).join("\n");
};
const inRepo = (path, top) => path === top || String(path ?? "").startsWith(top + "/");
const asked = (text) => {
  const t = String(text ?? "").trim();
  if (!t || isNoise(t)) return false;
  // codex mete las instrucciones del repositorio como primer mensaje del usuario.
  if (/^# AGENTS\.md instructions/i.test(t) || /^<INSTRUCTIONS>/i.test(t)) return false;
  if (t.includes("<user_instructions>")) return false;
  return true;
};

/** pi: sesiones JSONL; la primera línea ("type":"session") trae el cwd. */
export function parsePiSessions(text, top, since) {
  let cwd = null;
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o?.type === "session") { cwd = typeof o.cwd === "string" ? o.cwd : cwd; continue; }
    if (o?.type !== "message" || o.message?.role !== "user") continue;
    const body = textOf(o.message.content).trim();
    if (!asked(body)) continue;
    const at = Date.parse(o.timestamp ?? "") || Number(o.message?.timestamp) || 0;
    if (at && at < since) continue;
    out.push({ at, text: cap(body), session: null });
  }
  return cwd && inRepo(cwd, top) ? out : [];
}

/** codex: rollouts JSONL; session_meta.payload.cwd y mensajes response_item con role "user". */
export function parseCodexSessions(text, top, since) {
  let cwd = null;
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o?.type === "session_meta") { cwd = o.payload?.cwd ?? cwd; continue; }
    if (o?.type !== "response_item" || o.payload?.type !== "message" || o.payload?.role !== "user") continue;
    const body = textOf(o.payload.content).trim();
    if (!asked(body)) continue;
    const at = Date.parse(o.timestamp ?? "") || 0;
    if (at && at < since) continue;
    out.push({ at, text: cap(body), session: null });
  }
  return cwd && inRepo(cwd, top) ? out : [];
}

/** opencode: filas "user" de session_message, por el directorio de su sesión (lo da el script). */
export function parseOpencodePrompts(text, since) {
  let rows;
  try { rows = JSON.parse(text || "[]"); } catch { return []; }
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => asked(r?.text))
    .map((r) => ({ at: Number(r.at) || 0, text: cap(r.text), session: r.session ?? null }))
    .filter((r) => !r.at || r.at >= since);
}

/** Une lo de los tres agentes, sin repetir el mismo texto en el mismo momento. */
export function mergePrompts(lists) {
  const seen = new Set();
  const out = [];
  for (const m of lists.flat()) {
    const key = String(m.at) + "\n" + String(m.text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out.sort((a, b) => a.at - b.at);
}
