'use client';

import { useDebounce } from '@tale/ui/use-debounce';
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';

import { runAdapted } from '@/app/lib/backend/adapters';
import { validateAutomationDraft } from '@/app/lib/backend/automation-validation';
import { backendKey } from '@/app/lib/backend/query-keys';
import type { Automation } from '@/lib/engine/core/types';
import type { ValidationAnswer } from '@/lib/shared/schemas/automation-issues';
import { stableStringify } from '@/lib/shared/utils/stable-stringify';

import { withIssueIds, type AutomationIssue } from '../lib/issues';

/** How long the editor waits after the last edit before it checks a draft. */
export const VALIDATION_DEBOUNCE_MS = 400;

/** The query entity of draft checks. No server hint names it: a check is
 * keyed by the document itself, so a new edit is a new key. */
const VALIDATE_ENTITY = 'automation_validate';

/** Every check of one automation, for invalidating them after a save. */
function automationValidationKey(
  organizationId: string,
  automationSlug: string,
) {
  return backendKey(organizationId, VALIDATE_ENTITY, automationSlug);
}

/** Marks every check of one automation stale: a save can change what the
 * checks of its calls and triggers read. */
export function useInvalidateAutomationValidation(
  organizationId: string,
  automationSlug: string,
): () => void {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({
      queryKey: automationValidationKey(organizationId, automationSlug),
    });
  }, [client, organizationId, automationSlug]);
}

/**
 * cyrb53: a fast 53-bit string hash. It names a document in a query key and
 * says which document a shown result belongs to — not a security boundary.
 */
function cyrb53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The same document hashes the same, whatever order its keys were written in. */
export function documentHash(document: Automation): string {
  return cyrb53(stableStringify(document));
}

export type AutomationValidationStatus =
  | 'idle'
  | 'checking'
  | 'ready'
  | 'failed';

export interface AutomationValidation {
  /**
   * `idle` when nothing is checked (no author, no document); `checking`
   * while the document on screen has no result yet (the pause after an edit,
   * then the request); `ready` when the result shown is the document's own;
   * `failed` when its check did not finish.
   */
  status: AutomationValidationStatus;
  /** The last result's problems — of the document on screen when `ready`,
   * else of the one checked before it. */
  errors: AutomationIssue[];
  warnings: AutomationIssue[];
  /** Hash of the document the shown result belongs to. */
  settledFor: string | null;
  /** Hash of the document on screen. */
  currentHash: string | null;
  /** Why the last check failed, when it did. */
  failure?: unknown;
}

interface Settled {
  hash: string;
  answer: ValidationAnswer;
}

const NO_ISSUES: AutomationIssue[] = [];

/**
 * Checks the automation on screen with the engine's validator on the server
 * (`POST …/:name/validate`), as the author edits it: a draft is checked
 * {@link VALIDATION_DEBOUNCE_MS} after the last edit, a stored version at
 * once. Results are cached by the document's hash, so going back to a
 * document already checked answers at once, and a newer edit cancels the
 * request of an older one.
 *
 * A query, not a mutation: a failed check raises no toast — the Problems
 * panel says it could not check — and Save stays possible, since the
 * server still checks every save.
 */
export function useAutomationValidation({
  organizationId,
  automationSlug,
  document,
  isDraft,
  enabled,
}: {
  organizationId: string;
  automationSlug: string;
  /** The draft, or the stored version on screen. */
  document: Automation | null;
  /** A draft waits for a pause in the edits; a stored version does not. */
  isDraft: boolean;
  /** Only authors may have a document checked (the route is author-gated). */
  enabled: boolean;
}): AutomationValidation {
  const debounced = useDebounce(document, VALIDATION_DEBOUNCE_MS);
  const target = isDraft ? debounced : document;
  const currentHash = useMemo(
    () => (document === null ? null : documentHash(document)),
    [document],
  );
  const targetHash = useMemo(
    () => (target === null ? null : documentHash(target)),
    [target],
  );

  const query = useQuery({
    queryKey: backendKey(
      organizationId,
      VALIDATE_ENTITY,
      automationSlug,
      targetHash,
    ),
    queryFn: ({ signal }) =>
      runAdapted(() =>
        validateAutomationDraft(organizationId, automationSlug, target, {
          signal,
        }),
      ),
    enabled: enabled && target !== null,
    retry: false,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  // The newest result that belongs to its own key, kept across the keys
  // that follow: a check that fails still shows what the one before found.
  const settledRef = useRef<Settled | null>(null);
  if (
    query.data !== undefined &&
    !query.isPlaceholderData &&
    targetHash !== null &&
    (settledRef.current?.hash !== targetHash ||
      settledRef.current.answer !== query.data)
  ) {
    settledRef.current = { hash: targetHash, answer: query.data };
  }
  const settled = enabled ? settledRef.current : null;

  const errors = useMemo(
    () => (settled === null ? NO_ISSUES : withIssueIds(settled.answer.errors)),
    [settled],
  );
  const warnings = useMemo(
    () =>
      settled === null ? NO_ISSUES : withIssueIds(settled.answer.warnings),
    [settled],
  );

  let status: AutomationValidationStatus;
  if (!enabled || currentHash === null) status = 'idle';
  else if (settled?.hash === currentHash) status = 'ready';
  else if (targetHash === currentHash && query.isError && !query.isFetching) {
    status = 'failed';
  } else status = 'checking';

  return {
    status,
    errors,
    warnings,
    settledFor: settled?.hash ?? null,
    currentHash,
    ...(status === 'failed' && { failure: query.error }),
  };
}
