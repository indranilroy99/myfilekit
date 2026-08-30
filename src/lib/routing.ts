import {
  categoryRoute as categoryRouteImpl,
  categorySlug as categorySlugImpl,
  routeForHash as routeForHashImpl
} from "../router.js";

export type Route =
  | { type: "home" }
  | { type: "editor" }
  | { type: "dashboard" }
  | { type: "browse"; ext?: string }
  | { type: "category"; category: string }
  | { type: "tool"; tool: any }
  | { type: "missing"; hash: string };

export function categorySlug(category: string): string {
  return categorySlugImpl(category);
}

export function categoryRoute(category: string): string {
  return categoryRouteImpl(category);
}

export function routeForHash(hash: string): Route {
  return routeForHashImpl(hash) as Route;
}

/**
 * Tools whose input is a place on the page, so the page itself becomes the
 * control: drag an area to redact, click a point to place text.
 *
 * Shared because BOTH the per-tool route and the editor need it. It lived in
 * App.tsx and only the per-tool route read it, which is why the editor — the
 * flagship surface — could not draw a redaction box while the plain tool page
 * could.
 */
export const SELECT_MODE_BY_TOOL: Record<string, "rect" | "point"> = {
  "redact-pdf-tool": "rect",
  "add-text-to-pdf-tool": "point",
  // Drag a box where the signature goes: position AND size in one gesture.
  "add-signature-to-pdf-tool": "rect",
};

/**
 * Tools that render their own interactive page.
 *
 * Each of these already builds a real page surface — clickable text runs, a
 * pointer-driven annotation canvas, an editable text column — and in the editor
 * they were mounted inside the 360px options column while an inert copy of the
 * same page filled the canvas beside them. They take the canvas instead, and
 * the read-only preview is not mounted at all.
 */
export const PAGE_SURFACE_TOOLS = new Set([
  "edit-pdf-text-tool",
  "annotate-pdf-tool",
  "reflow-pdf-tool",
]);
