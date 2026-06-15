# Contributing

MyFileKit is built as a small static app. Contributions should keep the project easy to run on macOS, Windows, and Linux.

## Local Setup

```bash
npm run setup
npm run dev
```

Open `http://localhost:4173`.

## Before Submitting Changes

```bash
npm run preflight
```

## Tool Guidelines

- Add tool metadata in `src/registry/tools.registry.js`.
- Add implementation code in `src/tools/tool-implementations.js` or a focused service module.
- Keep each visible tool fully usable: upload/input, controls, action, output/download, reset, and helpful error state.
- Do not add placeholder cards to the dashboard.
- Keep browser-side processing local unless a future architecture explicitly adds a backend.
- Use clear human copy. Avoid hype and unsupported claims.
