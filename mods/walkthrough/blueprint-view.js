import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { diagramView } from "./diagram-view.js";
import { parseMermaid } from "./lib/diagram.js";
import { COMPONENT_LABELS, componentEvidence } from "./lib/blueprint.js";
import { button, chip } from "./ui.js";

/** Native inspector. File buttons navigate to their walkthrough sections. */
export function blueprintView(architecture, t, {
  width = 700, zoom = 1, fontFamily = "monospace", files = [], selectedId = null,
  fileTargets = () => [], onSelect = () => {}, onFile = () => {}, onClose = () => {},
} = {}) {
  const components = architecture.components ?? [];
  const component = components.find((c) => c.id === selectedId);
  let label = null;
  try { label = parseMermaid(architecture.mermaid).nodes.find((n) => n.id === selectedId)?.label; }
  catch { /* The diagram supplies its own parse error. */ }
  const colors = { added: t.ansi2, modified: t.ansi3, context: t.muted };
  const evidence = componentEvidence(component, files);
  const groups = (architecture.groups ?? []).map((g) => ({ ...g, missing: componentEvidence(g, files).missing }));
  const memberGroup = groups.find((g) => g.nodes.includes(selectedId));
  const connections = (architecture.connections ?? []).map((c) => ({ ...c, missing: componentEvidence(c, files).missing }));
  const wide = width >= (groups.length ? 1100 : 820), canvasWidth = wide ? width - 280 : width;
  const inspector = v_flex().flex_none().min_w(0).gap(10).p(12).border_1().border_color(t.border).rounded(3)
    .when(wide, (el) => el.w(264))
    .when(!wide, (el) => el.w_full())
    .child(h_flex().items_center().justify_between().gap(8)
      .child(div().text_size(11).font_semibold().text_color(t.muted).child("COMPONENT DETAILS"))
      .when(Boolean(label), (el) => el.child(button(t, "blueprint-close", "Close", (_e, cx) => onClose(cx), { small: true, kind: "ghost" }))))
    .when(!label, (el) => el.child(div().text_size(12).text_color(t.muted).child("Select a component on the blueprint to inspect its role and source changes.")))
    .when(Boolean(label), (el) => el
      .child(div().text_size(14).font_semibold().child(label))
      .when(!component, (e) => e.child(div().text_size(12).text_color(t.dim).child("This saved report has no component details. Regenerate it to add source-backed change markers.")))
      .when(Boolean(component), (e) => e
        .child(h_flex().child(chip(t, COMPONENT_LABELS[component.status], colors[component.status])))
        .when(Boolean(memberGroup), (r) => r.child(div().text_size(11).text_color(t.muted)
          .tooltip(memberGroup.reason).child(`Group: ${memberGroup.title}`)))
        .child(div().text_size(12.5).line_height(1.5).child(component.responsibility))
        .when(Boolean(component.change), (r) => r
          .child(div().text_size(10).text_color(t.dim).font_semibold().child("WHAT CHANGED"))
          .child(div().text_size(12).line_height(1.5).child(component.change)))
        .when(component.status === "context", (r) => r.child(div().text_size(11).text_color(t.dim).child("Context only. This report assigns no source change to this component.")))
        .when(evidence.missing > 0, (r) => r.child(div().text_size(11.5).text_color(t.blocked)
          .child(`${evidence.missing} source fragment(s) changed or disappeared. Details describe the saved report; regenerate to update them.`)))
        .when(component.paths.length > 0, (r) => r
          .child(div().text_size(10).text_color(t.dim).font_semibold().child("SOURCE FILES"))
          .children(component.paths.map((path, i) => {
            const targets = fileTargets(path);
            const destination = targets[0];
            return button(t, `blueprint-file-${i}`, div().min_w(0).truncate().child(path), (_e, cx) => onFile(path, cx),
              { small: true, disabled: !destination, tooltip: destination
                ? `Go to ${destination.title}${targets.length > 1 ? ` (first of ${targets.length} matching sections)` : ""}`
                : `No walkthrough section is available for ${path}` })
              .max_w_full().min_w(0);
          })))));
  const chart = div().id("architecture-diagram-scroll").flex_1().min_w(0).flex_none().overflow_x_scrollbar()
    .rounded(2).border_1().border_color(t.border)
    .when(wide, (el) => el.w(canvasWidth))
    .when(!wide, (el) => el.w_full())
    .child(diagramView(architecture.mermaid, t, { width: canvasWidth, zoom, fontFamily, components, connections, groups, selectedId, onSelect }));
  const root = v_flex().w_full().flex_none().gap(10)
    .child(h_flex().gap(10).items_center().flex_wrap()
      .child(button(t, "blueprint-show-all", "Show all", (_e, cx) => onClose(cx),
        { small: true, disabled: !label, tooltip: "Clear selection and restore the full blueprint" }))
      .child(div().text_size(11.5).text_color(t.muted).child(label
        ? `Focused: ${label} · direct connections` : "Select a component to trace its direct connections.")))
    .when(groups.some((g) => g.missing), (el) => el.child(div().text_size(11.5).text_color(t.blocked)
      .child("Some group boundaries refer to changed source. Regenerate to update them.")))
    .when(connections.some((c) => c.missing), (el) => el.child(div().text_size(11.5).text_color(t.blocked)
      .child("Some connection labels refer to changed source. Regenerate to update them.")))
    .when(components.length > 0, (el) => el.child(h_flex().gap(8).flex_wrap()
      .children(Object.entries(COMPONENT_LABELS).map(([status, text]) => chip(t, text, colors[status])))))
    .when(!components.length, (el) => el.child(div().text_size(11.5).text_color(t.dim)
      .child("This report predates component details. Regenerate to add change markers and source links.")))
    .child((wide ? h_flex().items_start().child(chart).child(inspector) : v_flex().child(inspector).child(chart)).w_full().gap(16));
  return root;
}
