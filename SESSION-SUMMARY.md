# Session summary — what changed while you were away

Branch: `feat/workspace-home` (not merged to `main`; see "Your call" at the end).
Everything below is committed. Nothing here is aspirational — where something is
unfinished or uncertain, it says so.

**One thing to be clear about:** this work stopped when the session ended, not in
the morning. There was no overnight process. What follows is what actually got
done in one working stretch.

---

## The state of it

| Gate | Result |
|---|---|
| Tests | 308 pass / 0 fail |
| TypeScript + build | clean |
| `npm run security:audit` | pass (SRI + sha256 pins verified) |
| `npm audit` | 0 vulnerabilities |
| New dependencies | none |
| Initial JS payload | entry chunk 724 KB → **139 KB** (−81%) |

---

## What changed

### 1. The navigation was duplicating itself — fixed
The sidebar and the canvas rendered the *same list*: measured 51 of 51 PDF tools
in both on a category route. The sidebar is now high-level context only (Library,
Categories, Recent). Tool access is the menubar mega-menu — verified by review to
enumerate all 105 with nothing orphaned — plus the inspector rail of siblings
inside a tool.

### 2. The homepage was a sitemap — now it is a workspace
`#dashboard` used to be a 105-row directory. It is now a drop target: drop a file
and you get the tools that can act on it, plus a dense task palette. The full
index moved to `#browse-tools`, which is where a full list belongs.

### 3. Code-split into lazy modules
`App.tsx` was 9,702 lines holding the shell *and* all 105 tools, so every route
parsed every tool. Components now live in `src/tools/*.tsx`, loaded per category
via `React.lazy`. Entry chunk dropped 81%. All 105 routes verified rendering.

### 4. Blockers found by independent reviewers, and fixed
Three critic agents reviewed the work; between them they returned two
DO-NOT-SHIP blockers and a dozen majors. The ones worth knowing about:

- **Tools leaked state into each other.** Split PDF and Delete Pages share a
  renderer, so switching between them carried the previous tool's files and page
  ranges over — one click from deleting the wrong pages. Fixed with a keyed
  renderer.
- **The skip link broke the app.** `href="#root"` went into the hash router and
  navigated to "Page not found" — the one control a keyboard user relies on.
- **The mobile header covered its own controls.** At 375/390px the menubar
  wrapped but its grid row was pinned to 38px, so the search box and theme toggle
  were unclickable.
- **"Drop a file to start" started nothing.** The dropped file was discarded and
  the user had to pick it again on the tool page. Files now carry through.
- **The file matcher rejected files we have tools for**, and a file named `pdf`
  with no extension matched all 59 PDF tools.

### 5. Honesty fixes
- The status bar claimed "Offline · nothing uploaded" on every route, including
  the two tools whose own copy says they are server-backed. It now says so.
- A test banned *all* dynamic imports as a proxy for "no remote code", which
  blocked a legitimate bundled split. Rather than weaken it, it now requires
  dynamic imports to be relative literals — a remote URL or computed specifier
  still fails. Stricter than before.

---

## What I refused to do, and why

Two reviewer recommendations were rejected on purpose:

1. **A "Recent documents" table with filenames, sizes and dates.** We store
   nothing about your files. Adding that would create data at rest and undermine
   the one claim the whole product rests on. The emptiness it was meant to fix
   was solved with layout instead.
2. **Declaring `.txt`/`.md`/`.json` support on the text and data tools.** Those
   tools take typed input, not files — verified, none of them has a file input.
   Declaring it would have put a false claim in the registry to make a matcher
   look better.

---

## Still open

- **A re-review was running when the session ended.** It was re-verifying the
  nine release findings and hunting for regressions in the hand-off, the ext
  filter, and the lazy chunks. Its result is not in this document. Treat the
  branch as "fixed and self-verified, awaiting independent confirmation".
- **~900 lines of dead marketing components** remain in `App.tsx` (`Shell`,
  `Dashboard`, `BrowseToolsPage`, etc.). They are tree-shaken, so there is no
  runtime cost. I attempted a mechanical deletion, it broke on JSX braces, and I
  reverted it rather than risk the file.
- **`window.MyFileKit` still eagerly loads ~142 KB** of services at startup.
  Making it lazy is the next payload win but changes *when* the global appears,
  so I left it.
- **Three contrast findings** report self-contradictory ratios (1.23:1 on text
  that screenshots legibly, numbers shifting with unrelated edits). I believe the
  engine mixes static CSS with live DOM; flagged rather than silently closed.

---

## Your call

- **`GO-TO-MARKET.md`** is the commercial read you asked for. The short version:
  the product is good, but it is MIT-licensed and public, and 100% client-side —
  so features cannot be defended and paywalls cannot be enforced. What is
  sellable is distribution (a signed desktop build), enterprise packaging, the
  inherently-hosted e-sign tier, and certification. Fix the business
  architecture, not the code.
- **Merging** `feat/workspace-home` into `main` is deliberately left to you —
  it is a significant UX change and the re-review had not reported back.
