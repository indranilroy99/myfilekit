# React / shadcn Component Integration Notes

This repository does not currently support the attached React shader component directly.

MyFileKit is a vanilla HTML, CSS, and JavaScript app. It intentionally has no React runtime, no Tailwind pipeline, no TypeScript compiler, no shadcn project structure, and no build step. Do not copy React components into the current production app unless the project is deliberately migrated to a React build.

## Current Stack

- Components: `src/components/*.js`
- Tool UI: `src/tools/tool-implementations.js`
- Styles: `assets/css/app.css`
- Entry point: `src/main.js`
- Routing: `src/router.js`

There is no default `/components/ui` folder today because this is not a shadcn app. In a shadcn project, `/components/ui` matters because shadcn components are usually imported from a stable alias such as `@/components/ui/...`. Creating that folder without the rest of the React/Tailwind/TypeScript setup would add dead files and confuse the app structure.

## Required Dependencies For The Provided Component

The attached component uses:

- `react`
- `react-dom`
- `three`
- `@react-three/fiber`
- TypeScript / TSX support

The demo code also references:

- `@paper-design/shaders-react`
- Tailwind utility classes
- `tw-animate-css`

Those packages are not installed in this repository.

## Recommended Setup If MyFileKit Later Moves To React

Create a separate React branch or package first. Do not retrofit this directly into the current vanilla release.

```bash
npm create vite@latest myfilekit-react -- --template react-ts
cd myfilekit-react
npm install
npm install three @react-three/fiber @paper-design/shaders-react
npm install -D tailwindcss tw-animate-css
npx shadcn@latest init
```

When shadcn asks for component locations, keep the standard path:

```text
components/ui
```

Then copy the shader component to:

```text
components/ui/background-paper-shaders.tsx
```

If the project uses a source directory, use:

```text
src/components/ui/background-paper-shaders.tsx
```

and configure aliases consistently so imports resolve from `@/components/ui/...`.

## Tailwind 4 Style Setup

In a React/Tailwind 4 project, extend the app stylesheet, commonly `src/index.css` or `app/globals.css`:

```css
@import "tailwindcss";
@import "tw-animate-css";

@theme inline {
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
  --color-destructive-foreground: var(--destructive-foreground);
}
```

Keep design tokens aligned with the product instead of replacing MyFileKit with a one-off black shader theme.

## Integration Decision For This Repo

The provided shader is visually heavy, depends on React Three Fiber, and would add a full rendering stack to a static local file toolkit. That is not a good fit for the current production app.

If a React version is created later, the best place to use this component would be an optional marketing/demo surface, not the main tools dashboard. The dashboard should remain focused on fast search, visible tools, and local file workflows.

## Questions To Answer Before A Future React Migration

- Will MyFileKit remain a static local-first toolkit, or become a bundled React app?
- Should the shader be used on a landing page, a demo page, or nowhere in the core product?
- What browsers and devices must support the WebGL effect?
- What is the reduced-motion fallback?
- How will the extra dependencies affect load time and hosting simplicity?
