export function csvToJson(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error("CSV needs a header row and at least one data row.");
  const seen = new Map();
  const used = new Set();
  const headers = rows[0].map((header, index) => {
    const base = header.trim() || `column_${index + 1}`;
    let count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    let name = count > 1 ? `${base}_${count}` : base;
    while (used.has(name)) {
      count += 1;
      seen.set(base, count);
      name = `${base}_${count}`;
    }
    used.add(name);
    return name;
  });
  // A row with MORE cells than the header used to lose the extras silently: a
  // header of `a,b` and a row `1,2,3,4` returned {a:"1",b:"2"} and reported
  // "CSV converted." Columns 3 and 4 were simply gone. Extra cells now get
  // synthesised names so nothing is dropped, and the caller is told.
  const extras = [];
  const out = rows.slice(1).filter((row) => row.some(Boolean)).map((row, rowIndex) => {
    const entry = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
    for (let index = headers.length; index < row.length; index += 1) {
      const value = row[index];
      if (String(value ?? "").trim() === "") continue;
      const name = `column_${index + 1}`;
      entry[name] = value;
      if (!extras.includes(name)) extras.push(name);
      void rowIndex;
    }
    return entry;
  });
  // Non-enumerable so JSON.stringify(out) is unchanged for every caller.
  Object.defineProperty(out, "extraColumns", { value: extras, enumerable: false });
  return out;
}

export function jsonToCsv(jsonText) {
  const data = JSON.parse(jsonText);
  if (!Array.isArray(data)) throw new Error("JSON must be an array of objects.");
  if (data.some((item) => item === null || typeof item !== "object" || Array.isArray(item))) {
    throw new Error("JSON to CSV expects an array of objects.");
  }
  const headers = [...new Set(data.flatMap((item) => Object.keys(item || {})))];
  if (!headers.length) throw new Error("JSON array does not contain object fields.");
  return [headers, ...data.map((item) => headers.map((header) => formatCell(item?.[header])))]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(value);
      value = "";
    } else if (!quoted && /\r|\n/.test(char)) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  row.push(value);
  rows.push(row);
  return rows;
}

function formatCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function csvEscape(value) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

