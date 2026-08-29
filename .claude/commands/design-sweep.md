---
description: Full design + a11y sweep — chains 7 skills (aesthetics → UX → interface rules → React perf → live a11y → QA) into one ranked report + fixes.
argument-hint: "[target-path] [dev-url]  e.g. src/components http://localhost:5173"
---

Run a complete design and accessibility sweep on this React + Vite + Tailwind PDF web app.

**Target files:** `$1` (default `src/components` if empty)
**Live URL for a11y scan:** `$2` (if empty, start the dev server yourself with `npm run dev` and use the printed URL)

Execute these stages **in order**. Each stage is a skill — invoke it, capture its findings, then move on. Do not skip a stage; if a skill is unavailable, note it and continue.

## Static-code stages (no server needed)
1. **`frontend-design`** — aesthetic direction and visual-quality read on the main tool screens under the target path. Flag generic/templated patterns.
2. **`ui-ux-pro-max`** — layout, color, typography, spacing, and motion review for a React + Tailwind + framer-motion stack.
3. **`web-design-guidelines`** — audit the target files against the Web Interface Guidelines (the 100+ rules: accessibility, interaction, forms, states).
4. **`vercel-react-best-practices`** — performance + composition review of the same files (re-render hazards, memoization, bundle, data flow). Ignore Next.js-only rules — this app has no Next.js.

## Live stage (needs a running page)
5. **`accessibility-scan`** with the dev URL — real live-DOM WCAG 2.2 violations, each grounded to a DOM selector and `file:line`.

## Verify stage
6. **`design-review`** — final designer's-eye QA pass on the rendered app.

## Consolidate + fix
- Merge every finding into **one table**, columns: `severity | source-skill | file:line | issue | proposed fix`.
- Sort by severity (blocker → high → medium → low). Dedupe overlaps across skills.
- Apply the **high-confidence** fixes directly. For accessibility findings, use **`accessibility-fix`**.
- Leave anything ambiguous or aesthetic-judgment as a listed recommendation — do not guess.
- End with a short summary: N findings, M fixed, K left for review.

Follow the `karpathy-guidelines` skill for any code you change: surgical edits, match surrounding style, state assumptions.
