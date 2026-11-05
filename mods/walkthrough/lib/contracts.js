// Evidence-anchored contract changes, kept separate from the reading order.
export const CONTRACT_KINDS = ["database", "protobuf", "api"];
export const COMPATIBILITY = ["additive", "breaking", "mixed", "unknown"];
export const OPERATIONS = ["added", "removed", "modified"];
const str = { type: "string" };
export const CONTRACT_SCHEMA = {
  type: "array", maxItems: 3,
  items: {
    type: "object", additionalProperties: false,
    required: ["kind", "title", "summary", "compatibility", "impact", "changes", "rollout"],
    properties: {
      kind: { type: "string", enum: CONTRACT_KINDS }, title: str, summary: str,
      compatibility: { type: "string", enum: COMPATIBILITY }, impact: str,
      changes: { type: "array", minItems: 1, items: {
        type: "object", additionalProperties: false,
        required: ["name", "operation", "before", "after", "detail", "hunks"],
        properties: {
          name: str, operation: { type: "string", enum: OPERATIONS }, before: str, after: str, detail: str,
          hunks: { type: "array", minItems: 1, items: str },
        },
      } },
      rollout: { type: "array", items: str },
    },
  },
};
const text = (v) => typeof v === "string" ? v.trim() : "";
const fail = (message) => { throw Object.assign(new Error(`Schema/API: ${message}`), { code: "invalid" }); };

export function normalizeContracts(raw, idByAlias, files) {
  if (raw === undefined) return []; // Earlier saved reports remain readable.
  if (!Array.isArray(raw) || raw.length > 3) fail("expected up to one page per contract kind.");
  const seen = new Set(), known = new Map();
  for (const f of files) for (const alias of f.aliases) known.set(alias, f.path);
  return raw.map((page) => {
    const kind = page?.kind, title = text(page?.title), summary = text(page?.summary), impact = text(page?.impact);
    if (!CONTRACT_KINDS.includes(kind) || seen.has(kind)) fail("invalid or duplicate kind.");
    seen.add(kind);
    if (!title || !summary || !impact || !COMPATIBILITY.includes(page.compatibility)) fail("missing explanation or compatibility assessment.");
    if (!Array.isArray(page.changes) || !page.changes.length) fail("a page needs concrete changes.");
    const paths = new Set();
    const changes = page.changes.map((c) => {
      const name = text(c?.name), before = text(c?.before), after = text(c?.after), detail = text(c?.detail);
      if (!name || !detail || !OPERATIONS.includes(c?.operation)) fail("invalid change.");
      if ((c.operation !== "added" && !before) || (c.operation !== "removed" && !after)) fail("missing before/after state.");
      if ((c.operation === "added" && before) || (c.operation === "removed" && after)) fail("added/removed states must match the operation.");
      if (!Array.isArray(c.hunks) || !c.hunks.length) fail("missing diff evidence.");
      const hunkIds = [];
      for (const alias of c.hunks) {
        if (typeof alias !== "string" || !known.has(alias) || !idByAlias[alias]) fail("unknown hunk evidence.");
        paths.add(known.get(alias)); hunkIds.push(idByAlias[alias]);
      }
      return { name, operation: c.operation, before, after, detail, hunkIds: [...new Set(hunkIds)] };
    });
    if (!Array.isArray(page.rollout) || page.rollout.some((s) => !text(s))) fail("invalid rollout steps.");
    return { kind, title, summary, compatibility: page.compatibility, impact, changes, rollout: page.rollout.map(text), paths: [...paths] };
  }).sort((a,b) => CONTRACT_KINDS.indexOf(a.kind) - CONTRACT_KINDS.indexOf(b.kind));
}

// Backward-compatible defaults use the default report language, English.
export { DEFAULT_CONTRACT_LABELS as CONTRACT_LABELS, DEFAULT_COMPATIBILITY_LABELS as COMPATIBILITY_LABELS, DEFAULT_OPERATION_LABELS as OPERATION_LABELS } from "./contract-language.js";
