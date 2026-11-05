import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { contractStrings } from "./lib/contract-language.js";
import { button, chip } from "./ui.js";

/** Side-by-side entity/field cards, with vertical comparison in narrow panes. */
export function contractPage(page, t, { language = "en", width = 700, sourceOpen = false, onToggleSource = () => {}, source = null, missing = 0, changeEvidence = [], openChanges = new Set(), onToggleChange = () => {}, renderChangeSource = () => null, onGoToStep = () => {} } = {}) {
  const words = contractStrings(language);
  const color = { additive: t.ansi2, breaking: t.ansi1, mixed: t.ansi3, unknown: t.muted }[page.compatibility];
  const operationColor = { added: t.ansi2, removed: t.ansi1, modified: t.ansi3 };
  const counts = Object.fromEntries(["added", "modified", "removed"].map((op) => [op, page.changes.filter((c) => c.operation === op).length]));
  const state = (value, after) => v_flex().flex_1().min_w(0).rounded(7).border_1().border_color((after ? t.ansi2 : t.ansi1) + "55").bg((after ? t.ansi2 : t.ansi1) + "09").p(12).gap(7)
    .child(div().text_size(10).font_semibold().text_color(after ? t.ansi2 : t.ansi1).child((after ? words.after : words.before).toUpperCase()))
    .child(div().text_size(12).line_height(1.6).font_family("JetBrains Mono").text_color(value ? t.foreground : t.dim).child(value || (after ? words.removed : words.absent)));
  return v_flex().id(`contracts-${page.kind}`).flex_1().min_h(0).overflow_y_scrollbar().px(22).py(16).gap(14)
    .child(h_flex().items_center().gap(8).flex_wrap()
      .child(chip(t, words.kinds[page.kind], t.accent, t.accent + "15"))
      .child(chip(t, words.compatibility[page.compatibility], color, color + "18")))
    .child(div().text_size(19).font_semibold().child(page.title))
    .child(div().text_size(13).line_height(1.6).child(page.summary))
    .child(h_flex().gap(8).flex_wrap().children(Object.entries(counts).filter(([, n]) => n).map(([op, n]) =>
      h_flex().gap(6).px(10).py(7).rounded(6).bg(t.raised)
        .child(div().text_size(18).font_semibold().text_color(operationColor[op]).child(String(n)))
        .child(div().text_size(11).text_color(t.muted).child(words.operations[op])))))
    .child(v_flex().rounded(8).border_l(3).border_color(color).bg(color + "0c").p(12).gap(5)
      .child(div().text_size(11).font_semibold().text_color(color).child(words.impact.toUpperCase()))
      .child(div().text_size(12.5).line_height(1.6).child(page.impact)))
    .children(page.changes.map((c, i) => v_flex().id(`contract-change-${page.kind}-${i}`).flex_none().w_full().rounded(9).border_1().border_color(openChanges.has(i) ? t.accent : t.border).p(12).gap(10)
      .child(h_flex().gap(8).items_center().flex_wrap()
        .child(div().id(`contract-change-name-${page.kind}-${i}`).flex_1().min_w(0).text_size(13).font_semibold()
          .cursor_pointer().text_color(t.accent).tooltip(openChanges.has(i) ? words.hideSource : words.showSource)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => onToggleChange(i, cx)).child(c.name))
        .child(chip(t, words.operations[c.operation], operationColor[c.operation], operationColor[c.operation] + "15")))
      .child((width < 560 ? v_flex() : h_flex()).gap(10).items_stretch()
        .child(state(c.before, false))
        .child(div().flex_none().text_size(18).text_color(t.dim).flex().items_center().justify_center().child(width < 560 ? "↓" : "→"))
        .child(state(c.after, true)))
      .child(div().text_size(12).line_height(1.6).text_color(t.muted).child(c.detail))
      .child(h_flex().gap(8).flex_wrap()
        .child(button(t, `contract-change-source-${page.kind}-${i}`, openChanges.has(i) ? words.hideSource : words.showSource,
          (_e, cx) => onToggleChange(i, cx), { small: true }))
        .children((changeEvidence[i]?.targets ?? []).map((target) =>
          button(t, `contract-change-step-${page.kind}-${i}-${target.index}`, div().min_w(0).truncate().child(words.goToStep.replace("{title}", target.title)),
            (_e, cx) => onGoToStep(i, target.index, cx), { small: true, tooltip: words.goToStep.replace("{title}", target.title) }).min_w(0).max_w_full())))
      .when(!(changeEvidence[i]?.targets?.length), (e) => e.child(div().text_size(11.5).text_color(t.dim).child(words.noStep)))
      .when(openChanges.has(i), (e) => e.child(v_flex().id(`contract-evidence-${page.kind}-${i}`).w_full().gap(8)
        .when((changeEvidence[i]?.missing ?? 0) > 0, (r) => r.child(div().text_size(11.5).text_color(t.blocked).child(words.stale.replace("{count}", String(changeEvidence[i].missing)))))
        .when(!changeEvidence[i]?.found?.length, (r) => r.child(div().text_size(12).text_color(t.dim).child(words.noSource)))
        .when(Boolean(changeEvidence[i]?.found?.length), (r) => r.child(div().max_h(320).overflow_y_scrollbar().child(renderChangeSource(i))))))))
    .child(v_flex().gap(9).pt(4)
      .child(div().text_size(14).font_semibold().child(words.rollout))
      .when(!page.rollout.length, (e) => e.child(div().text_size(12).text_color(t.dim).child(words.noRollout)))
      .children(page.rollout.map((text, i) => h_flex().gap(10).items_start()
        .child(div().size(24).flex_none().rounded(12).bg(t.accent + "20").text_color(t.accent).text_size(11).flex().items_center().justify_center().child(String(i + 1)))
        .child(div().flex_1().min_w(0).py(2).text_size(12.5).line_height(1.5).child(text)))))
    .child(div().text_size(11).text_color(t.dim).child(page.paths.join(" · ")))
    .when(missing > 0, (e) => e.child(div().text_size(12).text_color(t.blocked).child(words.stale.replace("{count}", String(missing)))))
    .child(button(t, `contract-source-${page.kind}`, sourceOpen ? words.hideSource : words.showSource, (_e, cx) => onToggleSource(cx), { kind: "ghost", small: true }))
    .when(sourceOpen && Boolean(source), (e) => e.child(source));
}
