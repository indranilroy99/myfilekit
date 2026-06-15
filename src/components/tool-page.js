import { el } from "../utils/dom.js";

export function toolPage(tool, content) {
  return el("section", { className: "tool-route", "aria-labelledby": `${tool.id}-title` }, [
    el("a", { className: "back-link", href: "#dashboard", text: "Back to dashboard" }),
    el("div", { className: "tool-route-head" }, [
      el("div", {}, [
        el("p", { className: "eyebrow", text: tool.category }),
        el("h1", { id: `${tool.id}-title`, text: tool.name }),
        el("p", { className: "hero-subtitle", text: tool.description }),
        el("p", { className: "privacy-note", text: "Local processing: files stay in this browser session and are not uploaded." })
      ])
    ]),
    el("div", { className: "tool-workbench" }, [content])
  ]);
}

export function notFoundView(hash) {
  return el("section", { className: "tool-route" }, [
    el("a", { className: "back-link", href: "#dashboard", text: "Back to dashboard" }),
    el("div", { className: "empty-state" }, [
      el("h1", { text: "Tool not found" }),
      el("p", { text: `${hash || "This route"} does not match an available MyFileKit tool.` })
    ])
  ]);
}

