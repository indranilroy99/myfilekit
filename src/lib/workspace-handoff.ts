/**
 * Files dropped on the Workspace, handed to the next tool the user opens.
 *
 * Deliberately a module-level variable rather than storage: the File objects
 * live only in this page session, are never serialised, and are cleared the
 * moment a tool consumes them. Nothing about a user's files is persisted.
 */
let pending: File[] = [];

export function stashWorkspaceFiles(files: File[]) {
  pending = files.slice();
}

/** Take (and clear) any files handed over from the Workspace. */
export function takeWorkspaceFiles(): File[] {
  const files = pending;
  pending = [];
  return files;
}

export function hasWorkspaceFiles(): boolean {
  return pending.length > 0;
}
