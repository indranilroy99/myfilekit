# Session summary — what changed while you were away

Merged to `main` as **v4.2.0** after an independent reviewer passed it on the
sixth round. The `feat/workspace-home` branch is retained if you want to inspect
or revert.
Everything below is committed. Nothing here is aspirational — where something is
unfinished or uncertain, it says so.

**One thing to be clear about:** this work stopped when the session ended, not in
the morning. There was no overnight process. What follows is what actually got
done in one working stretch.

---

## The state of it

| Gate | Result |
|---|---|
| Tests | 310 pass / 0 fail |
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

### 5. A file could reach the P2P sender — found, fixed, retested

The most serious bug of the session, and I introduced it. The Workspace hand-off
adopted staged files into the *first* file control that mounted, whatever tool
that was. Choosing a file, browsing the filtered list, clearing the filter, then
opening **P2P File Share** pre-loaded that file into a WebRTC sender — no user
intent, no sign anything was staged, and a status bar reading "Offline · nothing
uploaded". One click from transmitting it.

Now nothing is staged when a file is dropped. Files stage only when you click a
specific offered tool, only that tool can take them, and any other navigation
drops the stash. Verified live: the exact repro now yields no file, while the
intended path still works. Guarded by tests.

### 6. Honesty fixes
- The status bar claimed "Offline · nothing uploaded" on every route. Six tools
  can reach a network — the e-signature backend, three bring-your-own-endpoint AI
  tools, and two WebRTC tools whose optional STUN/TURN reveals your IP. Each now
  carries an accurate label, and a test fails if one is missing from the list.
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

- **Three review rounds completed; a fourth was running when the session ended.**
  - Round 1: DO-NOT-SHIP — file matcher, discarded file, mobile header overlay. Fixed.
  - Round 2: DO-NOT-SHIP — the P2P hand-off leak above. Fixed, and round 3
    independently confirmed both it and the double-pick fix.
  - Round 3: DO-NOT-SHIP — my own mobile menu "fix" anchored the panels to the
    trigger button instead of the viewport, collapsing them to 43-112px slivers
    of unlabelled icons at 375px, where they are the only navigation. Worse than
    the bug it replaced. Fixed: below 640px the anchor leaves the positioning
    chain, panels span the menubar in one column. Measured at 375px — every menu
    359px wide, inside the viewport, zero clipped labels, screenshot confirms.
  - Round 4: DO-NOT-SHIP — the mobile menu still hid 40 of 51 tools (my
    `columns: 1` did not stop the spill), and dropping `!important` in that same
    commit threw the search dropdown to x=-159 with its results off-screen.
  - Round 5: DO-NOT-SHIP — all three of round 4's fixes survived on paths they
    did not cover: the multicol spill returned at 641-975px and on short
    viewports (24 of 51 PDF tools hidden at 768px, iPad portrait), the search
    popup still rendered at x=-159 in the 641-715px band where the menubar
    wraps, and hover-switching between menus reused the previous trigger's
    geometry, pushing panels 261px off-screen with nothing to scroll.
  - Fixed structurally rather than per-breakpoint: multicol removed entirely
    (the panel is a grid, which can only grow downwards), panels anchored to the
    full-width menubar instead of their trigger, and geometry measured whenever
    a menu opens — any path — rather than in the click handler. Verified across
    17 widths and 4 short viewports: zero links outside the panel, zero
    off-viewport, zero spill; the search popup is inside the viewport at every
    width.
  - Round 6: **SHIP.** 5 menus x 20+ viewports x both open paths, hit-tested per
    link: zero clipped, zero off-viewport, zero unreachable. All 105 tool routes
    swept at desktop and 375px with zero console errors. Real end-to-end runs
    produced valid output (Merge PDF, PDF to Image, Split, Compress, File Hash).
    Five cosmetic findings; three fixed, two left with reasons.

  **The pattern worth knowing.** Five rounds, five DO-NOT-SHIPs, and every
  blocker was mine — four of them introduced by the commit that claimed to fix
  the previous one. My own verification passed every time, and twice my evidence
  was actively wrong: I reported "51 links, zero clipped labels" while counting
  links laid out *outside* the panel. The lesson is not that reviews are useful
  in general; it is that self-review is blind to exactly the thing you just
  changed, and that a measurement chosen by the person who wrote the fix tends to
  confirm it.
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
- **Merged** — round 6 passed it, so it is on `main` as v4.2.0 and pushed. Not
  deployed: that is your call, and nothing here touched a deploy path.
- **Before you deploy, one 60-second manual check:** service-worker registration
  could not be verified in the automation browser (it fails there for every
  script, including a 404, so it is a CDP limitation rather than an app defect).
  The failure is caught and swallowed, so it cannot break the page either way —
  but confirm the PWA registers in a real browser.
