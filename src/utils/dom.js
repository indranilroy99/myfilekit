export function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attributes).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  });
  children.forEach((child) => node.append(child));
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function field(labelText, control, helpText = "") {
  const id = control.id || `field-${crypto.randomUUID()}`;
  control.id = id;
  const children = [el("label", { for: id, text: labelText }), control];
  if (helpText) children.push(el("small", { className: "field-help", text: helpText }));
  return el("div", { className: "field" }, children);
}

export function statusMessage(id) {
  return el("p", { id, className: "result", "aria-live": "polite", text: "Ready." });
}

export function fileInput(id, accept, multiple = false) {
  return el("input", { id, type: "file", accept, multiple });
}

export function textArea(id, placeholder = "", rows = 8) {
  return el("textarea", { id, placeholder, rows });
}

export function textInput(id, placeholder = "", value = "") {
  return el("input", { id, type: "text", placeholder, value });
}

export function numberInput(id, value, min = 0) {
  return el("input", { id, type: "number", value, min });
}

export function selectInput(id, options) {
  const select = el("select", { id });
  options.forEach(([value, label]) => select.append(el("option", { value, text: label })));
  return select;
}

export function actionRow(...children) {
  return el("div", { className: "action-row" }, children);
}

export function button(text, options = {}) {
  return el("button", { type: "button", className: options.primary ? "button button-primary" : "button", text, ...options.attributes });
}

