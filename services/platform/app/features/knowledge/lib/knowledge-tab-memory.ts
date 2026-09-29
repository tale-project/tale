import { KNOWLEDGE_PAGES } from '../components/knowledge-navigation';

/**
 * Which of Knowledge's 5 tabs the rail should reopen. Read by
 * `useNavigationItems`, written by `_knowledge.tsx` as the tab changes — so
 * the Knowledge rail tile lands back on the last tab visited instead of
 * always Documents.
 */

function storageKey(organizationId: string): string {
  return `tale.platform.knowledge.${organizationId}.lastTab`;
}

const KNOWLEDGE_TAB_PATHS: ReadonlySet<string> = new Set(
  KNOWLEDGE_PAGES.map((page) => page.path),
);

export function readKnowledgeTabMemory(
  organizationId: string,
): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(storageKey(organizationId));
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'string' && KNOWLEDGE_TAB_PATHS.has(parsed)
      ? parsed
      : undefined;
  } catch (error) {
    console.warn('[knowledge] failed to read remembered tab', error);
    return undefined;
  }
}

export function persistKnowledgeTabMemory(
  organizationId: string,
  path: string,
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      storageKey(organizationId),
      JSON.stringify(path),
    );
  } catch (error) {
    console.warn('[knowledge] failed to persist remembered tab', error);
  }
}
