import { tools } from "../registry/tools.registry.js";

export type Route =
  | { type: "dashboard" }
  | { type: "browse" }
  | { type: "category"; category: string }
  | { type: "tool"; tool: any }
  | { type: "missing"; hash: string };

export function categorySlug(category: string) {
  return category.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function categoryRoute(category: string) {
  return `#category-${categorySlug(category)}`;
}

export function routeForHash(hash: string): Route {
  const id = String(hash || "#dashboard").replace(/^#/, "") || "dashboard";
  if (id === "dashboard") return { type: "dashboard" };
  if (id === "browse-tools") return { type: "browse" };
  if (id.startsWith("category-")) {
    const category = [...new Set(tools.map((tool: any) => tool.category))].find((item) => categorySlug(item) === id.replace("category-", ""));
    return category ? { type: "category", category } : { type: "missing", hash };
  }
  const tool = tools.find((item: any) => item.id === id || item.route === `#${id}`);
  return tool ? { type: "tool", tool } : { type: "missing", hash };
}
