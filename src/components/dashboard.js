import { categories, tools } from "../registry/tools.registry.js";
import { el } from "../utils/dom.js";

export function dashboardView() {
  const search = el("input", {
    id: "toolSearch",
    type: "search",
    placeholder: "Search PDF, image, invoice, signature, JSON tools...",
    spellcheck: "false"
  });
  const meta = el("div", { className: "search-meta", "aria-live": "polite" });
  const groups = el("div", { className: "tool-groups" });
  const empty = el("div", { className: "empty-state", hidden: true }, [
    el("h3", { text: "No matching tools" }),
    el("p", { text: "Try a simpler search such as PDF, image, JSON, signature, or invoice." })
  ]);

  function render() {
    const query = search.value.toLowerCase().trim();
    const parts = query.split(/\s+/).filter(Boolean);
    const matches = tools.filter((tool) => parts.every((part) => searchableText(tool).includes(part)));
    groups.replaceChildren();
    empty.hidden = matches.length > 0;
    meta.textContent = query ? `${matches.length} matching tool${matches.length === 1 ? "" : "s"}.` : `${tools.length} local tools across ${categories.length} categories.`;

    const grouped = query ? [["Search results", matches]] : categories.map((category) => [category, matches.filter((tool) => tool.category === category)]).filter(([, items]) => items.length);
    grouped.forEach(([category, items]) => {
      const grid = el("div", { className: "tool-grid" });
      items.forEach((tool) => grid.append(toolCard(tool)));
      groups.append(el("section", { className: "tool-category" }, [el("h3", { text: category }), grid]));
    });
  }

  search.addEventListener("input", render);
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      search.focus();
    }
  });

  const view = el("div", {}, [
    el("section", { className: "hero", "aria-labelledby": "hero-title" }, [
      el("p", { className: "eyebrow", text: "Local-first file toolkit" }),
      el("h1", { id: "hero-title", text: "MyFileKit" }),
      el("p", { className: "hero-subtitle", text: "All your essential file tools, running locally in your browser." }),
      el("p", { className: "privacy-note", text: "No uploads, no accounts, no tracking. Supported files are processed on this device." }),
      el("form", { className: "spotlight", role: "search", "aria-label": "Search tools" }, [
        el("label", { className: "sr-only", for: "toolSearch", text: "Search tools" }),
        el("span", { className: "search-icon", "aria-hidden": "true", text: "⌕" }),
        search,
        el("kbd", { text: "⌘K" })
      ]),
      meta
    ]),
    el("section", { className: "tools-shell", "aria-labelledby": "tools-title" }, [
      el("div", { className: "section-heading" }, [
        el("div", {}, [
          el("h2", { id: "tools-title", text: "Tool Library" }),
          el("p", { text: "Every visible tool is available and designed for end-to-end local processing." })
        ]),
        el("div", { className: "legend" }, [el("span", { className: "badge badge-local", text: "Local processing" })])
      ]),
      groups,
      empty
    ]),
    whySection()
  ]);
  render();
  return view;
}

function toolCard(tool) {
  return el("a", { className: "tool-card", href: tool.route }, [
    el("div", { className: "tool-top" }, [
      el("span", { className: "tool-icon", "aria-hidden": "true", text: tool.name.split(" ").map((word) => word[0]).join("").slice(0, 3).toUpperCase() }),
      el("span", { className: "badge badge-available", text: "Available" })
    ]),
    el("div", {}, [el("h4", { text: tool.name }), el("p", { text: tool.description })]),
    el("div", { className: "tool-badges" }, tool.badges.map((badge) => el("span", { className: badge === "Local" ? "badge badge-local" : "badge", text: badge })))
  ]);
}

function whySection() {
  const features = [
    ["Fast local tools", "Run common PDF, image, text, and document tasks quickly from one dashboard."],
    ["Privacy-first", "Process supported files in your browser without unnecessary uploads."],
    ["Search-first dashboard", "Find the right tool using names, categories, keywords, and use cases."],
    ["Cross-platform", "Run locally on macOS, Windows, and Linux with clear setup scripts."],
    ["Built to grow", "Add tools through one registry without duplicating dashboard code."],
    ["Ready-to-use tools", "Every dashboard card opens a focused workflow with controls and output actions."]
  ];
  return el("section", { className: "highlights", id: "why-myfilekit", "aria-labelledby": "why-title" }, [
    el("div", { className: "section-heading" }, [
      el("div", {}, [el("h2", { id: "why-title", text: "Why MyFileKit" }), el("p", { text: "A practical local-first toolkit built for reliable browser-side workflows." })])
    ]),
    el("div", { className: "feature-grid" }, features.map(([title, description]) => el("article", { className: "feature-card" }, [
      el("span", { className: "feature-icon", "aria-hidden": "true", text: title.split(" ").map((word) => word[0]).join("").slice(0, 4).toUpperCase() }),
      el("div", {}, [el("h3", { text: title }), el("p", { text: description })])
    ])))
  ]);
}

function searchableText(tool) {
  return [tool.name, tool.category, tool.description, ...(tool.keywords || []), ...(tool.badges || [])].join(" ").toLowerCase();
}
