import { parseMermaid } from "./diagram.js";

export const COMPONENT_LABELS = { added: "Added", modified: "Modified", context: "Context" };
const str = { type: "string" };
export const COMPONENT_SCHEMA = {
  type: "array", minItems: 1,
  items: {
    type: "object", additionalProperties: false,
    required: ["id", "status", "responsibility", "change", "paths", "hunks"],
    properties: {
      id: str, status: { type: "string", enum: Object.keys(COMPONENT_LABELS) },
      responsibility: str, change: str,
      paths: { type: "array", items: str }, hunks: { type: "array", items: str },
    },
  },
};
const fail = (message) => { throw Object.assign(new Error(`Blueprint: ${message}`), { code: "invalid" }); };
const text = (v) => typeof v === "string" ? v.trim() : "";

/** Exact node identities and source anchors, never filename/label heuristics. */
export function normalizeComponents(raw, mermaid, aliases, files) {
  if (raw === undefined) return undefined; // Older reports retain an unclassified diagram.
  const nodes = parseMermaid(mermaid).nodes;
  if (!Array.isArray(raw) || raw.length !== nodes.length) fail("each diagram node needs exactly one component.");
  const ids = new Set(nodes.map((n) => n.id)), seen = new Set();
  const fileByAlias = new Map();
  for (const f of files) for (const a of f.aliases) fileByAlias.set(a, f);
  return raw.map((c) => {
    const id = text(c?.id), responsibility = text(c?.responsibility), change = text(c?.change);
    if (!ids.has(id) || seen.has(id)) fail("unknown or duplicate component ID.");
    seen.add(id);
    if (!Object.hasOwn(COMPONENT_LABELS, c.status) || !responsibility) fail("a component needs a valid status and responsibility.");
    if (!Array.isArray(c.paths) || !Array.isArray(c.hunks)) fail("paths and hunks must be arrays.");
    const paths = [...new Set(c.paths)], hunks = [...new Set(c.hunks)];
    if (c.status === "context") {
      if (paths.length || hunks.length || change) fail("context must not claim source changes.");
    } else {
      if (!paths.length || !hunks.length || !change) fail("changed components need a change and source evidence.");
      for (const alias of hunks) {
        const file = fileByAlias.get(alias);
        if (!file || !Object.hasOwn(aliases, alias) || !aliases[alias] || !paths.includes(file.path)) fail("hunk must belong to a declared real file.");
        if (c.status === "added" && file.status !== "added") fail("Added requires evidence from newly added source files; use Modified otherwise.");
        if (file.status === "deleted") fail("a component in the resulting architecture cannot reference only deleted source.");
      }
      for (const path of paths) if (!hunks.some((a) => fileByAlias.get(a)?.path === path)) fail("every file needs a supporting hunk.");
    }
    return { id, status: c.status, responsibility, change, paths, hunkIds: [...new Set(hunks.map((a) => aliases[a]))] };
  });
}

/** Resolve saved anchors against the current diff, including staged/working copies. */
export function componentEvidence(component, files = []) {
  const wanted = new Set(component?.hunkIds ?? []), found = [];
  for (const file of files) for (const hunk of file.hunks) {
    if (wanted.has(hunk.id) && component.paths.includes(file.path)) found.push({ file, hunk });
  }
  const resolved = new Set(found.map((hit) => hit.hunk.id));
  return { found, missing: [...wanted].filter((id) => !resolved.has(id)).length };
}
