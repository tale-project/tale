'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { JsonViewer } from '@tale/ui/json-viewer';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useFocusHandoff } from '@tale/ui/use-focus-handoff';
import { useRetryFocus } from '@tale/ui/use-retry-focus';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';
import type {
  InDoubtResolution,
  RunInDoubt,
} from '@/app/lib/backend/contract/automations';
import { useT } from '@/lib/i18n/client';

import { useResolveRunInDoubt } from '../hooks/mutations';
import { useRunInDoubt } from '../hooks/queries';

/** The step a run waiting on a write that may already have happened names
 * in its `in_doubt:<node>` detail, or nothing for any other detail. */
export function inDoubtNodeFromDetail(
  detail: string | null | undefined,
): string | undefined {
  if (typeof detail !== 'string') return undefined;
  return /^in_doubt:(.+)$/.exec(detail)?.[1];
}

/** Which attempt a decision was about: its row and its number. A write run
 * again keeps its row and takes the next number, so a second interruption of
 * it is a new decision. */
interface AttemptRef {
  attemptId: string;
  attempt: number;
}

/** A decision this card recorded, for the attempt it was about. */
interface Recorded extends AttemptRef {
  resolution: InDoubtResolution;
}

/** A decision the door refused, for the attempt it was about. */
interface Refusal extends AttemptRef {
  detail: string | undefined;
}

function sameAttempt(a: AttemptRef, b: AttemptRef): boolean {
  return a.attemptId === b.attemptId && a.attempt === b.attempt;
}

/** The decisions that ask before they go. */
type Confirmable = Exclude<InDoubtResolution, 'skip'>;

/** A question the dialog asks, about the attempt it was opened for. */
interface Confirming {
  decision: Confirmable;
  about: RunInDoubt;
}

/**
 * A run parked on a write that may already have happened: its server stopped
 * while the step was sending to its service, and Tale cannot tell whether the
 * service got it. The card names the step, the connector and what was sent,
 * and offers the three ways on — **Run it again** (it may then happen
 * twice, so it asks first), **Skip it** (the run continues as if the step
 * returned nothing) and **Fail the run** (asks first).
 *
 * Everything the card shows belongs to ONE attempt: a refusal, a recorded
 * decision or an open question is kept with the attempt it was about, so a
 * later write the run parks on — or the same write interrupted again after
 * **Run it again** — never shows the previous one's outcome, and a choice
 * is only ever sent about the attempt it was made for. Loading, failed and
 * pending share one mounted frame, so the card holds its place as the read
 * resolves. It is a labelled section with its own heading, carries the
 * accent of a move that is the reader's, and says once, politely, that the
 * run waits for a decision. Once a decision is recorded the actions go and
 * focus moves to the sentence saying what happens next; when the run moves
 * on and the card leaves the page with focus inside it, `onFocusLost` takes
 * the focus.
 */
export function RunInDoubtCard({
  organizationId,
  runId,
  node,
  iterates = false,
  onFocusLost,
}: {
  organizationId: string;
  runId: string;
  /** The step the run is parked on, from its `in_doubt:<node>` detail —
   * named while the write itself loads. */
  node: string;
  /** Whether that step runs once per item, so the card names the item. */
  iterates?: boolean;
  onFocusLost?: () => void;
}) {
  const { t } = useT('automations');
  const inDoubtQuery = useRunInDoubt(organizationId, runId);
  const resolve = useResolveRunInDoubt();
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const skipHintId = useId();
  const titleId = useId();
  const handoffRef = useFocusHandoff<HTMLElement>(onFocusLost);
  const resolvedRef = useRef<HTMLDivElement>(null);
  // Said once, after the card is on the page: a live region that already
  // holds its words when it appears is not read out.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    setAnnouncement(t('runs.waiting.in_doubt', { node }));
  }, [t, node]);

  const attempt = inDoubtQuery.data ?? null;
  const loading = inDoubtQuery.data === undefined && !inDoubtQuery.isError;
  const unreadable = inDoubtQuery.data === undefined && inDoubtQuery.isError;
  const retryFocus = useRetryFocus(
    inDoubtQuery.data !== undefined
      ? 'ready'
      : unreadable
        ? 'failed'
        : 'loading',
    runId,
  );
  // A decision recorded here stands until the run parks on another write,
  // or on this one again: the read then answers that attempt.
  const decided =
    recorded !== null && (attempt === null || sameAttempt(attempt, recorded))
      ? recorded
      : null;
  // An open question belongs to the attempt it was opened for. Once the read
  // answers another one (the write was run again and interrupted again) or
  // nothing, the question is withdrawn: the dialog closes instead of
  // confirming a choice nobody made about what waits now, and it does not
  // come back unasked if the same attempt waits again.
  if (
    confirming !== null &&
    (attempt === null || !sameAttempt(attempt, confirming.about))
  ) {
    setConfirming(null);
  }

  // The pressed action left the page with the decision; the focus it held
  // would fall to the page. It goes to the sentence that replaced it,
  // unless the reader already moved it elsewhere.
  useEffect(() => {
    if (decided === null) return;
    const active = document.activeElement;
    if (active === null || active === document.body) {
      resolvedRef.current?.focus();
    }
  }, [decided]);

  const connector = attempt?.connector ?? '';
  const item =
    attempt !== null &&
    ((iterates && attempt.nodeId === node) || attempt.itemIndex > 0)
      ? String(attempt.itemIndex + 1)
      : 'none';
  const shownRefusal =
    attempt !== null && refusal !== null && sameAttempt(attempt, refusal)
      ? refusal
      : null;
  const busy = loading || resolve.isPending;

  const decide = (decision: InDoubtResolution, about: RunInDoubt) => {
    setRefusal(null);
    resolve
      .mutateAsync({
        organizationId,
        runId,
        attemptId: about.attemptId,
        // The door refuses a choice about an earlier attempt of the write,
        // so a late press never decides the attempt that waits now.
        attempt: about.attempt,
        resolution: decision,
      })
      .then(
        () => {
          setConfirming(null);
          setRecorded({
            attemptId: about.attemptId,
            attempt: about.attempt,
            resolution: decision,
          });
        },
        (error: unknown) => {
          setConfirming(null);
          setRefusal({
            attemptId: about.attemptId,
            attempt: about.attempt,
            detail: failureDetail(error),
          });
          // The attempt's own record decides what the card shows next:
          // someone else may have decided it first.
          void inDoubtQuery.refetch();
        },
      );
  };

  let body: ReactNode;
  if (decided !== null) {
    body = (
      <div ref={handoffRef}>
        <div
          ref={resolvedRef}
          tabIndex={-1}
          className="focus-visible:ring-ring rounded-lg outline-none focus-visible:ring-2"
        >
          <Alert
            variant={decided.resolution === 'fail' ? 'destructive' : 'info'}
            description={t(`runs.inDoubt.resolved.${decided.resolution}`)}
          />
        </div>
      </div>
    );
  } else if (inDoubtQuery.data === null) {
    // Nothing waits any more: someone decided elsewhere, or the run is on
    // its way to the next step and the run read has not caught up yet.
    body = (
      <div ref={handoffRef}>
        <Alert variant="info" description={t('runs.inDoubt.settled')} />
      </div>
    );
  } else {
    body = (
      <Skeletonize loading={loading} label={t('runs.inDoubt.loading')}>
        <Card
          asChild
          ref={handoffRef}
          padding="md"
          className="border-primary/40 bg-primary/[0.03] flex flex-col gap-3"
        >
          <section aria-labelledby={titleId}>
            <div className="flex items-start gap-2">
              <TriangleAlert
                className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500"
                aria-hidden
              />
              <div className="flex min-w-0 flex-col gap-1">
                <Text as="h3" id={titleId} className="text-sm font-medium">
                  {t('runs.inDoubt.title', { node: attempt?.nodeId ?? node })}
                </Text>
                {/* Mounted while the write loads, masked over a stand-in of
                    the same length, so the card does not grow as it lands. */}
                {!unreadable && (
                  <SkeletonBox fullWidth>
                    <Text as="p" variant="muted" className="text-xs">
                      {t('runs.inDoubt.body', {
                        item,
                        connector: attempt?.connector ?? node,
                      })}
                    </Text>
                  </SkeletonBox>
                )}
              </div>
            </div>
            {unreadable ? (
              <div ref={retryFocus.ref}>
                <Alert
                  variant="destructive"
                  title={t('runs.inDoubt.loadFailed')}
                  description={failureDetail(inDoubtQuery.error)}
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={RefreshCw}
                    className="mt-3"
                    isLoading={inDoubtQuery.isFetching}
                    onClick={() => {
                      retryFocus.arm();
                      void inDoubtQuery.refetch();
                    }}
                  >
                    {t('runs.inDoubt.reload')}
                  </Button>
                </Alert>
              </div>
            ) : (
              <>
                <InDoubtInput input={attempt?.input ?? LOADING_INPUT} />
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        if (attempt !== null) {
                          setConfirming({ decision: 'retry', about: attempt });
                        }
                      }}
                    >
                      {t('runs.inDoubt.retry')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      isLoading={resolve.isPending && confirming === null}
                      aria-describedby={skipHintId}
                      onClick={() => {
                        if (attempt !== null) decide('skip', attempt);
                      }}
                    >
                      {t('runs.inDoubt.skip')}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        if (attempt !== null) {
                          setConfirming({ decision: 'fail', about: attempt });
                        }
                      }}
                    >
                      {t('runs.inDoubt.fail')}
                    </Button>
                  </div>
                  <Text
                    as="p"
                    id={skipHintId}
                    variant="muted"
                    className="text-xs"
                  >
                    {t('runs.inDoubt.skipHint')}
                  </Text>
                </div>
              </>
            )}
            {shownRefusal !== null && (
              <Alert
                variant="destructive"
                title={t('runs.inDoubt.decideFailed')}
                description={shownRefusal.detail}
              />
            )}
          </section>
        </Card>
      </Skeletonize>
    );
  }

  return (
    <>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {body}
      {/* Running it again may make it happen twice, and failing the run is
          final: both ask first. The dialog stays open while the choice is
          sent, and gives focus to the sentence that replaces the actions. */}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={
          confirming?.decision === 'fail'
            ? t('runs.inDoubt.failConfirm.title')
            : t('runs.inDoubt.retryConfirm.title')
        }
        description={
          confirming?.decision === 'fail'
            ? t('runs.inDoubt.failConfirm.body')
            : t('runs.inDoubt.retryConfirm.body', {
                connector: confirming?.about.connector ?? connector,
              })
        }
        confirmText={
          confirming?.decision === 'fail'
            ? t('runs.inDoubt.fail')
            : t('runs.inDoubt.retry')
        }
        variant={confirming?.decision === 'fail' ? 'destructive' : 'warning'}
        isLoading={resolve.isPending}
        restoreFocusRef={resolvedRef}
        onConfirm={() => {
          // The attempt the question was asked about, never a newer read.
          if (confirming !== null) {
            decide(confirming.decision, confirming.about);
          }
        }}
      />
    </>
  );
}

/** A stand-in the input masks while the write loads — the shape of a
 * typical call, so the loaded input takes the space it held. */
const LOADING_INPUT = { to: '', subject: '' };

/** What the step was sending when the run was interrupted. */
function InDoubtInput({ input }: { input: unknown }) {
  const { t } = useT('automations');
  return (
    <div className="flex flex-col gap-1">
      <Text as="p" variant="muted" className="text-xs">
        {t('runs.inDoubt.input')}
      </Text>
      <SkeletonBox asChild>
        <div>
          <JsonViewer data={input} collapsed={1} />
        </div>
      </SkeletonBox>
    </div>
  );
}
