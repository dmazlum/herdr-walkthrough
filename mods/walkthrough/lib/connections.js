import { parseMermaid } from "./diagram.js";

export const CONNECTION_SCHEMA = {
  type: "array",
  items: {
    type: "object", additionalProperties: false,
    required: ["from", "to", "label", "hunks"],
    properties: {
      from: { type: "string" }, to: { type: "string" },
      label: { type: "string", minLength: 1, maxLength: 60 },
      hunks: { type: "array", minItems: 1, items: { type: "string" } },
    },
  },
};
const fail = (message) => { throw Object.assign(new Error(`Connection: ${message}`), { code: "invalid" }); };

/** Labels annotate existing directed relationships, never invent new edges. */
export function normalizeConnections(raw, source, aliases, files) {
  if (raw === undefined) return undefined; // Legacy reports remain unlabeled.
  if (!Array.isArray(raw)) fail("connections must be an array.");
  const graph = parseMermaid(source), seen = new Set();
  const fileByAlias = new Map(files.flatMap((f) => f.aliases.map((a) => [a, f])));
  const connections = raw.map((c) => {
    const matches = graph.edges.filter((e) => e.from === c?.from && e.to === c?.to);
    const key = `${c?.from}:${c?.to}`;
    if (matches.length !== 1 || seen.has(key)) fail("label needs one unique, declared directed edge.");
    seen.add(key);
    const label = typeof c.label === "string" ? c.label.trim() : "";
    if (!label || label.length > 60 || /[<>`"|\\\r\n\x00-\x1f]/.test(label)) fail("label must be short plain text.");
    if (!Array.isArray(c.hunks) || !c.hunks.length) fail("label needs source hunk evidence.");
    const hunks = [...new Set(c.hunks)];
    for (const alias of hunks) {
      const file = fileByAlias.get(alias);
      if (!file || !Object.hasOwn(aliases, alias) || !aliases[alias] || file.status === "deleted") fail("source alias must identify real resulting code.");
    }
    if (matches[0].label && matches[0].label !== label) fail("inline label conflicts with its source-backed description.");
    return { from: c.from, to: c.to, label, paths: [...new Set(hunks.map((a) => fileByAlias.get(a).path))], hunkIds: [...new Set(hunks.map((a) => aliases[a]))] };
  });
  if (graph.edges.some((e) => e.label && !connections.some((c) => c.from === e.from && c.to === e.to))) fail("inline labels also need source evidence.");
  return connections;
}
