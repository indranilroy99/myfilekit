import { el } from "../utils/dom.js";

export function appShell(content) {
  return el("div", {}, [
    el("header", { className: "site-header" }, [
      el("a", { className: "brand", href: "#dashboard", "aria-label": "MyFileKit dashboard" }, [
        el("img", { src: "assets/myfilekit-logo.svg", alt: "", width: "44", height: "44" }),
        el("span", { text: "MyFileKit" })
      ]),
      el("nav", { className: "top-nav", "aria-label": "Primary navigation" }, [
        el("a", { href: "#dashboard", text: "Dashboard" }),
        el("a", { href: "#merge-pdf-tool", text: "PDF tools" }),
        el("a", { href: "#compress-image-tool", text: "Image tools" }),
        el("a", { href: "invoice-generator/index.html", text: "Invoice Generator" })
      ])
    ]),
    el("main", {}, [content])
  ]);
}

