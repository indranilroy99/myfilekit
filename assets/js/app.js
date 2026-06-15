(function () {
  const categoryOrder = [
    "PDF Tools",
    "Image Tools",
    "Business Tools",
    "Signature Tools",
    "Document Tools",
    "Security Tools",
    "AI Tools"
  ];

  const featureHighlights = [
    {
      icon: "FAST",
      title: "Fast local tools",
      description: "Run common PDF, image, and document tasks quickly from one dashboard."
    },
    {
      icon: "SAFE",
      title: "Privacy-first",
      description: "Process files in your browser wherever possible, without unnecessary uploads."
    },
    {
      icon: "HUB",
      title: "All-in-one workspace",
      description: "Access PDF, image, business, signature, document, security, and AI tools from one place."
    },
    {
      icon: "FIND",
      title: "Search-first dashboard",
      description: "Find the right tool quickly using a Spotlight-style search experience."
    },
    {
      icon: "OS",
      title: "Cross-platform",
      description: "Run the project on macOS, Windows, and Linux with clear setup instructions."
    },
    {
      icon: "GROW",
      title: "Built to grow",
      description: "Add new tools through a central registry without duplicating dashboard code."
    }
  ];

  const tools = Array.isArray(window.MyFileKitTools) ? window.MyFileKitTools : [];
  const searchInput = document.getElementById("toolSearch");
  const searchMeta = document.getElementById("searchMeta");
  const toolGroups = document.getElementById("toolGroups");
  const featureGrid = document.getElementById("featureHighlights");
  const emptyState = document.getElementById("emptyState");
  const modal = document.getElementById("comingSoonModal");
  const modalTitle = document.getElementById("modalTitle");
  const modalDescription = document.getElementById("modalDescription");

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalize(value) {
    return String(value || "").toLowerCase().trim();
  }

  function searchableText(tool) {
    return normalize([
      tool.name,
      tool.category,
      tool.description,
      tool.status,
      ...(tool.keywords || []),
      ...(tool.badges || [])
    ].join(" "));
  }

  function toolMatches(tool, query) {
    if (!query) return true;
    return query.split(/\s+/).every((part) => searchableText(tool).includes(part));
  }

  function badgeClass(label) {
    if (label === "Available") return "badge badge-available";
    if (label === "Local processing") return "badge badge-local";
    return "badge";
  }

  function createToolCard(tool) {
    const element = document.createElement(tool.status === "available" ? "a" : "button");
    element.className = "tool-card";
    if (tool.status === "available") {
      element.href = tool.route;
    } else {
      element.type = "button";
      element.dataset.comingSoon = tool.id;
    }
    element.innerHTML = `
      <div class="tool-top">
        <span class="tool-icon" aria-hidden="true">${escapeHtml(tool.icon)}</span>
        <span class="${tool.status === "available" ? "badge badge-available" : "badge"}">${tool.status === "available" ? "Available" : "Coming soon"}</span>
      </div>
      <div>
        <h4>${escapeHtml(tool.name)}</h4>
        <p>${escapeHtml(tool.description)}</p>
      </div>
      <div class="tool-badges">
        ${(tool.badges || []).filter((badge) => badge !== "Available" && badge !== "Coming soon").map((badge) => `<span class="${badgeClass(badge)}">${escapeHtml(badge)}</span>`).join("")}
      </div>
    `;
    return element;
  }

  function groupTools(items) {
    return categoryOrder
      .map((category) => [category, items.filter((tool) => tool.category === category)])
      .filter(([, categoryTools]) => categoryTools.length);
  }

  function renderTools() {
    const query = normalize(searchInput.value);
    const matches = tools.filter((tool) => toolMatches(tool, query));
    toolGroups.innerHTML = "";
    emptyState.hidden = matches.length > 0;

    if (!matches.length) {
      searchMeta.textContent = query ? `No tools found for “${query}”.` : "";
      return;
    }

    searchMeta.textContent = query
      ? `${matches.length} matching tool${matches.length === 1 ? "" : "s"} for “${query}”.`
      : `${tools.length} tools across ${categoryOrder.length} categories.`;

    const grouped = query
      ? [["Search results", matches.sort((a, b) => Number(b.status === "available") - Number(a.status === "available"))]]
      : groupTools(matches);

    grouped.forEach(([category, categoryTools]) => {
      const section = document.createElement("section");
      section.className = "tool-category";
      section.innerHTML = `<h3>${escapeHtml(category)}</h3><div class="tool-grid"></div>`;
      const grid = section.querySelector(".tool-grid");
      categoryTools.forEach((tool) => grid.appendChild(createToolCard(tool)));
      toolGroups.appendChild(section);
    });
  }

  function renderFeatureHighlights() {
    featureGrid.innerHTML = "";
    featureHighlights.forEach((feature) => {
      const card = document.createElement("article");
      card.className = "feature-card";
      card.innerHTML = `
        <span class="feature-icon" aria-hidden="true">${escapeHtml(feature.icon)}</span>
        <div>
          <h3>${escapeHtml(feature.title)}</h3>
          <p>${escapeHtml(feature.description)}</p>
        </div>
      `;
      featureGrid.appendChild(card);
    });
  }

  function restoreInitialHashScroll() {
    if (!window.location.hash) return;
    const target = document.getElementById(window.location.hash.slice(1));
    if (!target) return;
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ block: "start" });
    });
  }

  function openComingSoon(toolId) {
    const tool = tools.find((item) => item.id === toolId);
    if (!tool) return;
    modalTitle.textContent = tool.name;
    modalDescription.textContent = `${tool.name} is planned for MyFileKit. It will be enabled only after the workflow is implemented, tested, and safe to use.`;
    modal.hidden = false;
    modal.querySelector(".modal-close").focus();
  }

  function closeModal() {
    modal.hidden = true;
    searchInput.focus();
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, index)).toFixed(index ? 2 : 0)} ${units[index]}`;
  }

  function safeName(name, suffix, extension) {
    const base = String(name || "file")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9._-]+/gi, "-")
      .slice(0, 80) || "file";
    return `${base}-${suffix}.${extension}`;
  }

  function downloadBytes(bytes, filename, mimeType) {
    const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  async function compressImage() {
    const file = document.getElementById("imageInput").files[0];
    const result = document.getElementById("imageResult");
    const format = document.getElementById("imageFormat").value;
    const quality = Number(document.getElementById("imageQuality").value);
    if (!file) {
      result.textContent = "Choose an image first.";
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, format, quality));
      if (!blob) throw new Error("This browser could not export that image format.");
      const extension = format === "image/png" ? "png" : format === "image/webp" ? "webp" : "jpg";
      downloadBytes(blob, safeName(file.name, "compressed", extension), format);
      const saved = Math.max(0, file.size - blob.size);
      const percent = file.size ? Math.round((saved / file.size) * 100) : 0;
      result.textContent = `Original: ${formatBytes(file.size)}\nOutput: ${formatBytes(blob.size)}\nSaved: ${formatBytes(saved)} (${percent}%)`;
    } catch (error) {
      result.textContent = error.message || "Could not compress that image.";
    }
  }

  async function ensurePdfLib() {
    if (!window.PDFLib) throw new Error("PDF engine is still loading. Try again in a moment.");
    return window.PDFLib;
  }

  async function mergePdf() {
    const files = Array.from(document.getElementById("mergeInput").files || []);
    const result = document.getElementById("mergeResult");
    if (files.length < 2) {
      result.textContent = "Choose at least two PDF files.";
      return;
    }
    try {
      const { PDFDocument } = await ensurePdfLib();
      const merged = await PDFDocument.create();
      for (const file of files) {
        const source = await PDFDocument.load(await file.arrayBuffer());
        const pages = await merged.copyPages(source, source.getPageIndices());
        pages.forEach((page) => merged.addPage(page));
      }
      const bytes = await merged.save();
      downloadBytes(bytes, "myfilekit-merged.pdf", "application/pdf");
      result.textContent = `Merged ${files.length} PDFs into ${formatBytes(bytes.length)}.`;
    } catch (error) {
      result.textContent = error.message || "Could not merge those PDFs.";
    }
  }

  async function splitPdf() {
    const file = document.getElementById("splitInput").files[0];
    const result = document.getElementById("splitResult");
    const downloads = document.getElementById("splitDownloads");
    downloads.innerHTML = "";
    if (!file) {
      result.textContent = "Choose one PDF file.";
      return;
    }
    try {
      const { PDFDocument } = await ensurePdfLib();
      const source = await PDFDocument.load(await file.arrayBuffer());
      const pageCount = source.getPageCount();
      for (let index = 0; index < pageCount; index += 1) {
        const output = await PDFDocument.create();
        const [page] = await output.copyPages(source, [index]);
        output.addPage(page);
        const bytes = await output.save();
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = safeName(file.name, `page-${index + 1}`, "pdf");
        link.textContent = `Download page ${index + 1}`;
        downloads.appendChild(link);
      }
      result.textContent = `Split ${pageCount} page${pageCount === 1 ? "" : "s"}.`;
    } catch (error) {
      result.textContent = error.message || "Could not split that PDF.";
    }
  }

  document.addEventListener("click", (event) => {
    const comingSoonButton = event.target.closest("[data-coming-soon]");
    if (comingSoonButton) openComingSoon(comingSoonButton.dataset.comingSoon);
    if (event.target.closest("[data-close-modal]")) closeModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== searchInput && !/input|select|textarea/i.test(document.activeElement.tagName)) {
      event.preventDefault();
      searchInput.focus();
    }
    if (event.key === "Escape" && !modal.hidden) closeModal();
  });

  searchInput.addEventListener("input", renderTools);
  document.getElementById("compressImageButton").addEventListener("click", compressImage);
  document.getElementById("mergePdfButton").addEventListener("click", mergePdf);
  document.getElementById("splitPdfButton").addEventListener("click", splitPdf);
  renderTools();
  renderFeatureHighlights();
  restoreInitialHashScroll();
})();
