// Minimal class-name combiner (dependency-free). Filters falsy values and joins
// with a space — enough for our components, which don't pass conflicting utility
// classes that would need tailwind-merge de-duplication.
export function cn(...inputs: Array<string | false | null | undefined>): string {
  return inputs.filter(Boolean).join(" ");
}
