import { tools } from "./registry/tools.registry.js";
import { dashboardView } from "./components/dashboard.js";
import { notFoundView, toolPage } from "./components/tool-page.js";
import { renderTool } from "./tools/tool-implementations.js";

export function routeForHash(hash) {
  const id = String(hash || "#dashboard").replace(/^#/, "") || "dashboard";
  if (id === "dashboard") return { type: "dashboard" };
  const tool = tools.find((item) => item.id === id);
  return tool ? { type: "tool", tool } : { type: "missing", hash };
}

export function renderRoute(outlet) {
  const route = routeForHash(window.location.hash);
  if (route.type === "dashboard") {
    outlet.replaceChildren(dashboardView());
  } else if (route.type === "tool") {
    outlet.replaceChildren(toolPage(route.tool, renderTool(route.tool)));
  } else {
    outlet.replaceChildren(notFoundView(route.hash));
  }
  window.scrollTo({ top: 0 });
}

export function startRouter(outlet) {
  window.addEventListener("hashchange", () => renderRoute(outlet));
  renderRoute(outlet);
}
