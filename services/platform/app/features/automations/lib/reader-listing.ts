/**
 * Which automations a viewer is shown. Only Owners, Admins and Developers
 * build automations (the server's author gate, which the client reads as the
 * `developerSettings` ability); everyone else sees what the organization
 * runs — deployed automations — and not the drafts and undeployed packages
 * they could neither edit nor start.
 *
 * A presentation rule, not access control: the routes and the listing stay
 * reachable. Every surface that decides whether automations are there to
 * show — the rail tile, the lists, a project's tab — applies this one rule,
 * so none of them offers a way in that opens onto an empty list.
 */

interface ListedAutomation {
  deployedVersion?: number;
}

/** Whether the automation has a deployed version running. */
export function isLiveAutomation(automation: ListedAutomation): boolean {
  return automation.deployedVersion !== undefined;
}

/** Whether a viewer who can (or cannot) author sees this automation. */
export function isListedForViewer(
  automation: ListedAutomation,
  canAuthor: boolean,
): boolean {
  return canAuthor || isLiveAutomation(automation);
}
