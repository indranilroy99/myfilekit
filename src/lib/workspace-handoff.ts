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
  // A file control only seeds itself on mount, which is enough when the hand-off
  // precedes navigation. It is NOT enough in the editor, where the document can
  // be replaced by a tool's own output while that same tool stays mounted —
  // there the control kept the file the user opened and every further edit was
  // applied to the original, silently discarding the previous one. The ownership
  // check in takeWorkspaceFilesFor still decides who may take it.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("myfilekit:workspace-file", { detail: { toolId } }));
  }
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

/**
 * Which tool is being rendered right now.
 *
 * A file control cannot work this out from the URL: on a tool route the route
 * IS the tool, but inside the editor the route is the editor and the tool is
 * whichever one the rail has selected. Whoever renders a tool declares it here,
 * so the control only ever adopts files staged for the tool it belongs to.
 */
let activeToolId = "";

export function setActiveTool(toolId: string) {
  activeToolId = toolId || "";
}

/** Take files staged for the tool currently being rendered. */
export function takeWorkspaceFilesForActive(): File[] {
  return activeToolId ? takeWorkspaceFilesFor(activeToolId) : [];
}
