# Walkthrough

A dialog (or pane) that turns the diff of the focused terminal's repository into a guided
reading: Claude groups related hunks into steps, orders them so each builds on the last, and
explains what each step changes, with the step's code under the explanation. A contents
column lists the steps; everything no step covers is listed at the end. It explains a
change and never judges it.

![Walkthrough](preview.png)

## Fork additions

This fork is based on upstream 0.8.1, including persistent read tracking, Last turn, task mapping,
interface updates and UTF-8 clipboard fixes. Install from `singerxt/herdr-walkthrough`, branch
`blueprint-contracts`; the `main` branch retains upstream code.

The first page is Recap, with a native interactive blueprint. The optional Task page follows Recap. Components can show validated
change status, source-file navigation, connection labels and evidence-based groups.
Selecting a component highlights its direct connections; Show all clears that focus.

Conditional database, Protobuf and API contract pages follow Recap before the code steps.
Each change has a before/after comparison, its own exact source diff toggle and links to
matching walkthrough steps. Stale source and changes without a matching step are marked.
Contract UI and Markdown labels follow the selected/saved report language; generation
explicitly requests the chosen language. Existing wrong-language prose needs regeneration.

Copy only `mods/walkthrough` when installing; merge `keys.json` with existing shortcuts,
then run `herdr-app check`. Do not replace unrelated mods or shortcut entries. New
blueprint metadata and contract pages require report regeneration; older reports remain
readable. The detailed upstream behavior below describes the upstream 0.8.1 foundation.

## What you see

A dialog 74% of the window wide and 80% tall (`modal`), on `theme().popover`; as a pane, on
`theme().background`. Text 13px, `theme().foreground`. Top to bottom:

1. **Header**, 40px, bottom border `border`: a 12px `◆` in `accent`, "Walkthrough" 13.5px
   semibold, then the repository name and `⎇ branch` (or "(detached)") in `dim` 12px; at
   the right, in a dialog, a ghost "Esc" button.
2. **Toolbar**, two rows, each with a bottom border. Above (at least 42px, padding 7px
   14px, wrapping when narrow): what to read and the one action. Below (at least 36px,
   padding 5px 14px): on the left which one of it, on the right how it is written.
   - scope tabs in a `raised` pill (radius 7, padding 2): Uncommitted, Staged, Unstaged,
     Branch, Commit, Pull request, Last turn; 22px tall, 12px; the chosen one on `popover`, semibold, the rest
     `muted`. Each has a tooltip saying what it reads.
   - above, right of the tabs: a braille spinner while the diff is read, and the action:
     **Generate** (solid) with nothing exact on screen, **Regenerate** (outline) over an
     exact one, **Cancel** while one is running.
   - below, left: Branch has "vs" (11px `dim`) and a dropdown of the base; Commit a
     dropdown of the commit (`short subject`); Pull request, once some are listed, a
     dropdown of the open pull requests (`#12 title`, hint "author · head → base",
     "· draft", "· this branch"); Last turn, once a turn is recorded, "Turn" and a dropdown
     of the turns (the prompt's first line, hint "5 min ago · took 1:20 · t3", "still
     running", "interrupted" or "no Stop recorded, ended when seen idle"), then a ghost
     **⚡ Auto: on** / **Auto: off** that switches Auto with one click (tooltip: what it does).
   - below, right: once a diff is read, "Matched against" (11px `dim`) and the task dropdown
     ("◎ prompt", "◎ PR description", "◎ commit message", "◎ 3 prompts", "◎ yours",
     "nothing found", "nothing (off)"; rows Found (hint: where it came from, or "Nothing
     found for this change"), Your own… (hint: its first line) and Off); then the model
     (Haiku, Sonnet, Opus) and language (its own name: Türkçe, Deutsch …) dropdowns as ghost
     buttons in one bordered group with a 1px divider.
   - Dropdowns open a menu (8px radius, `popover`, `border`, shadow) under the toolbar,
     left-aligned for base and commit, right-aligned for model and language; the chosen row
     ticked in `accent` and on `selected`; a click outside closes it. The menu is a
     `v_virtual_list` (30px rows, 44px with a hint line, at most 360px tall, a `Scrollbar`
     beside it) so the wheel scrolls it; ↑ ↓ move a highlight (`hover`) that stays in view
     through a `VirtualListScrollHandle`, Enter chooses it, Esc closes it. Clicks come
     through `on_item_click`, since virtual list rows take no handlers. The menu and the
     backdrop under it stop the wheel (`on_scroll_wheel` → `stop_propagation`), so only
     the menu scrolls while it is open.
   - **Task editor**, under the toolbar while Your own… is being written: on `raised`, a
     `muted` line (what it does, that it stays local and isn't posted), a `Textarea` (3 to
     10 rows, filled with the task found when there is no own one yet), a solid **Use this
     task**, a ghost Cancel and "120 / 6,000" (red past the limit, which disables the
     button). An empty task goes back to Found. Esc, or another source, closes it.
3. **Body**, the rest. One of:
   - an empty state, centered: a 44px icon tile (radius 12, `raised`, bordered; 19px glyph
     in `muted`, or the state's colour), a 14px title, a 12.5px `dim` line, and ghost
     buttons for what to do instead. Another machine (⇄); "Not a git repository" (⎇);
     "Couldn't read the diff" and "Couldn't list the pull requests" (! in `ansi1`, with the
     reason; the latter offers "Read it as a Branch"); "No open pull requests" (#, Branch and
     Uncommitted); "Pick the branch to compare with" / "Pick a pull request" / "Pick a
     commit" (◇); "Nothing to walk through" (✓ in `ansi2`, offering Branch and Last turn
     from Uncommitted, Uncommitted from the rest); for a turn, "Nothing to walk through yet"
     while it runs or "This turn changed no files" (↺, an "Other turns" dropdown and
     Uncommitted). While something is only being read ("Reading…", "Reading the diff…",
     "Reading the pull requests…") just the title, in `muted`, without an icon;
   - **hook help** (Last turn, no turn recorded), a 620px column: "Record the agent's
     turns" 18px semibold, one `muted` paragraph (what the hooks do), then three numbered
     steps in one bordered box (a 22px `accent` circle with the number, a 13px semibold
     title, rows divided by `border`): 1 "Copy the two hooks" with the settings in the
     terminal font on `raised`, one line per hook as the README shows them (the script path
     from `$HOME`, long lines wrapping under their own indent), a solid **Copy settings**
     (copies exactly that) and "✓ Copied" in `ansi2`; 2 "Add them to
     ~/.claude/settings.json" (next to existing hooks; the walkthrough never edits
     settings); 3 "Send your agent a prompt" (where snapshots go, the newest 20 kept);
   - **intro** (no walkthrough yet), a 620px column: "Read this change in the order it
     makes sense" 18px semibold, one paragraph in `muted`, chips for files, hunks,
     "≈ 3k tokens" (red past the limit), "N generated, not sent", "N not read" and, with a
     task, "Task: prompt" in `accent` (tooltip: where it came from), red
     notices when `claude` is missing or the diff is too large, the solid
     "Generate walkthrough with Haiku" button and "in English", then a bordered list of the
     changed files (26px rows: path, a "generated" chip, status, `+n` in `ansi2`, `−n` in
     `ansi1`);
   - **progress** (first generation running), centered: ✓ Read the diff (N hunks), a
     spinner on "Asking Claude Haiku" with the elapsed `m:ss`, ○ Putting the steps together,
     a line saying it runs in the background, and Cancel;
   - **the walkthrough**: a 248px contents column (right border) and the page.
     - Contents: the title 13.5px semibold, the summary 12px `muted` (line height 1.5), cut
       at 150 characters with "…" and a "Show more" / "Show less" link in `accent` 11.5px;
       a 3px read bar (`ansi2` on `raised`, radius 2) and "2 of 7 read" in `dim` 11px; then
       each part's title 10px uppercase `dim`, with "1 / 2" (its steps read / all) at the
       right, and its steps: an 18px square (radius 5) with
       the step number in `muted` on `raised`, ✓ in `ansi2` on `raised` once read (and its title
       in `dim` while another step is on screen), `!` in
       `blocked` on `blocked` + `29` alpha when outdated, the number in `accent` on `accent` +
       `29` with a tooltip when it changed since it was read; the title 12.5px (`muted` for skim
       steps), and a "KEY" tag for key steps (9.5px semibold `accent`, a 15px bordered box,
       `accent` + `55` border, tooltip "Key change"). Every row has a 2px left border, `accent`
       on the chosen row (which is on `accent` + `1f` alpha) and transparent otherwise. With
       Unread only on, "Unread only · u shows all" in `accent` 11px under the summary. A
       walkthrough matched against a task has a **Task** row next, shaped like a step's: `◎`
       in `accent`, "Task", and "2 / 3" (requests shown in this diff / all, in `ansi3` while
       some aren't, "—" for none). Then only
       the steps not read plus the one on screen ("Every step is read." when none). After a
       rule, "… Not covered" with its count (in `accent` while some of its hunks aren't read),
       then "Haiku · English · date · $0.002" in
       `dim` 10.5px. Hidden when the walkthrough is narrower than 720px.
     - Banners over the page, one shape (8px radius, a 3px left edge in the banner's colour
       on its colour + `14`, or on `raised` with a `border` edge for a quiet one; an 18px
       round icon on the colour + `29`; the message 12px, then a `muted` 11.5px detail line;
       the action at the right): "Writing a new walkthrough with Haiku… 0:12" + Cancel
       (`accent`, "…"); an error (`ansi1`, "!"); "The code moved on since this walkthrough
       was written." with "1 step describes code that has changed or is gone." (or "3 new
       hunks are listed under Not covered.") + Regenerate (`blocked`, "!"); quiet ("i"):
       "Showing the English walkthrough by Haiku. There's none in Türkçe by Sonnet for
       this code yet." + Generate; or, when the code is the same and only the preferences or
       the prompt version changed, "This code hasn't changed, but your preferences or this
       mod's prompt have since this walkthrough was written." + Regenerate, or, when it was the
       task, "The task has changed since this walkthrough was matched against it.", "This
       walkthrough was written without a task. Regenerate to match the change against it."
       or "This walkthrough was matched against a task that is now off or gone."; and "3 steps
       changed since you last read them." + "Go →" (`accent`, "↻"), each press the next such step.
     - Notices in the page (the intro's, the task page's) are the same tinted box with a 3px
       edge, without an icon; a `muted` one is on `raised` with a `border` edge.
     - Task page (before the first step, with a task): "TASK · THE TURN'S PROMPT" 10.5px
       semibold `dim`, a ghost "Show the task" / "Hide the task" at its right (the task's
       text on `raised`, line by line, and a line when the session's earlier prompts were
       given too); "What the task asks for" 17px semibold; one `muted` paragraph saying it
       tells where a request shows up, not whether it is done well; then a row per request
       with a bottom border: ✓ `ansi2` (seen), ◐ `ansi3` (partly), ○ `dim` (absent), each
       with a tooltip, the request 13.5px (`muted` when absent), then a **Partly** chip or
       "Not in this diff", a 20px bordered chip per step ("3. title", a click goes there),
       "and 2 hunks under Not covered" (a click goes there), **Outdated** when its code
       changed. Then "Not tied to any request" 14px semibold, a `muted` line, and a chip per
       such step. With no concrete request: a `muted` notice instead of the rows. A new
       walkthrough with a task opens here while none of its steps is read.
     - Page, scrolling, padding 16px 22px, gap 10: "PART · STEP 2 OF 5" 10.5px semibold
       `dim`, at its right a small ghost "Mark read" / "✓ Read" (disabled on an outdated
       step); the title 17px semibold with tinted chips **Key change** (`accent` on `accent`
       + `14`), **Context** (on `raised`), **Outdated** (`blocked` on `blocked` + `14`);
       with a task that names requests, a chip per request the step serves, "For: Retry
       failed uploads" (`ansi2` on `ansi2` + `12`, the whole request as tooltip), or "Not
       tied to a request" on `raised`; a click on either goes to the task page; the
       explanation 13.5px, line height 1.6, at most 820px wide; notes, full width up to
       820px, as a `blocked` chip on `blocked` + `12` (Decision, Upkeep, Limitation,
       Divergence, Untested, each with a tooltip) beside 12.5px `muted` text that wraps; for an outdated step one 12px line, "1 of 2 hunks" in
       semibold `blocked` then "changed or gone · what's left is below" in `muted` ("Every
       hunk" … "regenerate to read the code as it is now" when none is left); then the code,
       when any is left.
     - Code: one bordered block (radius 8); a 28px `raised` header per file with a bottom
       border (path semibold, status or "renamed from x", then the file's `+n` in `ansi2` and
       `−n` in `ansi1` within the block); a 22px hunk label on `hover` instead of git's `@@`
       line (which is its tooltip), divided from the lines above it: "Line 12" (where it
       starts in the new file; in the old one when nothing of it is left), "⋯ 28 lines · Line
       44" after another hunk of the same file, then git's context (the function or class)
       in the terminal font, `muted`; 20px lines in the terminal font 11.5px with a 2px left
       edge (`ansi2` added, `ansi1` removed, transparent otherwise): number (as wide as the
       largest number in the block needs, 7px a digit + 8, right-aligned, `dim`), sign (`ansi2`/`ansi1`), text unwrapped and coloured by
       `lib/highlight.js` from the theme: keywords `ansi5`, strings `ansi2`, numbers and
       constants (true, null, None …) `ansi3`, calls `ansi4`, Capitalised names `ansi6`,
       comments `dim`, the rest `foreground`. The comment style follows the extension (`#`
       for Python, Ruby, shell, YAML …, else `//` and `/* */`); Markdown, JSON, text and
       markup stay plain. Each line is coloured alone, so a comment or string spanning lines
       is only coloured on its first. Added lines on `ansi2` + `14` alpha, removed on `ansi1`
       + `14`. At most 2,500 lines per page, then "N more lines not drawn here."
     - Not covered page: the title, one paragraph, then a bordered card per file: ▶/▼,
       path, the model's note or "Generated file, not sent to the model." / "Binary file." /
       "Not read: larger than 1 MB.", status and `+n −n`; a card with hunks not read has an
       `accent` border and an "Unread" / "2 unread" chip, a read one's path is `muted`; a small
       ghost "Mark read" / "✓ Read" marks all its hunks. A card opens to its hunks; one not read
       has its hunk label in `accent` on `accent` + `1f`, starting "●".
4. **Footer** (with a walkthrough), 44px, top border: "← Previous" ("← Task" on the first
   step with a task page; disabled on the first page), "Next →" ("First step →" on the task
   page, "Not covered →" on the last step), "2 / 5 read · ← → to move" or "End of the walkthrough ·
   2 / 5 read", a ghost "Unread only" / "Show all";
   at the right, on the Pull request tab, a ghost "Post to #12", then a ghost "Copy as
   Markdown", the last send's, copy's or post's result (in `ansi2` with a ✓ when it
   worked), "Click a line to comment" or "2 comments", and with
   comments an agent dropdown ("Claude Code · t3") and a solid **Send**.

## How it behaves

- Opening reads the focused pane's folder (`focused()`, `panes()`), else the space's
  folder; `props().folder` and `props().scope` override. Nothing is generated on open.
- The diff is re-read when files change (`watchFolder` on the repo marks it dirty unless
  every changed path is in `node_modules`, in `.git` other than its index, HEAD and refs,
  or ignored by `git check-ignore`; a 1s tick re-reads) and when the scope, base, commit, model or language changes. A newer read
  wins over an older one still running.
- The walkthrough shown is the one cached for exactly this diff, model and language; else
  the one shown last for this repository and scope, with the banners above. Steps whose
  hunk ids are gone are **Outdated**; current hunks no step names go to Not covered.
- **Generate** starts a background job; the toolbar action becomes Cancel and the elapsed
  time counts each second. When the job's answer appears it is checked, stored and shown.
  Closing the dialog doesn't stop it; the next open picks the answer up. Errors show as a
  red notice: not logged in, timed out (2 minutes plus a second per hunk, at most 15),
  stopped without an answer (the process is gone), no usable steps, too large.
- Regenerating over an earlier state of the code, with the same model and language, sends
  the old walkthrough (titles and text, no hunk references) to be revised; another model or
  language writes its own.
- Steps: click one in the contents, ← → / j k / n p, or Previous/Next. Moving on from a
  step (→, Next, `walkthrough.next`) marks its hunks read; clicking in the contents marks
  nothing. `x` (or the page's button) marks the step read or unread. A different walkthrough
  opens on its first step not read.
- Read is per hunk, per repository, not per walkthrough or scope: the key is the hunk id
  without its scope (`path:digest`), so staging a hunk, switching scope or regenerating
  keeps it read, and a step of read hunks is ticked in any walkthrough. A step is read when
  all its hunks are and it isn't outdated. `u` (or `walkthrough.unread`, or the footer
  button) lists and steps through only the steps not read; back before the first stays put,
  on past the last is Not covered.
- Changed since read: a step not read now that holds a read hunk (outdated, or a new hunk
  beside read ones), or a hunk in a file where a read hunk of the walkthrough shown when
  this one was generated (`before` in the entry) is no longer in the diff.
- Comments: click a line to select it (`selection`) and open a box under it (input, Add,
  Cancel; Enter adds). A commented line shows the comment under it with ✕. Send pastes
  "Comments from reading the walkthrough of …" and one line per comment
  (`path:line` `` `code` ``: text) into the chosen agent with `hc send` (which presses
  Enter), then clears them. Agents offered: those in this space, the one the dialog opened
  over first, then the most recently active.
- **Copy as Markdown** puts the walkthrough on the clipboard (through
  `~/.herdr/walkthrough/clipboard.md` and `pbcopy`, else `wl-copy` or `xclip`): `## title`,
  the summary, a `<sub>` line (what was read · model · language · cost), then per part a
  `###` heading and its blurb, and per step "**N. title**" with · **Key change** /
  · _Context_ / · _Outdated_, its text, each note as `> **Decision:** …`, for an outdated
  step how many of its hunks changed, and its files as `` `path` +n −n ``. Then
  "### Not covered", one `- `path` (n hunks) — note` per file. No code. The footer says
  "Copied the walkthrough as Markdown." or why it couldn't.
- **Pull request** (needs `gh`): picking the tab lists the open pull requests again
  (`gh pr list --state open --limit 50 --json …`, newest update first) and keeps the picked
  one, else picks the current branch's. Its diff is `gh pr diff N --color=never`, one section
  with scope `pr`; no new files are added and the folder isn't watched (like Commit). Its
  source key is `pr:N`, not pinned to the head commit, so after a push the last walkthrough
  shows with its moved steps Outdated. gh's errors become one sentence: not installed, not
  logged in, no GitHub remote, too large ("Read it as a Branch instead"), not found.
- **Post to #12** asks first, in the footer: "Post this walkthrough as a comment on #12?
  Everyone who can see the pull request will see it." with a solid **Post** and Cancel (Esc
  cancels too). Post writes the Copy as Markdown text to
  `~/.herdr/walkthrough/pr-comment.md` and runs `gh pr comment N --body-file …`; over
  65,536 characters it refuses. The footer says "Posted the walkthrough to #12." or why not.
- Agent statuses (working, blocked, done, idle) are not shown; the agent dropdown names the
  program and the terminal.
- **Last turn** reads `~/.herdr/walkthrough/turns/<repo>/` (`<repo>`: the first 16 digits of
  `printf %s <top> | git hash-object --stdin`), watched with `watchFolder`, newest turn
  first; the turn shown is the newest of the terminal the dialog opened over, else the
  newest, until one is picked by hand. A turn is `git diff <start tree> <end tree>` with
  `GIT_ALTERNATE_OBJECT_DIRECTORIES` set to the turn's `objects/` (and the next turn's, for
  an interrupted one), one section with scope `turn`; its source key is `turn:<id>` and
  its description quotes the prompt's first line. A running turn's end is a snapshot taken
  now (into the turn's `now.index` and `objects/`), and the folder is watched as for
  Uncommitted; a finished one doesn't change with the working tree. A turn without
  `end.meta` ends at the next turn of its session or its terminal; the newest one stays
  running while its agent is `working` or `blocked`, and once it has been anything else
  (or gone from `agents()`) for 45 s (the hook timeout and 15 s), or 12 hours with no
  terminal recorded, the mod freezes it: a snapshot now, `end.meta` with `interrupted=1`,
  listed as "no Stop recorded, ended when seen idle". Turns with no session recorded are
  not one session: such a turn ends only at its terminal's next prompt. Open turns are listed again
  every 15 s. New files over 1 MB in the end snapshot (`end.big`) and not in the start's
  (`start.big`) are left out of the diff and listed "Not read: larger than 1 MB." A diff
  that finds an object missing says which is gone: the turn's folder (only the newest 20
  are kept), or, with the folder there, content the snapshot left to the repository's
  objects that `git gc` removed.
- Picking a turn pins it, unless it is the one that would be picked anyway. A pinned turn
  no longer listed (20 newer ones came) unpins: the newest is followed again.
- **Task** (`lib/task.js`): what a source is matched against, read with the diff on each
  reload. Found: a turn's prompt (unwrapped from `<hc from>`), with up to 3 earlier prompts
  of its session as context; a pull request's title and body (from the `gh pr list` call,
  which asks for `body` too), HTML comments and anything between `<!-- walkthrough -->` and
  `<!-- /walkthrough -->` left out; a commit's `git log -1 --format=%B`, trailers
  (Signed-off-by, Co-Authored-By …) and a merge's generated subject left out; for
  Uncommitted, Staged, Unstaged and Branch, the prompts typed into Claude Code in this
  repository since the last commit's committer time (Branch: the merge base's), numbered,
  oldest first. Those come from `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/<path with every
  character but a letter or digit made "-">*/*.jsonl` (files touched since then; lines
  `"type":"user"` whose `"cwd":"` is the repository or below it, kept with `grep -F` before
  anything is cut, so a sibling folder sharing the prefix can't crowd them out; without
  `tool_result`, `isSidechain`, `isMeta`; an image's base64 `data` emptied, never a line
  cut; at most 4 MB in all; then compaction summaries, non-human origins, commands and
  their output dropped, each `uuid` once), read at most every 5 s; with none there, the recorded turns' prompts since
  then. Slash commands alone, "[Request interrupted …" and empty prompts are no task. At
  most 6,000 characters (2,000 per message; past that the first and the newest that fit).
  Your own: per repository and source in the prefs (`tasks`, the newest 100); the text is kept while Found or Off is picked. Off: none. A commit message git couldn't read is asked again on the next read.
  Reading a task never fails the walkthrough: one that can't be read is no task.
- With a task, the system prompt gets the task rules and the prompt a `<task>` block (and
  `<earlier>` for context) before the digest, with every `<` that starts a `task` or
  `earlier` tag inside it (spaced, upper-case, `</task` with no `>`) turned into `‹`; the
  schema requires `asks`: `{ text, hunks, coverage: seen | partly | absent }`.
  `normalize` keeps 12, maps aliases to hunk ids (dropping unknown ones), makes a request
  with no hunk found `absent` and one called absent with hunks `partly`. The cache key gets
  the task's hash only when there is a task (`taskCacheKey`), so a walkthrough without one
  keeps its key and its prompt byte for byte; a task of prompts to agents adds the constant
  `prompts`, not its words, so another prompt ("thanks", the walkthrough's own Send) leaves
  the walkthrough exact, and its task page says "Matched against the prompts as they were
  when it was written; 5 prompts sent to agents now. Regenerate to match against them too."
  The banner compares the same keys. Auto doesn't write a turn that already has a
  walkthrough written without a task. The entry keeps `task: { from, label, short, text, context,
  key }`. `overlayAsks` lays the requests over the shown diff: their steps, hunks only
  under Not covered, hunks gone (Outdated), and the steps no request names (none when
  there is no request).
- Copy as Markdown adds "### Task", the source as `<sub>`, then `- ✓ request — step 2`,
  `◐ … — partly, steps 3, 4, Not covered`, `○ … — not in this diff`, and "Not tied to any
  request: step 5." Post to #12 leaves the task out unless it came from that pull
  request's description. The whole Markdown sits between `<!-- walkthrough -->` and
  `<!-- /walkthrough -->`.
- **Auto** (`autoGenerate` in the prefs: `on-open`, the default, or `off`): on open, the
  turn the tab shows, when finished and without a walkthrough by Haiku or by the picked
  model, is written with Haiku in the background (followed to its end even when another
  turn is picked meanwhile); in a pane (`props().overlay` unset), when an agent
  of this tab (`agents()`, `tab` the pane's) goes from `working` to `done` or `idle`, its
  newest finished turn is, once its Stop hook has written `end.meta` (up to 45 s: the
  hook's 30 s timeout and 15). Never a turn the mod froze (`interrupted=1`): its end may
  hold the person's own edits, so it waits for Generate. Never past 300 hunks or the prompt limit, and once per turn per open walkthrough. A finished
  run posts `notify({ title: "Walkthrough ready", body: 'Last turn: "…"', level:
  "success" })`. `on-stop` (written with the walkthrough closed) is planned.
- Model, language, scope, Auto and each repository's base are remembered in
  `shared("walkthrough.prefs")`. The first language is the system's (`defaults read -g
  AppleLanguages`, else `$LANG`).
- Keys from `keys.json`: `cmd-shift-k` → `mod.open:walkthrough`. Mod commands:
  `walkthrough.generate`, `.cancel`, `.next`, `.prev`, `.copy`, `.unread`, `.task` (opens the task editor). In the view, `x`
  marks the step read or unread, `u` toggles Unread only and `t` opens the task page.

## Built from

- `mods/walkthrough/mod.json`: `{ "place": "none", "title": "Walkthrough", "overlay": {
  "kind": "dialog", "modal": true, "width": 0.9, "height": 0.9 } }`.
- `main.js` (the `View`), `view.js` (state and drawing), `engine.js` (cache and job, the
  only file that touches the disk besides git), `ui.js` (button, chip, menu, dropdown face).
- `lib/` is plain JavaScript taking `exec` as an argument, tested with `node --test`:
  `hash.js` (a 53-bit string hash; no host crypto needed), `hunks.js` (unified diff → files
  and hunks; hunk id `scope:path:hash8(function name after @@ + lines)`, without the line
  numbers so a hunk that only moved keeps its id; `-2`, `-3` for identical hunks in a file), `generated.js` (lockfiles, `.min.js`, `.map`, `.generated.`, `__snapshots__` …, by
  name only), `digest.js` (`=== path (status) [scope]`, then `[h1] @@ … @@` and the lines;
  generated files left out), `prompt.js`, `walkthrough.js` (JSON schema, `normalize`,
  `parseJson`, `overlay`), `sources.js` (git), `cache.js` (keys, limits), `job.js`
  (`run.sh`, reading the answer), `languages.js`, `comments.js`, `read.js` (read keys,
  `stepRead`, `markStep`/`unmarkStep`, `prune`, `mergeRead`, `changedSince`), `task.js`
  (where a task comes from, transcripts, `resolveTask`, `taskKey`, the transcript listing
  script).
- Git, with `--no-optional-locks -c core.fsmonitor=false -c core.quotePath=false -c
  diff.autoRefreshIndex=false` and `--no-color --no-ext-diff --no-textconv
  --src-prefix=a/ --dst-prefix=b/ -M`: staged `diff --cached`, unstaged `diff` plus every
  untracked file as `diff --no-index /dev/null <file>`, branch `diff $(merge-base base
  HEAD)` plus untracked, commit `diff <first parent or empty tree> <hash>`. Base default:
  `origin/HEAD`, else origin/main, origin/master, main, master, trunk, develop.
- The job: `~/.herdr/walkthrough/jobs/<place>/` with `system.txt`, `prompt.txt`,
  `schema.json`, `meta.json` (key, model, language, alias → hunk id, deadline) and
  `run.sh`, started with `exec("sh", ["-c", "nohup sh \"$0\" \"$1\" >/dev/null 2>&1 &",
  run.sh, model, seconds])`. `run.sh` runs `claude -p --output-format json --tools '' 
  --no-session-persistence --strict-mcp-config --setting-sources '' 
  --disable-slash-commands --model $1 --json-schema "$(cat schema.json)" --system-prompt
  "$(cat system.txt)" < prompt.txt > out.json 2> err.txt &`, writes `pid`, starts a watchdog that
  kills claude after `seconds` (checking every 3 s and leaving with it), waits, writes
  `code`. Starting a job over a folder whose run is still alive kills that run first. The answer is `structured_output`, else the JSON in `result`.
- Storage: `entries/<key>.json` (key: hash of version, prompt version, repo, scope, model,
  language, `preferences.md` and the path, status and hunk ids of every file the model
  reads: generated and unread files don't count), `pointers/<hash(repo, scope)>.json`,
  the newest 200 entries kept. An entry also holds `before`: the hunk ids of the walkthrough
  shown when it was asked for. `read/<hash(repo)>.json` is `{ "path:digest": ms }`, the
  newest 5,000 marks kept, written on the 1s tick when something changed: this window's
  changed keys over what is on disk now, so two windows keep each other's marks.
- `herdr`: `exec`, `hc` (`send`), `readTextFile`, `writeTextFile`, `watchFolder`, `home`,
  `appHome`, `focused`, `panes`, `spaces`, `agents`, `notify`, `shared`/`setShared`,
  `nextCommand`, `props`, `closeOverlay`, `theme`, `settings().font_family`. Programs run:
  `git`, `claude`, `sh`, `env`, `nohup`, `kill`, `mkdir`, `rm`, `ls`, `wc`, `defaults`,
  `stat`, `grep`, `cut`, `tail`.
- `turnview.js` (the Last turn tab's state, Auto and the hook help), `lib/turns.js` (the
  hook's JSON, `.meta` lines, the folder listing, where each turn ended, the settings
  snippet), `hooks/turn.sh`.

## Hooks for Last turn

The Last turn tab reads turns recorded by two Claude Code hooks running
`mods/walkthrough/hooks/turn.sh`. After copying the mod, **ask the person** whether to add
them; with a yes, merge these into `~/.claude/settings.json`, keeping every hook already
there (append to the `UserPromptSubmit` and `Stop` arrays, never replace them), with the
path of the installed copy (a renamed folder keeps its new name):

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "sh \"$HOME/.config/herdr-app/mods/walkthrough/hooks/turn.sh\" start", "timeout": 30 }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "sh \"$HOME/.config/herdr-app/mods/walkthrough/hooks/turn.sh\" stop", "timeout": 30 }] }]
  }
}
```

With a no, say the tab shows the same settings and a Copy button. The mod itself never
writes the settings.

`turn.sh start` (UserPromptSubmit) ignores a prompt starting `<task-notification>` (a
background task's notification: the session's turn goes on, and its next Stop ends it
again). Otherwise it saves stdin unparsed as `start.json` in
`turns/<repo>/<seconds>-<pid>/`, snapshots the working tree and writes `start.meta`
(`tree=`, `started=`, `session=`, `terminal=$HC_TERMINAL_ID`) last; then keeps the
newest 20 turns, removing older folders with their `objects/`. Before the snapshot it
drops the `index` of every turn with an `end.meta` and of the session's earlier turns;
another session's running turn keeps its own. A failed snapshot leaves `start.json`
without `start.meta`. `turn.sh stop` (Stop) snapshots again into the session's newest turn
(found by `session=` in `start.meta`, or `session_id` in `start.json`) and writes
`end.json` and `end.meta` (`tree=`, `ended=`); a second Stop (a stop hook kept the agent
going) ends it again, later. When that newest turn has no `start.meta`, Stop writes
nothing: no older turn ends in its place. A snapshot: copy the
repository's index (`git rev-parse --git-path index`, `cp -p`) to the turn's `index` once,
then with `GIT_INDEX_FILE=<turn>/index GIT_OBJECT_DIRECTORY=<turn>/objects`, `git -c
core.fsmonitor=false add -A -- . ':(exclude,literal)<each new file over 1 MB>'` and `git
write-tree --missing-ok`, after `git update-index --force-remove` of those big files (one
that was small when the turn began is in the turn's index already). The big files go to
`start.big` / `end.big`, one per line. A copied index git can't use is deleted and the
snapshot run again without it (the mod's own snapshot of a running turn does the same,
without copying again). It prints nothing and always exits 0.

## Watch out

- `exec` stops after 30 s and 8 MiB, and `readTextFile` reads 1 MiB: the model call must
  run detached, and big untracked files are sized first (`wc -c`) and skipped over 1 MB.
- Without `--tools ''`, `--strict-mcp-config`, `--setting-sources ''` and
  `--disable-slash-commands`, `claude -p` carries the whole local setup: a one-line answer
  cost $0.30 instead of $0.0003 in testing. `--bare` would avoid it but refuses the
  subscription login.
- `writeTextFile` replaces a file only when given its current text; read it first.
- Inside a hunk every line is content: a removed `-- comment` is not a `--- a/file` header.
  Count the hunk's remaining old and new lines. Paths with spaces are not quoted in
  `diff --git`; take them from `+++ b/…` (which may end in a tab) or split the header in
  its middle.
- Don't hash a hunk's `@@ -a,b +c,d @@` numbers into its id: one added line above would
  rename every later hunk of the file and mark untouched steps Outdated.
- A key command must pass the same checks as the button (not while the diff is read, not
  with zero hunks, not twice), and the cache key is computed at send time from the model,
  language and preferences actually sent.
- A read started before a job began must not overwrite the job when it lands: count job
  changes and keep the job if the count moved.
- Size untracked files with exactly one output line per file (`-1` when unreadable), or a
  size lands on the wrong path.
- Don't name a field like a method on the same object (`this.key` hid `key(e)`).
- Scope keys: `uncommitted`, `staged`, `unstaged`, `branch:<base>...<head>` (the branch is
  re-read on every read, so a checkout makes it another walkthrough; detached is
  `HEAD@<short>`), `commit:<hash>`.
- A merge conflict comes as `diff --cc` with `@@@` hunks: list the file as "conflicted",
  unread, and skip its whole block, or its `+++` line renames the file before it.
- Uncommitted holds a file twice when it has staged and unstaged edits: key comments, the
  comment box, open cards and element ids by source, scope and path, and label the copies
  "staged" / "unstaged". Comments belong to the source they were made on; Send sends only
  the shown source's.
- A model step dropped for empty text must not claim its hunks.
- A pid file can outlive its process: signal or trust a pid only when `ps -o command=`
  shows the run's flags (`--json-schema`, `--no-session-persistence`,
  `--strict-mcp-config`, `--disable-slash-commands`).
- claude exits a moment before run.sh writes `code`: wait 3 s and look again before
  calling a job dead. Two windows may see one answer: claim the job folder with `mv`, and
  the window that loses just reads again.
- In a linked worktree `.git` is a file; also watch `git rev-parse --absolute-git-dir`
  (its index, HEAD, logs/HEAD).
- Keep new files in the order `ls-files` lists them, whatever order their diffs finish in:
  a binary new file has no `+++` line to sort by, and the order is part of the cache key.
  Re-diff a new file only when its size or modification time (`stat -c '%s %.9Y'`, else
  `stat -f '%z %Fm'`) changed.
- Size the intro's estimate from the very prompt Generate would send (preferences and the
  handed-on walkthrough included), or the button and the check disagree.
- After a checkout, re-read the bases for the new branch; detached is `HEAD` or `HEAD@…`
  only, never every name starting with HEAD.
- Showing an entry `touch`es it, so eviction (newest 200 by mtime) is least recently used.
- While a job runs, look only for `code` each second; check the folder and the process every
  fifth second. A launch whose `sh` fails reports its error rather than "stopped".
- Past the line cap, draw no more file or hunk headers either.
- A plain `overflow_y_scrollbar` box inside an absolutely placed popup neither scrolled
  with the wheel nor had a way to follow the keyboard: use a virtual list with a scroll
  handle, and give the root the focus when a picker opens so ↑ ↓ Enter reach it.
- Hand the model aliases (h1, h2 …), never ids, and drop any alias it returns that the
  digest doesn't have.
- Run git with explicit prefixes and no color: `diff.noprefix` or `color.diff=always` in a
  user's config would break the parser.
- `<mod>.<command>` reaches a copy opened after the last save of the mod; a copy reloaded
  in place by a save does not get them until it is opened again.
- A diff over 640,000 prompt characters (≈ 175k tokens) is refused, never clipped.
- Keep read marks without the scope (`staged:` / `working:` …), or staging a hunk unreads it.
  Scopes hold no colon; paths may, so the path of a key is everything before its last colon.
- Don't tick a step for being visited: an outdated step's read hunks still describe code
  that's gone. A step is read when all its hunks are and it isn't outdated.
- Write read marks by merging the keys changed here into the file as it is now; writing the
  whole record back would drop another window's marks.
- Remote spaces are not supported.
- A UserPromptSubmit hook's plain stdout is added to Claude's context: `turn.sh` must
  print nothing, errors included. Claude Code runs no Stop hook for a turn stopped with
  Esc: read such a turn up to its session's next start.
- `exec` takes no environment: run git as `exec("env", ["GIT_INDEX_FILE=…", "git", …])`.
- Hash the turns folder's key inside the repository (`cwd` its top) in the hook and the
  mod alike: outside one `git hash-object` uses SHA-1, inside a SHA-256 repository not.
- Find big new files with `xargs -0 … find -size +1048576c`, not one `stat` per file:
  thousands of untracked files would overflow the argument list.
- Don't give a snapshot the repository's objects as an alternate: git updates the
  modification time of every object (and pack) it finds again while writing. Keep them
  out of sight and write the tree with `--missing-ok`; the files the copied index already
  names point at the repository's objects, and the turn is read with both.
- Copy the index with `cp -p`: a copy with a new modification time makes git trust the
  stats of a file edited in the same second as the index was written (racy git), and a
  same-size edit is missed.
- Last turn's `on-stop` (written when the agent stops, with no walkthrough open, by
  `node bin/prewarm.mjs`) is planned and not built: the engine calls `herdr` directly.
- Claude Code is the only model runner; Codex (`codex exec` with a JSON schema) is planned
  and not built.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/walkthrough` passes and `npm test` passes.
- In a repository with staged, unstaged and new files, Uncommitted lists all of them, a
  lockfile marked "generated"; Staged lists only the staged file.
- Generate shows the progress rows, then a walkthrough with a title, summary, parts and
  steps, each step's code under it, and "$0.00x" under the contents; the lockfile is under
  Not covered as "Generated file, not sent to the model."
- `herdr-app do overlay.close` during a generation, wait, reopen: the walkthrough is there
  and `~/.herdr/walkthrough/jobs/` is empty.
- Editing a file a step covers marks that step Outdated and shows the stale banner within
  a few seconds; the edit appears under Not covered; Regenerate brings a fresh walkthrough.
- Branch on a feature branch defaults to `main` and includes its commits, its uncommitted
  edits and its new files, but not commits made on `main` since.
- Commit on the root commit shows every file as added.
- Clicking a line, typing and Enter adds a comment under it; Send pastes it into the
  chosen agent.
- With the hooks added, a prompt that edits a file and adds one shows on Last turn as
  exactly those two files, not edits made before or after it; the repository's
  `.git/index` and `.git/objects` are byte for byte and time for time as they were.
- In a pane with Auto on, an agent finishing a turn brings a "Walkthrough ready"
  notification and the turn's walkthrough, by Haiku.
- → through two steps ticks them; close and reopen: the ticks are there, "2 / N read", and it
  opens on the first step not read. Stage the code: still ticked. `u` hides the read steps.
- Edit a line a read step covers and reopen: "1 step changed since you last read it." Go →
  lands on it; under Not covered the edit is "Unread". Regenerate: steps whose hunks didn't
  change are ticked at once.
- Commit on a commit with a body shows "Task: commit message"; Generate opens on the task
  page, each request with its steps, and each step says which request it serves. A merge
  of a pull request is matched against the pull request's title, not "Merge pull request
  #8 from …".
- Task → Off, Generate: no task page, no Task row, and the key and prompt are those of a
  walkthrough written before tasks existed. Task → Your own…, write one, Use this task:
  "The task has changed since …" until Regenerate.
- With local edits made after prompts to Claude Code in the repository, Uncommitted shows
  "Task: 2 prompts"; a question or "thanks" among them isn't a request.
- Post to #12 of a walkthrough matched against your own words posts no Task section;
  matched against #12's description, it does.
