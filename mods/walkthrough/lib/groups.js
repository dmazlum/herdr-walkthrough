import { parseMermaid } from "./diagram.js";

export const GROUP_SCHEMA = {
  type: "array", maxItems: 8,
  items: {
    type: "object", additionalProperties: false,
    required: ["id", "title", "nodes", "reason", "hunks"],
    properties: {
      id: { type: "string" }, title: { type: "string", minLength: 1, maxLength: 48 },
      nodes: { type: "array", minItems: 1, items: { type: "string" } },
      reason: { type: "string" }, hunks: { type: "array", minItems: 1, items: { type: "string" } },
    },
  },
};
const fail = (message) => { throw Object.assign(new Error(`Group: ${message}`), { code: "invalid" }); };

/** Model proposes boundaries; node membership and evidence are checked locally. */
export function normalizeGroups(raw, source, components, aliases, files) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > 8) fail("groups must be an array of at most eight boundaries.");
  const graph = parseMermaid(source), nodeIds = new Set(graph.nodes.map((n) => n.id));
  const groupIds = new Set(), assigned = new Set();
  const componentById = new Map((components ?? []).map((c) => [c.id, c]));
  const fileByAlias = new Map(files.flatMap((f) => f.aliases.map((a) => [a, f])));
  const result = raw.map((g) => {
    const id = g?.id, title = typeof g?.title === "string" ? g.title.trim() : "";
    const reason = typeof g?.reason === "string" ? g.reason.trim() : "";
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(id ?? "") || nodeIds.has(id) || groupIds.has(id)) fail("ID must be unique and distinct from node IDs.");
    if (!title || title.length > 48 || /[<>`"|\\\r\n\x00-\x1f]/.test(title) || !reason) fail("a boundary needs a short plain title and an evidenced reason.");
    if (!Array.isArray(g.nodes) || !g.nodes.length || !Array.isArray(g.hunks) || !g.hunks.length) fail("a boundary needs members and source evidence.");
    groupIds.add(id);
    const hunkIds = new Set(), paths = new Set();
    for (const alias of g.hunks) {
      const file = fileByAlias.get(alias);
      if (!file || !Object.hasOwn(aliases, alias) || !aliases[alias] || file.status === "deleted") fail("source alias must identify real resulting code.");
      hunkIds.add(aliases[alias]); paths.add(file.path);
    }
    for (const node of g.nodes) {
      if (!nodeIds.has(node) || assigned.has(node)) fail("each declared component can belong to at most one group.");
      const c = componentById.get(node);
      if (!c?.hunkIds.some((id) => hunkIds.has(id))) fail("every member needs supporting component evidence; leave uncertain members ungrouped.");
      assigned.add(node);
    }
    return { id, title, nodes: [...g.nodes], reason, paths: [...paths], hunkIds: [...hunkIds] };
  });
  for (const inline of graph.groups ?? []) {
    const group = result.find((g) => g.id === inline.id);
    if (!group || group.title !== inline.title || group.nodes.length !== inline.nodes.length || inline.nodes.some((id) => !group.nodes.includes(id))) fail("inline boundary must agree with source-backed group metadata.");
  }
  return result;
}
