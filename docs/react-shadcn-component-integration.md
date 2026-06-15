# React / shadcn Component Integration Notes

MyFileKit v2 now uses React, TypeScript, Tailwind, and Vite. That means React components can be integrated cleanly, but the project is not yet a shadcn project.

## Current Stack

- App entry: `src/main.tsx`
- App shell and tool UI: `src/App.tsx`
- Components: `src/components/`
- Styles: `src/styles.css`
- Tool registry: `src/registry/tools.registry.js`
- Local processing services: `src/services/`

## shadcn Path

If shadcn is added later, use the conventional folder:

```text
src/components/ui
```

That path matters because shadcn imports are usually configured around `@/components/ui/...`.

## Provided Shader Component

The attached shader component requires:

- `three`
- `@react-three/fiber`
- optional `@paper-design/shaders-react`
- optional `tw-animate-css`

These are not part of the v2 app yet. They should only be added if the shader becomes part of a real product surface.

Recommended install when needed:

```bash
npm install three @react-three/fiber
```

Optional demo dependencies:

```bash
npm install @paper-design/shaders-react
npm install -D tw-animate-css
```

## Product Guidance

Use shader/WebGL visuals carefully. MyFileKit is a tool-first workspace, so heavy visuals should not slow down the dashboard or interfere with file workflows. If used, the shader should be optional, responsive, and respect `prefers-reduced-motion`.
