/**
 * Files handed from the Workspace to ONE tool the user explicitly chose.
 *
 * Scoped to an intent on purpose. An earlier version stashed the files as soon
 * as they were dropped and let the next FileControl to mount adopt them, which
 * meant a staged file could silently load into a tool the user never picked —
 * including P2P File Share, whose whole job is sending the file off the device.
 * Nothing is staged until the user clicks a specific tool, and only that tool
 * can take it.
 *
 * In memory only: the File objects live in this page session, are never
 * serialised or persisted, and are dropped on reload or on any navigation that
 * is not the chosen tool.
 */
type Handoff = { files: File[]; toolId: string };

let pending: Handoff | null = null;

/** Stage files for one specific tool, chosen by the user. */
export function stashWorkspaceFiles(files: File[], toolId: string) {
  if (!files.length || !toolId) return;
  pending = { files: files.slice(), toolId };
}

/**
 * Take the staged files if they were staged for `toolId`. Returns [] otherwise
 * and — importantly — leaves the stash intact, so opening some other tool on the
 * way does not destroy a hand-off the user is still heading towards.
 */
export function takeWorkspaceFilesFor(toolId: string): File[] {
  if (!pending || pending.toolId !== toolId) return [];
  const files = pending.files;
  pending = null;
  return files;
}

/** Drop the stash unless the user is navigating to the tool it was staged for. */
export function clearWorkspaceFilesUnless(toolId: string) {
  if (pending && pending.toolId !== toolId) pending = null;
}

export function pendingWorkspaceToolId(): string | null {
  return pending ? pending.toolId : null;
}
