import { tools } from "./registry/tools.registry.js";

export function categorySlug(category) {
  return category.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function categoryRoute(category) {
  return `#category-${categorySlug(category)}`;
}

export function routeForHash(hash) {
  const id = String(hash || "#dashboard").replace(/^#/, "") || "dashboard";
  if (id === "dashboard") return { type: "dashboard" };
  if (id === "browse-tools") return { type: "browse" };
  if (id.startsWith("category-")) {
    const category = [...new Set(tools.map((tool) => tool.category))].find((item) => categorySlug(item) === id.replace("category-", ""));
    return category ? { type: "category", category } : { type: "missing", hash };
  }
  const tool = tools.find((item) => item.id === id || item.route === `#${id}`);
  return tool ? { type: "tool", tool } : { type: "missing", hash };
}
