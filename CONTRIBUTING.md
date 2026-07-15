# Contributing

MyFileKit is a Vite, React, TypeScript, and Tailwind app. Contributions should keep the project easy to run on macOS, Windows, and Linux.

## Local Setup

```bash
npm install
npm run setup
npm run dev
```

Open the local URL printed by Vite.

## Before Submitting Changes

```bash
npm run preflight
```

## Versioning

Use the built-in scripts:

```bash
npm run version:patch
npm run version:minor
npm run version:major
```

Use patch bumps for normal additions and fixes. Use major bumps only for a major product direction or architecture change.

## Tool Guidelines

- Add tool metadata in `src/registry/tools.registry.js`.
- Add reusable file-processing logic in `src/services/`.
- Add React UI in `src/App.tsx` or focused React components.
- Keep each visible tool fully usable: upload/input, controls, action, output/download, reset, and helpful error state.
- Do not add unfinished cards to the dashboard.
- Keep browser-side processing local unless a future architecture explicitly adds a backend.
- Use clear human copy. Avoid hype and unsupported claims.
