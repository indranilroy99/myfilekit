import {
  categoryRoute as categoryRouteImpl,
  categorySlug as categorySlugImpl,
  routeForHash as routeForHashImpl
} from "../router.js";

export type Route =
  | { type: "dashboard" }
  | { type: "browse" }
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
