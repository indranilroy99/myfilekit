export const MB = 1024 * 1024;

export function validateFiles(files, options) {
  const list = Array.from(files || []);
  const maxFiles = options.maxFiles || 1;
  const maxSize = options.maxSize || 25 * MB;
  if (!list.length) throw new Error("Choose a file first.");
  if (list.length > maxFiles) throw new Error(`Choose no more than ${maxFiles} file${maxFiles === 1 ? "" : "s"}.`);

  list.forEach((file) => {
    const extension = file.name.toLowerCase().split(".").pop();
    const mimeAllowed = !options.types || options.types.includes(file.type);
    const extAllowed = !options.extensions || options.extensions.includes(extension);
    if (!mimeAllowed && !extAllowed) throw new Error(`${file.name} is not a supported file type.`);
    if (file.size > maxSize) throw new Error(`${file.name} is larger than the ${Math.round(maxSize / MB)} MB limit.`);
  });
  return list;
}

