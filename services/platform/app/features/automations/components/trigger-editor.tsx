'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import {
  EditorSaveCancelledError,
  useRegisterDirtySource,
  useRegisterGroupedEditor,
  type EditorController,
} from '@tale/ui/editor';
import { InlineCode } from '@tale/ui/inline-code';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { toast } from '@tale/ui/use-toast';
import { Link } from '@tanstack/react-router';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { SettingsToggleRow } from '@/app/features/settings/components/settings-toggle-row';
import { PERMANENT_FAILURES_BEFORE_PAUSE } from '@/backend/core/automations/failure';
import { automationSlugToParam } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';
import { localTimeZone } from '@/lib/shared/zoned-time';

import {
  useDeleteAutomationTrigger,
  useSetAutomationTrigger,
} from '../hooks/mutations';
import { useAutomationTriggers } from '../hooks/queries';
import { useTriggerDraft } from '../hooks/use-trigger-draft';
import { TRIGGER_DIRTY_KEY } from '../lib/dirty-keys';
import { automationErrorMessage } from '../lib/errors';
import {
  sameAsStored,
  toTriggerBody,
  triggerDraftIssue,
} from '../lib/trigger-draft';
import { triggerRefusalText } from '../lib/trigger-issue-text';
import { TriggerForm } from './trigger-form';

type StoredTrigger = NonNullable<
  ReturnType<typeof useAutomationTriggers>['data']
>[number];

const NO_DIRTY_KEYS: ReadonlySet<string> = new Set();
/** What the General tab's strip lights its unsaved dot for. */
const TRIGGER_DIRTY_KEYS: ReadonlySet<string> = new Set([TRIGGER_DIRTY_KEY]);

/**
 * The automation's trigger binding: what starts it, and whether it is armed.
 *
 * One binding per automation (the store replaces in place), so this is an
 * editor over a single row: pick a kind, fill the kind's own fields, save.
 * A webhook's token is the one stateful subtlety — the server returns the
 * plaintext exactly once, on mint or rotation, and this section is the only
 * chance to copy it; afterwards only "a token exists" survives.
 *
 * A trigger fires nothing until a version is deployed — `beginRun` resolves
 * through the deployment — so arming a draft is safe by construction; the
 * section SAYS so under the schedule ("won't start until a version is
 * deployed"), and says "paused" while the binding is off, instead of
 * promising a next run that nothing will start.
 *
 * A section of the automation's General tab: its edits join the page's one
 * Save/Discard cluster in the tab strip (`useRegisterGroupedEditor`), and
 * leaving the tab with an unsaved change asks first. A save that would revoke
 * a live webhook URL asks first too. Rotating the token and removing the
 * trigger are instant actions with their own confirmation.
 */
export function TriggerEditor({
  organizationId,
  name,
  /** Authoring is developer-gated server-side; readers still see the binding. */
  canEdit,
  deployedVersion,
  projectId,
}: {
  organizationId: string;
  name: string;
  canEdit: boolean;
  /** The version triggers start — undefined while nothing is deployed, when
   * the section says a schedule will not start rather than when it will. */
  deployedVersion?: number | undefined;
  /** The project whose route shows the section, if any: a run it links
   * opens under the same project, as the run list's rows do. */
  projectId?: string | undefined;
}) {
  const { t } = useT('automations');
  const { t: tRecurrence } = useT('recurrence');
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const { formatDate } = useFormatDate();
  // The public webhook endpoint. External callers POST here; the token is the
  // last path segment and is shown only once (stored as a hash), so a revisit
  // shows a `<token>` placeholder and points to Rotate. The origin the operator
  // is browsing IS the deployment origin (dev proxies /api/* to the backend), so it
  // is the base of the URL an external caller uses.
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const webhookUrl = (token: string): string =>
    `${origin}/api/automations/webhook/${token}`;
  // A new trigger reads its schedule in the reader's own zone.
  const [viewerZone] = useState(localTimeZone);

  const triggersQuery = useAutomationTriggers(organizationId, name);
  const setTrigger = useSetAutomationTrigger();
  const deleteTrigger = useDeleteAutomationTrigger();

  const stored = triggersQuery.data?.[0];

  const [refusal, setRefusal] = useState<string | null>(null);
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // The two irreversible webhook moves ask first: replacing a live webhook
  // with another kind revokes its URL the moment the bind commits, and a
  // rotation swaps it — the sending system breaks either way, so neither
  // happens on a single click.
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  // Whether the author opened the form for a binding that does not exist
  // yet — without one the section says "no trigger" instead of drawing an
  // empty schedule that looks armed. A new binding starts OFF: nothing
  // starts runs before the author has looked at it.
  const [adding, setAdding] = useState(false);

  const { draft, update, applyStored, persist } = useTriggerDraft(
    stored,
    viewerZone,
    () => setAdding(false),
  );
  const storedRef = useRef(stored);
  storedRef.current = stored;

  // Opening the form for a new binding is the edit; otherwise the draft is
  // dirty when saving it would send something other than what is stored.
  const dirty = stored === undefined ? adding : !sameAsStored(draft, stored);
  const issue = triggerDraftIssue(draft);

  /** Write the draft as the binding; a webhook's fresh token is shown once. */
  const persistTrigger = (rotateToken?: boolean): Promise<void> => {
    setRefusal(null);
    setMintedToken(null);
    return persist(async (sent) => {
      const result = await setTrigger.mutateAsync({
        organizationId,
        name,
        trigger: toTriggerBody(sent, storedRef.current ?? null),
        ...(rotateToken === true && { rotateToken: true }),
      });
      if (result.token !== undefined) setMintedToken(result.token);
      // The server names the live URL this bind stopped answering on — say
      // so, since nothing on the page shows the old URL any more.
      if (result.revoked === 'webhook') {
        toast({ title: t('trigger.revokedToast') });
      }
    });
  };

  // The group keeps the controller it registered until one of its status
  // flags changes, so save and discard read the latest form through refs.
  const persistRef = useRef(persistTrigger);
  persistRef.current = persistTrigger;
  const refusalTextRef = useRef((error: unknown) =>
    triggerRefusalText(error, { t, tRecurrence, locale }),
  );
  refusalTextRef.current = (error: unknown) =>
    triggerRefusalText(error, { t, tRecurrence, locale });

  // A draft the store would refuse is the one thing the browser can hold
  // back before the store does; Save waits until it reads.
  const blocked = issue !== null;
  const canRotate = draft.kind === 'webhook' && stored?.hasToken === true;
  const canRemove = stored !== undefined;
  // A read that failed shows no form at all: an empty form would look like
  // an automation without a trigger, or an armed one.
  const loadFailed = triggersQuery.isError && stored === undefined;
  // The form draws for a stored binding, or once the author asked to add one.
  const showForm = stored !== undefined || (canEdit && adding && !loadFailed);

  // Whether saving as things stand would revoke a live webhook URL: a
  // token-bearing webhook binding, being replaced by another kind.
  const revokesWebhook =
    stored?.kind === 'webhook' && stored.hasToken && draft.kind !== 'webhook';
  const revokesWebhookRef = useRef(revokesWebhook);
  revokesWebhookRef.current = revokesWebhook;

  // The revoke confirmation a save waits on: confirming lets the save go on,
  // backing out cancels it silently and keeps the draft dirty for a retry.
  const pendingRevokeRef = useRef<{
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);
  const askRevoke = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        if (pendingRevokeRef.current !== null) {
          // The dialog already owns a save; a second one is a no-op.
          reject(new EditorSaveCancelledError());
          return;
        }
        pendingRevokeRef.current = { resolve, reject };
        setConfirmRevoke(true);
      }),
    [],
  );
  const settleRevoke = (confirmed: boolean) => {
    const pending = pendingRevokeRef.current;
    pendingRevokeRef.current = null;
    setConfirmRevoke(false);
    if (confirmed) pending?.resolve();
    else pending?.reject(new EditorSaveCancelledError());
  };

  const controller = useMemo<EditorController>(
    () => ({
      isDirty: dirty,
      isSaving: setTrigger.isPending,
      isValid: !blocked,
      isLoading: triggersQuery.isPending,
      dirtyKeys: dirty ? TRIGGER_DIRTY_KEYS : NO_DIRTY_KEYS,
      save: async () => {
        if (revokesWebhookRef.current) await askRevoke();
        try {
          await persistRef.current();
        } catch (error) {
          // The store's refusal names the problem and the fix — each coded
          // problem in its field's words; the cluster raises it as the
          // save's one failure toast.
          throw new Error(refusalTextRef.current(error), { cause: error });
        }
      },
      reset: () => {
        setRefusal(null);
        applyStored(storedRef.current);
      },
    }),
    [
      dirty,
      setTrigger.isPending,
      blocked,
      triggersQuery.isPending,
      applyStored,
      askRevoke,
    ],
  );
  useRegisterGroupedEditor(controller, { enabled: canEdit });
  // The draft lives in this section only, so leaving the tab would drop it.
  useRegisterDirtySource(canEdit && dirty);

  return (
    <Skeletonize loading={triggersQuery.isPending} label={t('trigger.title')}>
      <SettingsSection
        title={t('trigger.title')}
        description={t('trigger.description')}
        {...(canEdit &&
          canRemove && {
            action: (
              <Button
                size="sm"
                variant="ghost"
                icon={Trash2}
                isLoading={deleteTrigger.isPending}
                onClick={() => {
                  setConfirmRemove(true);
                }}
              >
                {t('trigger.remove')}
              </Button>
            ),
          })}
      >
        {stored?.lastFiredAt != null && (
          <Text as="p" variant="muted" className="text-xs">
            {t('trigger.lastFired', {
              at: formatDate(new Date(stored.lastFiredAt), 'long'),
            })}
          </Text>
        )}

        {stored !== undefined && (
          <TriggerFailureNotice
            organizationId={organizationId}
            projectId={projectId}
            name={name}
            trigger={stored}
          />
        )}

        {loadFailed && (
          <Alert variant="destructive" description={t('trigger.loadFailed')}>
            <div className="pt-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void triggersQuery.refetch()}
              >
                {t('trigger.retry')}
              </Button>
            </div>
          </Alert>
        )}

        {!showForm && !loadFailed && !triggersQuery.isPending && (
          <div className="flex flex-col items-start gap-2">
            <Text as="p" variant="muted" className="text-sm">
              {t('trigger.none')}
            </Text>
            {canEdit && (
              <Button
                size="sm"
                variant="secondary"
                icon={Plus}
                onClick={() => {
                  setAdding(true);
                }}
              >
                {t('trigger.add')}
              </Button>
            )}
          </div>
        )}

        {refusal !== null && (
          <Alert variant="destructive" description={refusal} />
        )}

        {mintedToken !== null && (
          <Alert
            variant="warning"
            icon={KeyRound}
            title={t('trigger.tokenTitle')}
            description={
              <span className="flex flex-col gap-1">
                <span>{t('trigger.webhookHowto')}</span>
                <InlineCode className="break-all select-all">
                  curl -X POST {webhookUrl(mintedToken)}
                </InlineCode>
                <span>{t('trigger.tokenHint')}</span>
              </span>
            }
          />
        )}

        {showForm && (
          <div className="flex flex-col gap-4">
            <SettingsToggleRow
              label={t('trigger.enabledLabel')}
              checked={draft.enabled}
              onCheckedChange={(enabled) => update({ enabled })}
              disabled={!canEdit}
            />
            <TriggerForm
              surface="panel"
              draft={draft}
              stored={stored ?? null}
              canEdit={canEdit}
              viewerZone={viewerZone}
              runState={{
                clean: !dirty,
                deployed: deployedVersion !== undefined,
                nextRunAt: stored?.nextRunAt ?? null,
              }}
              onChange={update}
              webhookDetails={
                <div className="flex flex-col gap-1">
                  <Text
                    as="span"
                    variant="muted"
                    className="text-xs font-medium"
                  >
                    {t('trigger.webhookEndpointLabel')}
                  </Text>
                  <InlineCode className="break-all select-all">
                    curl -X POST {webhookUrl(mintedToken ?? '<token>')}
                  </InlineCode>
                  <Text as="span" variant="muted" className="text-xs">
                    {t('trigger.webhookHowto')}{' '}
                    {stored?.hasToken === true
                      ? t('trigger.hasToken')
                      : t('trigger.noToken')}
                  </Text>
                  <Text as="span" variant="muted" className="text-xs">
                    {t('trigger.webhookProjectHint')}
                  </Text>
                  <InlineCode className="break-all select-all">
                    curl -X POST{' '}
                    {`${origin}/api/projects/<projectId>/automations/webhook/${mintedToken ?? '<token>'}`}
                  </InlineCode>
                  {canEdit && canRotate && (
                    <div className="pt-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={KeyRound}
                        isLoading={setTrigger.isPending}
                        onClick={() => {
                          setConfirmRotate(true);
                        }}
                      >
                        {t('trigger.rotate')}
                      </Button>
                    </div>
                  )}
                </div>
              }
            />
          </div>
        )}

        <ConfirmDialog
          open={confirmRevoke}
          onOpenChange={(open) => {
            if (!open) settleRevoke(false);
          }}
          title={t('trigger.revokeConfirm.title')}
          description={t('trigger.revokeConfirm.body')}
          confirmText={t('trigger.revokeConfirm.confirm')}
          variant="destructive"
          onConfirm={() => {
            settleRevoke(true);
          }}
        />

        <ConfirmDialog
          open={confirmRotate}
          onOpenChange={setConfirmRotate}
          title={t('trigger.rotateConfirm.title')}
          description={t('trigger.rotateConfirm.body')}
          confirmText={t('trigger.rotate')}
          variant="destructive"
          isLoading={setTrigger.isPending}
          onConfirm={() => {
            setConfirmRotate(false);
            // Rotating writes the form as it stands, like a save, and shows
            // the new URL once.
            persistRef.current(true).catch((error: unknown) => {
              setRefusal(refusalTextRef.current(error));
            });
          }}
        />

        <ConfirmDialog
          open={confirmRemove}
          onOpenChange={setConfirmRemove}
          title={t('trigger.removeTitle')}
          description={t('trigger.removeBody')}
          confirmText={t('trigger.remove')}
          variant="destructive"
          isLoading={deleteTrigger.isPending}
          onConfirm={() => {
            setRefusal(null);
            setMintedToken(null);
            deleteTrigger.mutate(
              { organizationId, name },
              {
                onSuccess: () => {
                  setConfirmRemove(false);
                  // Nothing is bound any more: the form starts over instead
                  // of holding the removed binding as an unsaved edit.
                  applyStored(undefined);
                },
                onError: (error) => {
                  setRefusal(automationErrorMessage(error));
                },
              },
            );
          }}
        />
      </SettingsSection>
    </Skeletonize>
  );
}

/**
 * What the binding's failure streak says (`trigger-failures.ts`): a schedule
 * its failures paused — a standing banner until someone saves the trigger —
 * or runs failing in a row that will pause a schedule, each with the last
 * failure's code and a way into its run. Silent while the streak is empty.
 */
function TriggerFailureNotice({
  organizationId,
  projectId,
  name,
  trigger,
}: {
  organizationId: string;
  projectId: string | undefined;
  name: string;
  trigger: StoredTrigger;
}) {
  const { t } = useT('automations');
  const { formatDate } = useFormatDate();
  const count = trigger.consecutiveFailures ?? 0;
  const paused =
    !trigger.enabled && trigger.lastSkipReason === 'paused_after_failures';
  if (!paused && count === 0) return null;

  const lastFailure =
    trigger.lastFailedAt != null && trigger.lastFailureCode != null ? (
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span>
          {t('trigger.failures.last', {
            at: formatDate(new Date(trigger.lastFailedAt), 'long'),
          })}
        </span>
        <InlineCode>{trigger.lastFailureCode}</InlineCode>
        {trigger.lastFailedRunId != null && (
          <Link
            // The run opens where the section is shown: under the project
            // when the tab is, as the run list's rows open it.
            {...(projectId
              ? {
                  to: '/dashboard/$id/projects/$projectId/automations/$automationSlug/runs/$runId' as const,
                  params: {
                    id: organizationId,
                    projectId,
                    automationSlug: automationSlugToParam(name),
                    runId: trigger.lastFailedRunId,
                  },
                }
              : {
                  to: '/dashboard/$id/automations/$automationSlug/runs/$runId' as const,
                  params: {
                    id: organizationId,
                    automationSlug: automationSlugToParam(name),
                    runId: trigger.lastFailedRunId,
                  },
                })}
            className="text-foreground focus-visible:ring-ring rounded-sm underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
          >
            {t('trigger.failures.viewRun')}
          </Link>
        )}
      </span>
    ) : null;

  if (paused) {
    return (
      <Alert
        variant="warning"
        // A standing state, not an event: announcing it on every visit to
        // the tab would repeat what the page already shows.
        live="off"
        title={t('trigger.failures.pausedTitle')}
        description={
          <span className="flex flex-col gap-1">
            <span>{t('trigger.failures.pausedBody', { count })}</span>
            {lastFailure}
          </span>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <Text as="p" variant="muted" className="text-xs">
        {t('trigger.failures.streak', { count })}
        {trigger.kind === 'schedule' &&
          trigger.enabled &&
          ` ${t('trigger.failures.streakSchedule', {
            limit: PERMANENT_FAILURES_BEFORE_PAUSE,
          })}`}
      </Text>
      {lastFailure !== null && (
        <Text as="div" variant="muted" className="text-xs">
          {lastFailure}
        </Text>
      )}
    </div>
  );
}
