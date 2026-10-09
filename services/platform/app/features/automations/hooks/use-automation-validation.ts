'use client';

import { cyrb53 } from '@tale/ui/data/hash';
import { useDebounce } from '@tale/ui/use-debounce';
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';

import { runAdapted } from '@/app/lib/backend/adapters';
import {
  validateAutomationDraft,
  type DraftCheck,
  type ValidationDetail,
} from '@/app/lib/backend/automation-validation';
import { backendKey } from '@/app/lib/backend/query-keys';
import type {
  AnalysisView,
  TypesView,
} from '@/lib/shared/schemas/automation-issues';
import { stableStringify } from '@/lib/shared/utils/stable-stringify';

import type { RawDocument } from '../lib/draft-document';
import { withIssueIds, type AutomationIssue } from '../lib/issues';

/** How long the editor waits after the last edit before it checks a draft. */
export const VALIDATION_DEBOUNCE_MS = 400;

/**
 * How long one check may take before the editor stops waiting for it. A
 * check that hangs (a loaded server, a proxy that holds the connection)
 * then counts as failed, and a failed check holds nothing back: Save waits
 * only on a check that can still answer.
 */
export const VALIDATION_TIMEOUT_MS = 15_000;

/** The check did not answer within {@link VALIDATION_TIMEOUT_MS}. */
export class ValidationTimeoutError extends Error {
  constructor() {
    super('the check did not answer in time');
    this.name = 'ValidationTimeoutError';
  }
}

/** Runs `check` with a signal that also aborts after `ms`, and rejects then
 * even if the request ignores its signal. */
async function withinTime<T>(
  signal: AbortSignal,
  ms: number,
  check: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const bounded = new AbortController();
  const forward = () => bounded.abort(signal.reason);
  if (signal.aborted) forward();
  else signal.addEventListener('abort', forward, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new ValidationTimeoutError();
      bounded.abort(error);
      reject(error);
    }, ms);
  });
  try {
    return await Promise.race([check(bounded.signal), late]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', forward);
  }
}

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

/** The same document hashes the same, whatever order its keys were written
 * in. It names a document in a query key and says which document a shown
 * result belongs to. */
export function documentHash(document: RawDocument): string {
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
  /** The document the shown result belongs to: the text an issue's range
   * indexes into, while the one on screen may have moved on. */
  settledDocument: RawDocument | null;
  /** Hash of the document on screen. */
  currentHash: string | null;
  /** Why the last check failed, when it did. */
  failure?: unknown;
  /** The last result's analysis: why each node can fail, what the result
   * may leave empty — of the document on screen when `ready`. */
  analysis: AnalysisView | null;
  /** The last result's inferred shapes: the run input, each node's output,
   * the result. */
  types: TypesView | null;
}

interface Settled {
  hash: string;
  answer: DraftCheck;
  document: RawDocument;
}

/** What every check asks for beside the issues: the canvas words why a
 * node can fail and shows what each node returns. */
const DETAIL: readonly ValidationDetail[] = ['analysis', 'types'];

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
  /** The draft, or the stored version on screen — raw, every key kept, as
   * a save would send it. */
  document: RawDocument | null;
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
      withinTime(signal, VALIDATION_TIMEOUT_MS, (bounded) =>
        runAdapted(() =>
          validateAutomationDraft(organizationId, automationSlug, target, {
            signal: bounded,
            detail: DETAIL,
          }),
        ),
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
    target !== null &&
    targetHash !== null &&
    (settledRef.current?.hash !== targetHash ||
      settledRef.current.answer !== query.data)
  ) {
    settledRef.current = {
      hash: targetHash,
      answer: query.data,
      document: target,
    };
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
    settledDocument: settled?.document ?? null,
    currentHash,
    ...(status === 'failed' && { failure: query.error }),
    analysis: settled?.answer.analysis ?? null,
    types: settled?.answer.types ?? null,
  };
}
