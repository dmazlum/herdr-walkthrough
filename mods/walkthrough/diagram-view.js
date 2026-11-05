import { div, PathBuilder } from "gpui-kit";
import { diagramFocus } from "./lib/focus.js";
import { layoutDiagram } from "./lib/diagram.js";

/** Mix the live theme rather than fixing the drawing to a dark-only palette. */
function mix(a, b, amount) {
  const channels = (hex) => {
    let s = hex.slice(1, 7);
    if (s.length === 3) s = [...s].map((c) => c + c).join("");
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  };
  const x = channels(a), y = channels(b);
  return /** @type {`#${string}`} */ ("#" + x.map((v, i) => Math.round(v + (y[i] - v) * amount).toString(16).padStart(2, "0")).join(""));
}

/** Native technical drawing. Existing Mermaid reports need no regeneration. */
export function diagramView(source, t, { width = 700, zoom = 1, fontFamily = "monospace", components = [], connections = [], groups = [], selectedId = null, onSelect = null } = {}) {
  let graph;
  try { graph = layoutDiagram(source, connections, groups); }
  catch (e) { return div().p(16).text_color(t.blocked).child(`Couldn't render architecture: ${e.message}`); }
  const focus = diagramFocus(graph, selectedId);
  const header = 52;
  const scale = Math.min(1, Math.max(240, width) / graph.width) * zoom;
  const w = Math.max(graph.width * scale, width), footer = w < 420 ? 56 : 40;
  const offsetX = (w - graph.width * scale) / 2;
  const h = graph.height * scale + header + footer;
  const ink = mix(t.foreground, t.ansi6, 0.3);
  const paper = mix(t.surface, t.ansi4, 0.12);
  const grid = mix(paper, ink, 0.07), major = mix(paper, ink, 0.13);
  const line = mix(paper, ink, 0.65), muted = mix(paper, ink, 0.72);
  const root = div().relative().flex_none().w(w).h(h).bg(paper).font_family(fontFamily);
  const point = ([x, y]) => /** @type {[number, number]} */ ([x * scale + offsetX, y * scale + header]);
  const paint = (path, color, opacity = 1, id = null) => {
    const drawing = window.paint_path(path.build(), color).absolute().top(0).left(0).size_full().opacity(opacity);
    if (id) drawing.id(id);
    root.child(drawing);
  };

  // Two batched paths keep the grid cheap even when zoomed in.
  const minorPath = PathBuilder.stroke(0.5), majorPath = PathBuilder.stroke(0.7);
  const spacing = Math.max(12, 24 * scale);
  for (let i = 0, x = 0; x <= w; i++, x += spacing) {
    (i % 4 ? minorPath : majorPath).move_to(x, header).line_to(x, h - footer);
  }
  for (let i = 0, y = header; y <= h - footer; i++, y += spacing) {
    (i % 4 ? minorPath : majorPath).move_to(0, y).line_to(w, y);
  }
  paint(minorPath, grid); paint(majorPath, major);

  const frame = PathBuilder.stroke(1);
  frame.move_to(0, header).line_to(w, header).move_to(0, h - footer).line_to(w, h - footer);
  for (const [x, y, dx, dy] of [[12, header + 12, 1, 1], [w - 12, header + 12, -1, 1], [12, h - footer - 12, 1, -1], [w - 12, h - footer - 12, -1, -1]]) {
    frame.move_to(x + dx * 10, y).line_to(x, y).line_to(x, y + dy * 10);
  }
  paint(frame, line);

  // Boundaries are behind relationships and cards. Headers occupy reserved
  // lane space, so labels and components cannot cover them.
  for (const group of graph.groups) {
    const selected = group.nodes.includes(selectedId);
    root.child(div().id(`diagram-group-${group.id}`).opacity(focus.groups.has(group.id) ? 1 : 0.25).absolute()
      .left(group.x * scale + offsetX).top(group.y * scale + header)
      .w(group.width * scale).h(group.height * scale).rounded(3).border_1()
      .border_color(group.missing ? t.blocked : selected ? t.accent : mix(paper, ink, 0.35))
      .child(div().id(`diagram-group-title-${group.id}`).absolute().left(10 * scale).top(7 * scale)
        .max_w(Math.min(190, group.width - 20) * scale).bg(paper)
        .text_size(10 * scale).line_height(1.4).font_semibold().text_color(group.missing ? t.blocked : muted)
        .tooltip(`${group.title}${group.reason ? ": " + group.reason : ""}${group.missing ? " (saved boundary; source changed)" : ""}`)
        .children(group.titleLines.map((text) => div().child(text)))));
  }

  for (const [index, edge] of graph.edges.entries()) {
    const related = focus.edges.has(index), opacity = related ? 1 : 0.18;
    const edgeColor = related ? (focus.active ? t.accent : line) : mix(paper, line, 0.18);
    const arrowColor = related ? (focus.active ? t.accent : ink) : mix(paper, ink, 0.18);
    const points = edge.points.map(point), arrow = edge.arrow.map(point);
    const path = PathBuilder.stroke(1.3).move_to(...points[0]);
    for (const p of points.slice(1)) path.line_to(...p);
    paint(path, edgeColor, opacity, `diagram-edge-${index}`);
    paint(PathBuilder.fill().add_polygon(arrow, true), arrowColor, opacity);
    const [x, y] = points[0];
    paint(PathBuilder.fill().add_polygon([[x - 2, y - 2], [x + 2, y - 2], [x + 2, y + 2], [x - 2, y + 2]], true), arrowColor, opacity);
  }

  // Draw callouts after wires, before component cards. Their opaque paper
  // background keeps the label readable against the technical grid.
  for (const [i, edge] of graph.edges.entries()) {
    const box = edge.labelBox;
    if (!box) continue;
    const related = focus.edges.has(i), opacity = related ? 1 : 0.22;
    const [ax, ay] = point(box.anchor);
    const x = box.x * scale + offsetX, y = box.y * scale + header;
    const right = x + box.width * scale, bottom = y + box.height * scale;
    const nearestX = Math.max(x, Math.min(right, ax)), nearestY = Math.max(y, Math.min(bottom, ay));
    if (box.detached) {
      root.child(div().opacity(opacity).absolute().left(ax - 7 * scale).top(ay - 7 * scale).w(14 * scale).h(14 * scale)
        .bg(paper).border_1().border_color(line).text_color(ink).text_size(8 * scale)
        .flex().items_center().justify_center().tooltip(edge.label).child(String(box.number)));
    } else if (ax !== nearestX || ay !== nearestY) {
      paint(PathBuilder.stroke(0.7).move_to(ax, ay).line_to(nearestX, ay).line_to(nearestX, nearestY), related ? line : mix(paper, line, 0.22), opacity);
    }
    root.child(div().id(`diagram-edge-label-${i}`).opacity(opacity).absolute().left(x).top(y)
      .w(box.width * scale).h(box.height * scale).bg(paper).border_1().border_color(focus.active && related ? t.accent : major)
      .text_color(edge.missing ? t.blocked : ink).text_size(10 * scale).line_height(1.4)
      .flex().flex_col().items_center().justify_center().text_center()
      .tooltip(`${edge.from} → ${edge.to}: ${edge.label}${edge.missing ? " (saved label; source changed, regenerate to update)" : ""}`)
      .children(box.lines.map((text) => div().child(text))));
  }

  const metadata = new Map(components.map((c) => [c.id, c]));
  for (const [i, node] of graph.nodes.entries()) {
    const component = metadata.get(node.id);
    const status = component?.status;
    const color = { added: t.ansi2, modified: t.ansi3, context: muted }[status] ?? line;
    const selected = selectedId === node.id;
    const related = focus.nodes.has(node.id);
    root.child(div().id(`diagram-node-${node.id}`).opacity(related ? 1 : 0.25).absolute().left(node.x * scale + offsetX).top(node.y * scale + header)
      .w(node.width * scale).h(node.height * scale).border_1().border_color(selected || (focus.active && related) ? t.accent : color)
      .bg(selected ? mix(paper, t.accent, 0.18) : mix(paper, t.raised, 0.45))
      .text_color(status === "context" && !(focus.active && related) ? muted : t.foreground).flex().flex_col()
      .tooltip(`${node.label}${status ? " / " + status : ""}: select for details`)
      .when(Boolean(onSelect), (el) => el.cursor_pointer().hover((s) => s.border_color(t.accent))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => onSelect(node.id, cx)))
      .child(div().flex_none().h(26 * scale).px(10 * scale).flex().items_center().justify_between()
        .border_b_1().border_color(major).text_size(9 * scale).text_color(color)
        .child(String(i + 1).padStart(2, "0"))
        .child(status ? status.toUpperCase() : node.id))
      .child(div().flex_1().min_h(0).px(8 * scale).flex().flex_col().items_center().justify_center()
        .text_center().text_size(12 * scale).line_height(1.4)
        .children(node.lines.map((text) => div().child(text)))));
  }
  root.child(div().absolute().top(0).left(16).h(header).flex().items_center()
    .text_size(11).text_color(ink).font_semibold().child("ARCHITECTURE / BLUEPRINT"));
  root.child(div().absolute().top(h - footer).left(16).right(16).h(footer).flex().items_center().justify_between()
    .text_size(9).text_color(muted)
    .when(w < 420, (el) => el.flex_col().items_start().justify_center().gap(4))
    .child(`${graph.nodes.length} COMPONENTS / ${graph.edges.length} CONNECTIONS${graph.groups.length ? ` / ${graph.groups.length} GROUPS` : ""}`)
    .child(graph.direction === "LR" ? "FLOW: LEFT TO RIGHT" : "FLOW: TOP TO BOTTOM"));
  return root;
}
