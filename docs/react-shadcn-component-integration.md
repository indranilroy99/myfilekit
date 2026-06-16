# React / shadcn Component Integration Notes

MyFileKit uses React, TypeScript, Tailwind, and Vite. It is shadcn-compatible, but it does not depend on the shadcn CLI yet.

## Current Stack

- App entry: `src/main.tsx`
- App shell and tool UI: `src/App.tsx`
- Components: `src/components/`
- shadcn-compatible UI components: `src/components/ui/`
- Styles: `src/styles.css`
- Tool registry: `src/registry/tools.registry.js`
- Local processing services: `src/services/`

## shadcn Path

This project uses the conventional source-based folder:

```text
src/components/ui
```

The Vite and TypeScript configs map `@` to `src`, so imports such as `@/components/ui/example-component` work cleanly. Keeping this folder matters because shadcn examples and registry components commonly expect the `@/components/ui/...` convention.

## Component Notes

The app header intentionally does not include a secondary search dock. The dashboard Spotlight search is the primary search experience, which keeps navigation cleaner and avoids duplicate controls.

The dashboard hero uses a local WebGL neural-noise background component at:

```text
src/components/ui/neural-noise.tsx
```

It is intentionally subtle, respects reduced-motion preferences, and does not require external assets or runtime dependencies.

The local shadow experiment lives at:

```text
src/components/ui/etheral-shadow.tsx
```

It is kept as a privacy-safe component experiment, but it is not part of the primary MyFileKit theme. The product UI should stay a clean SaaS utility interface. The original demo depended on remote Framer image URLs for mask and noise textures; MyFileKit replaces those with local SVG/CSS gradients and grain if the component is used later.

Dependencies:

- `framer-motion`
- `lucide-react`

The components use the current Tailwind theme bridge in `src/styles.css` for shadcn-style class names such as `bg-card`, `border-border`, `hover:bg-muted`, and `text-muted-foreground`.

## Adding shadcn Later

If the project later needs the full shadcn CLI workflow, initialize it against the existing Vite, React, TypeScript, and Tailwind setup. Keep the component path as `src/components/ui` and keep the `@/*` alias mapped to `src/*`.

```bash
npx shadcn@latest init
```

## Product Guidance

Keep UI components connected to real tool workflows. Demo-only controls should not appear in the product shell unless they route, filter, download, or otherwise perform a visible user action.
