export function csvToJson(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error("CSV needs a header row and at least one data row.");
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).filter((row) => row.some(Boolean)).map((row) => Object.fromEntries(headers.map((header, index) => [header || `column_${index + 1}`, row[index] || ""])));
}

export function jsonToCsv(jsonText) {
  const data = JSON.parse(jsonText);
  if (!Array.isArray(data)) throw new Error("JSON must be an array of objects.");
  const headers = [...new Set(data.flatMap((item) => Object.keys(item || {})))];
  if (!headers.length) throw new Error("JSON array does not contain object fields.");
  return [headers, ...data.map((item) => headers.map((header) => item?.[header] ?? ""))]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
}

function parseCsv(text) {
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

function csvEscape(value) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

