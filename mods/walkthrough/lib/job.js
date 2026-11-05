// One generation is one `pi -p` run in the background, in a folder of its own:
// the prompt goes in as files, the answer comes out as a file. Nothing ties it
// to the window that asked, so closing the walkthrough (or Herdr) doesn't throw
// away a minute of paid work; the next look finds the answer.
//
// Adaptación local: el mod de dmazlum/herdr-walkthrough usa Claude Code
// (`claude -p`); aquí se usa pi, que es el agente de esta máquina.

import { parseJson } from "./walkthrough.js";

export const MODELS = [
  { key: "deepseek/deepseek-flash", name: "deepseek-flash", about: "Rápido y barato; 1M de contexto, sirve para casi todo" },
  { key: "deepseek/deepseek-v4-pro", name: "deepseek-v4-pro", about: "Más cuidadoso en cambios grandes o sutiles" },
  { key: "deepseek/deepseek-chat", name: "deepseek-chat", about: "Contexto de 64K: solo cambios pequeños" },
];
export const DEFAULT_MODEL = MODELS[0].key;
export const modelOf = (key) => MODELS.find((m) => m.key === key) ?? MODELS[0];

// Sin herramientas, MCP, extensiones, skills ni ficheros de contexto: el modelo
// lee el prompt y responde. Cualquiera de esos arrastraría contexto extra en
// cada llamada.
export const PI_FLAGS = ["-p", "--mode", "json", "--no-tools", "--no-extensions", "--no-mcp", "--no-skills", "--no-context-files", "--no-session"];

/** Whether a process's command line is a walkthrough run (its pid file may outlive it, and pids are reused). */
// pi reescribe el título del proceso, así que esto es solo el respaldo: la
// comprobación buena es la hora de arranque guardada en `started`.
export const isRunCommand = (command) => ["--mode", "--no-extensions", "--no-skills"].every((flag) => String(command).includes(flag));

const shellQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/**
 * The script a job folder runs: `sh run.sh <pi> <model> <seconds>`. A watchdog
 * stops pi after <seconds>, so a hung run ends even when no window is open to
 * notice; it checks every few seconds and leaves with pi.
 */
export function jobScript() {
  return `#!/bin/sh
# One walkthrough generation. Written by the walkthrough mod for Herdr (pi edition).
cd "$(dirname "$0")" || exit 1
"$1" ${PI_FLAGS.map(shellQuote).join(" ")} --model "$2" --system-prompt "$(cat system.txt)" < prompt.txt > out.json 2> err.txt &
pid=$!
echo $pid > pid
ps -o lstart= -p "$pid" > started.tmp 2>/dev/null && mv -f started.tmp started
waited=0
while kill -0 $pid 2>/dev/null; do
  if [ "$waited" -ge "$3" ]; then echo "Stopped after $3 seconds without an answer." >> err.txt; kill $pid; break; fi
  sleep 3; waited=$((waited + 3))
done
wait $pid
echo $? > code.tmp && mv code.tmp code
`;
}

const firstLine = (t) => String(t ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";

/**
 * What a finished job left: the walkthrough's raw object and its cost, or an
 * error with a message a person can act on.
 * @param {{ out: string|null, err: string|null, code: string|null }} files
 * @returns {{ raw: any, cost: number|null }}
 */
export function readOutcome({ out, err, code }) {
  let end = null, failed = null;
  for (const line of String(out ?? "").split("\n")) {
    if (!line.startsWith("{")) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o?.type === "turn_end" && o.message) end = o;
    else if (o?.type === "error") failed = o;
  }
  if (failed) {
    const why = firstLine(failed.message ?? failed.error ?? JSON.stringify(failed)) || "pi reportó un error.";
    throw Object.assign(new Error(why), { code: /api key|credential|log ?in|auth/i.test(why) ? "login" : "failed" });
  }
  if (!end) {
    const why = String(err ?? "").trim().split("\n").filter(Boolean).slice(-3).join(" ") || `pi exited with ${String(code ?? "?").trim()}`;
    throw Object.assign(new Error(why), { code: /api key|credential|log ?in|auth/i.test(why) ? "login" : "failed" });
  }
  const parts = Array.isArray(end.message.content) ? end.message.content : [];
  const answer = parts.filter((p) => p?.type === "text").map((p) => p.text ?? "").join("\n").trim();
  const raw = answer ? parseJson(answer) : null;
  if (!raw) throw Object.assign(new Error(firstLine(answer) || "pi no devolvió un walkthrough utilizable."), { code: "failed" });
  const cost = end.message.usage?.cost?.total;
  return { raw, cost: typeof cost === "number" ? cost : null };
}
