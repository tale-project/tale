/**
 * Which dashboard routes belong to Home — the one section that holds chats,
 * projects with their tasks, and the inbox. The shell mounts the Home panel
 * beside every one of them, so moving between a chat, a task, a project and
 * a customer conversation never swaps the navigation out from under you, and
 * the rail lights Home on every one of them.
 */

const HOME_SEGMENTS = [
  'home',
  'chat',
  'projects',
  'tasks',
  'conversations',
] as const;

/** The org-relative remainder of a dashboard pathname, or null outside it. */
function orgRelative(pathname: string, organizationId: string): string | null {
  const prefix = `/dashboard/${organizationId}`;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;
  return pathname.slice(prefix.length);
}

/**
 * Whether the page is one automation's own page inside a project — its tabs
 * and runs (`/projects/<id>/automations/<slug>/…`). It wears the Automations
 * chrome, so it belongs to the Automations section: the rail lights
 * Automations, and no Home panel stands beside its canvas, exactly like an
 * automation outside a project. The project's Automations tab
 * (`/projects/<id>/automations`, the bound list) stays Home's.
 */
export function isProjectAutomationPage(
  pathname: string,
  organizationId: string,
): boolean {
  const rest = orgRelative(pathname, organizationId);
  return (
    rest !== null && /^\/projects\/[^/]+\/automations\/[^/]+(?:\/|$)/.test(rest)
  );
}

export function isHomePath(pathname: string, organizationId: string): boolean {
  const rest = orgRelative(pathname, organizationId);
  if (rest === null) return false;
  // A shared-chat snapshot is a standalone reading page with its own close
  // button; it keeps the full width.
  if (rest.startsWith('/chat/shared/')) return false;
  if (isProjectAutomationPage(pathname, organizationId)) return false;
  return HOME_SEGMENTS.some(
    (segment) => rest === `/${segment}` || rest.startsWith(`/${segment}/`),
  );
}

/** What the open page is, as far as the Home panel's highlight cares. */
export type HomeLocation =
  | { kind: 'chat'; threadId?: string }
  | { kind: 'task'; taskId: string }
  | { kind: 'conversation'; status: string; conversationId?: string }
  | { kind: 'project'; projectId?: string }
  | { kind: 'other' };

export function readHomeLocation(
  pathname: string,
  search: Record<string, unknown>,
  organizationId: string,
): HomeLocation {
  const rest = orgRelative(pathname, organizationId);
  if (rest === null) return { kind: 'other' };
  const parts = rest.split('/').filter((part) => part.length > 0);
  const [segment, first] = parts;
  switch (segment) {
    case 'chat':
      return first !== undefined && first !== 'shared'
        ? { kind: 'chat', threadId: first }
        : { kind: 'chat' };
    case 'tasks':
      return first !== undefined
        ? { kind: 'task', taskId: first }
        : { kind: 'other' };
    case 'conversations': {
      const conversationId =
        typeof search.conversation === 'string'
          ? search.conversation
          : undefined;
      return {
        kind: 'conversation',
        status: first ?? 'open',
        ...(conversationId !== undefined ? { conversationId } : {}),
      };
    }
    case 'projects':
      return first !== undefined
        ? { kind: 'project', projectId: first }
        : { kind: 'project' };
    default:
      return { kind: 'other' };
  }
}

/**
 * Whether this page brings its own phone header — a chat, a task, an open
 * conversation: back arrow, title, actions — so the shell's bar would only
 * stack an empty row above it. The boot script in index.html mirrors this
 * rule (`boot-thread-page`).
 */
export function hasOwnPhoneHeader(location: HomeLocation): boolean {
  return (
    location.kind === 'chat' ||
    location.kind === 'task' ||
    (location.kind === 'conversation' && location.conversationId !== undefined)
  );
}

/**
 * Whether the Home panel may be folded away on this page: only where the
 * page's header carries the toggle to bring it back — the conversation-shaped
 * pages and a project's own page. The projects list and the inbox index have
 * no toggle, so the panel stays there. The boot script in index.html mirrors
 * this rule.
 */
export function isPanelCollapsible(location: HomeLocation): boolean {
  return (
    hasOwnPhoneHeader(location) ||
    (location.kind === 'project' && location.projectId !== undefined)
  );
}
