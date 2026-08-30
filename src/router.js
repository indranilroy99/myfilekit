import { tools } from "./registry/tools.registry.js";

export function categorySlug(category) {
  return category.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function categoryRoute(category) {
  return `#category-${categorySlug(category)}`;
}

export function routeForHash(hash) {
  const raw = String(hash || "#home").replace(/^#/, "") || "home";
  // Optional query on the hash, currently only `browse-tools?ext=pdf`.
  const queryAt = raw.indexOf("?");
  const id = queryAt === -1 ? raw : raw.slice(0, queryAt);
  const query = queryAt === -1 ? "" : raw.slice(queryAt + 1);
  if (id === "home") return { type: "home" };
  if (id === "dashboard") return { type: "dashboard" };
  if (id === "browse-tools") {
    const match = /(?:^|&)ext=([a-z0-9]{1,12})(?:&|$)/i.exec(query);
    return match ? { type: "browse", ext: match[1].toLowerCase() } : { type: "browse" };
  }
  if (id.startsWith("category-")) {
    const category = [...new Set(tools.map((tool) => tool.category))].find((item) => categorySlug(item) === id.replace("category-", ""));
    return category ? { type: "category", category } : { type: "missing", hash };
  }
  const tool = tools.find((item) => item.id === id || item.route === `#${id}`);
  return tool ? { type: "tool", tool } : { type: "missing", hash };
}
