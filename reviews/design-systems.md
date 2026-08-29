1. [MAJOR] src/styles.css:982 — .dropzone-tile hardcodes `background: rgba(59, 130, 246, .12)`, a raw accent blue the diff adds; it is also the wrong blue (#3b82f6 vs the single accent token `--primary` #2563eb), so it diverges from the one-accent rule. Fix: `background: color-mix(in srgb, var(--primary) 12%, transparent);`.
2. [MAJOR] src/styles.css:1073 — .result-card `background: rgba(34, 197, 94, .06)` is a raw bright green that does NOT match its own border `var(--success)` (#b9c6a7 sage); a tint token `--success-bg` (#edf4e3) already exists. Fix: `background: var(--success-bg);` (and adjust the dark override at line 1102 to the matching dark success tint rather than raw green).
3. [MAJOR] src/styles.css:1096-1101 — the dark overrides introduce raw neutral hex surfaces (#141416, #161618, #1c1c20, #232327, #2a2a30) that clash with the established dark palette, which fills surfaces with `rgba(15, 23, 42, .68/.72/.74)` and borders with `rgba(148, 163, 184, .16/.18)` (see lines 1236-1256). Fix: reuse those slate rgba fills/borders for .dropzone/.file-chip in dark instead of new near-black hex.
4. [MAJOR] src/styles.css:1022 — .file-chip `gap: 10px` is off the 4px grid. Fix: use 8px or 12px.
5. [MAJOR] src/styles.css:1055-1056 — .file-chip-remove is an interactive `<button>` sized 28×28px, below the 44px minimum touch target. Fix: make it 44×44px (or keep the 28px visual box and expand the hit area to 44px via padding/negative margin).
6. [MAJOR] src/styles.css:1063 — .file-chip-remove:hover sets `color: var(--danger)`, but `--danger` is a light surface token (oklch 88.5% lightness); as an icon color on the light `--paper-soft` hover background it is effectively invisible in the light theme. Fix: use `var(--danger-fg)` (or `--danger-strong-fg`).
7. [MINOR] src/styles.css:959 — .dropzone `border: 1.5px dashed` uses an off-grid hairline width. Fix: use 1px or 2px.
8. [MINOR] src/styles.css:961,1027 — .dropzone and .file-chip use raw `rgba(255, 255, 255, .4/.5)` glass fills; a `--card` token (rgba(255,255,255,.78)) exists, though the file already uses raw white throughout as a legacy pattern. Fix: adopt `--card` (or a shared glass token) so opacity is centralized.
9. [MINOR] src/styles.css:981,1026,1057 — one-off `border-radius` literals (16px on .dropzone-tile, 12px on .file-chip, 8px on .file-chip-remove) bypass the radius scale; 12px equals the existing `--radius-lg` and 8px is near `--radius-sm` (6px), and the system elsewhere uses `calc(var(--radius) - N)`. Fix: use `var(--radius-lg)`/`var(--radius-sm)` (and a scale value for the tile).
10. [MINOR] src/styles.css:987,1009 — new one-off font sizes 15px (.dropzone-title) and 13px (.dropzone-cta) sit outside the shared type scale (12px/14px are reused nearby). Fix: fold into the existing scale or promote to a size token.
11. [MINOR] src/styles.css:1071,1084 — .result-card border and .result-card-check icon use `var(--success)` (light sage #b9c6a7), giving a weak-contrast border/icon; `--success-fg` (#31412f) is the intended foreground step. Fix: use `var(--success-fg)` for the border and check icon, keeping the tint background on `--success-bg`.
12. [MINOR] src/styles.css:1067-1074 — .result-card re-declares the same card scaffold (grid + gap + padding + 1px border + `var(--radius)`) as .surface-muted and .pdf-result-panel, differing only in the success tint. Fix: compose from a shared surface class and override only border/background.

## Resolutions
1. FIXED — `color-mix(in srgb, var(--primary) 12%, transparent)`.
2. FIXED — de-greened to `--card` bg + `--line` border (no second colour).
3. FIXED — dark overrides now reuse the slate rgba surface/border tokens, no new near-black hex.
4. FIXED — `.file-chip` gap 8px.
5. FIXED — 44×44 via `.icon-button`.
6. FIXED — remove hover uses `--danger-fg`.
7. FIXED — dropzone border 1px.
8. FIXED — `.dropzone`/`.file-chip`/`.result-card` use `var(--card)`.
9. FIXED — `--radius-lg`/`--radius-sm` on chip/remove; tile keeps 48px box (no token) — left.
10. PARTIAL — title → 14px (on-scale); CTA 13px kept as a small-control size.
11. RESOLVED by de-greening — border `--line`, check `--primary`.
12. DECLINED — kept `.result-card` as a dedicated class for clarity; composing from `.surface-muted` deferred (low value, adds coupling).
