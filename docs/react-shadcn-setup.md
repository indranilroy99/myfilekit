# React, shadcn/ui, Tailwind, and TypeScript Setup

MyFileKit is currently a vanilla HTML/CSS/JavaScript project. It does not have a React runtime, TypeScript compiler, Tailwind build pipeline, or shadcn/ui structure.

The shader component in `examples/react-shadcn/` is therefore not wired into the production dashboard yet. It is kept as an integration reference for a future React migration or for a separate React package.

## Why the component is not mounted in the current app

The component requires:

- React
- TypeScript
- Tailwind CSS
- `three`
- `@react-three/fiber`
- `@paper-design/shaders-react` for the demo
- a React build tool such as Vite or Next.js

The current MyFileKit app intentionally stays static and dependency-light. Adding those dependencies to the root just for a decorative shader would make the app heavier and would conflict with the current maintainer direction.

## Recommended setup if MyFileKit moves to React

Create a React + TypeScript app with Vite:

```bash
npm create vite@latest myfilekit-react -- --template react-ts
cd myfilekit-react
npm install
```

Install Tailwind CSS and shadcn/ui:

```bash
npm install tailwindcss @tailwindcss/vite
npx shadcn@latest init
```

Install the shader dependencies:

```bash
npm install three @react-three/fiber @paper-design/shaders-react
npm install -D @types/three
```

For shadcn/ui, keep reusable components in:

```text
components/ui
```

That path matters because shadcn defaults to it, generated components expect it, and it keeps reusable UI separate from app-specific pages.

## Files provided

```text
examples/react-shadcn/
├── components/
│   └── ui/
│       └── background-paper-shaders.tsx
└── demo.tsx
```

When using a real React app, copy:

```text
examples/react-shadcn/components/ui/background-paper-shaders.tsx
```

to:

```text
components/ui/background-paper-shaders.tsx
```

Then place `demo.tsx` inside the relevant route or page for that React framework.

## Tailwind 4 token example

Use this only in a Tailwind 4 React project. It is not valid for the current static CSS setup.

```css
@import "tailwindcss";

@theme inline {
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-border: var(--border);
  --color-ring: var(--ring);
}
```

## Maintainer note

Do not add shader backgrounds to the main dashboard unless they improve the product experience. MyFileKit should remain fast, readable, and utility-focused.

