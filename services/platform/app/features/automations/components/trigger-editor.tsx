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
import { Field } from '@tale/ui/field';
import { Input } from '@tale/ui/input';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@tale/ui/searchable-select';
import { Select } from '@tale/ui/select';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { toast } from '@tale/ui/use-toast';
import { Link } from '@tanstack/react-router';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { SettingsToggleRow } from '@/app/features/settings/components/settings-toggle-row';
import { PERMANENT_FAILURES_BEFORE_PAUSE } from '@/backend/core/automations/failure';
import { automationSlugToParam } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';
import { EMITTED_EVENT_TYPES } from '@/lib/shared/event-types';

import {
  useDeleteAutomationTrigger,
  useSetAutomationTrigger,
} from '../hooks/mutations';
import { useAutomationTriggers } from '../hooks/queries';
import { useCronPreview } from '../hooks/use-cron-preview';
import { listTimezoneOptions } from '../lib/cron-preview';
import { TRIGGER_DIRTY_KEY } from '../lib/dirty-keys';
import { automationErrorMessage } from '../lib/errors';

const TRIGGER_KINDS = ['schedule', 'webhook', 'event'] as const;
type TriggerKind = (typeof TRIGGER_KINDS)[number];

function isTriggerKind(value: string): value is TriggerKind {
  return (TRIGGER_KINDS as readonly string[]).includes(value);
}

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
}: {
  organizationId: string;
  name: string;
  canEdit: boolean;
  /** The version triggers start — undefined while nothing is deployed, when
   * the section says a schedule will not start rather than when it will. */
  deployedVersion?: number | undefined;
}) {
  const { t } = useT('automations');
  const { formatDate } = useFormatDate();
  // The public webhook endpoint. External callers POST here; the token is the
  // last path segment and is shown only once (stored as a hash), so a revisit
  // shows a `<token>` placeholder and points to Rotate. The origin the operator
  // is browsing IS the deployment origin (dev proxies /api/* to the backend), so it
  // is the base of the URL an external caller uses.
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const webhookUrl = (token: string): string =>
    `${origin}/api/automations/webhook/${token}`;
  const cronId = useId();
  const eventId = useId();

  const triggersQuery = useAutomationTriggers(organizationId, name);
  const setTrigger = useSetAutomationTrigger();
  const deleteTrigger = useDeleteAutomationTrigger();

  const stored = triggersQuery.data?.[0];

  const [kind, setKind] = useState<TriggerKind>('schedule');
  const [cron, setCron] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [eventName, setEventName] = useState('');
  // A NEW binding starts OFF: the docs say to keep Enabled off while
  // preparing, and a binding that armed itself the moment a cron was typed
  // started runs nobody had asked for yet.
  const [enabled, setEnabled] = useState(false);
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
  // empty schedule that looks armed.
  const [adding, setAdding] = useState(false);

  /** Put a binding (none: the empty form) into the fields. */
  const applyStored = useCallback((row: typeof stored) => {
    setAdding(false);
    if (row === undefined) {
      setKind('schedule');
      setCron('');
      setTimezone('UTC');
      setEventName('');
      setEnabled(false);
      return;
    }
    if (isTriggerKind(row.kind)) setKind(row.kind);
    setCron(row.cron ?? '');
    setTimezone(row.timezone ?? 'UTC');
    setEventName(row.event ?? '');
    setEnabled(row.enabled);
  }, []);

  // Load the stored binding into the form whenever it changes under us —
  // the row is the truth; local state only carries unsaved edits. Keyed on
  // the fields the form edits, not on the row object: a refetch that only
  // moves `lastFiredAt` (the trigger just fired) must not wipe an edit in
  // progress.
  const storedRef = useRef(stored);
  storedRef.current = stored;
  const storedFields =
    stored === undefined
      ? null
      : JSON.stringify([
          stored.kind,
          stored.cron ?? '',
          stored.timezone ?? 'UTC',
          stored.event ?? '',
          stored.enabled,
        ]);
  useEffect(() => {
    if (storedFields === null) return;
    applyStored(storedRef.current);
  }, [storedFields, applyStored]);

  const dirty = useMemo(() => {
    if (stored === undefined) {
      return (
        cron !== '' ||
        (timezone !== '' && timezone !== 'UTC') ||
        eventName !== '' ||
        kind !== 'schedule' ||
        enabled
      );
    }
    return (
      kind !== stored.kind ||
      cron !== (stored.cron ?? '') ||
      timezone !== (stored.timezone ?? 'UTC') ||
      eventName !== (stored.event ?? '') ||
      enabled !== stored.enabled
    );
  }, [stored, kind, cron, timezone, eventName, enabled]);

  const timezoneOptions = useMemo<SearchableSelectOption[]>(
    () =>
      listTimezoneOptions(timezone).map((zone) => ({
        value: zone,
        label: zone,
      })),
    [timezone],
  );

  // The validator's verdict and the words under the field — shared with
  // the blank-automation wizard, so both surfaces refuse the same crons.
  const {
    preview: cronPreview,
    description: cronNextDescription,
    invalidText: cronInvalidText,
    pattern: cronPattern,
  } = useCronPreview(cron, timezone, kind === 'schedule');

  // What the schedule will actually do: nothing while the switch is off,
  // nothing until a version is deployed (the occurrence it WOULD take is
  // still named, so the author knows what arming means), the next run else.
  const cronDescription = useMemo(() => {
    if (kind !== 'schedule' || cronPreview.kind !== 'ok') {
      return cronNextDescription;
    }
    const lead = cronPattern === undefined ? '' : `${cronPattern} · `;
    if (!enabled) return `${lead}${t('trigger.paused')}`;
    if (deployedVersion === undefined) {
      return `${lead}${t('trigger.notDeployed', {
        at: formatDate(cronPreview.nextAt, 'long'),
      })}`;
    }
    return cronNextDescription;
  }, [
    kind,
    cronPreview,
    cronNextDescription,
    cronPattern,
    enabled,
    deployedVersion,
    t,
    formatDate,
  ]);

  /** Write the form as the binding; a webhook's fresh token is shown once. */
  const persist = async (rotateToken?: boolean): Promise<void> => {
    setRefusal(null);
    setMintedToken(null);
    const result = await setTrigger.mutateAsync({
      organizationId,
      name,
      trigger: {
        kind,
        ...(kind === 'schedule' && cron !== '' && { cron }),
        ...(kind === 'schedule' && timezone !== '' && { timezone }),
        ...(kind === 'event' && eventName !== '' && { event: eventName }),
        enabled,
      },
      ...(rotateToken === true && { rotateToken: true }),
    });
    if (result.token !== undefined) setMintedToken(result.token);
    // The server names the live URL this bind stopped answering on — say so,
    // since nothing on the page shows the old URL any more.
    if (result.revoked === 'webhook') {
      toast({ title: t('trigger.revokedToast') });
    }
  };

  // The group keeps the controller it registered until one of its status
  // flags changes, so save and discard read the latest form through refs.
  const persistRef = useRef(persist);
  persistRef.current = persist;

  const blocked = kind === 'schedule' && cronPreview.kind === 'invalid';
  const canRotate = kind === 'webhook' && stored?.hasToken === true;
  const canRemove = stored !== undefined;
  // The form draws for a stored binding, or once the author asked to add one.
  const showForm = stored !== undefined || (canEdit && adding);

  // Whether saving as things stand would revoke a live webhook URL: a
  // token-bearing webhook binding, being replaced by another kind.
  const revokesWebhook =
    stored?.kind === 'webhook' && stored.hasToken && kind !== 'webhook';
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
      // A cron that cannot be read is the one thing the browser can refuse
      // before the store does; Save waits until it parses.
      isValid: !blocked,
      isLoading: triggersQuery.isPending,
      dirtyKeys: dirty ? TRIGGER_DIRTY_KEYS : NO_DIRTY_KEYS,
      save: async () => {
        if (revokesWebhookRef.current) await askRevoke();
        try {
          await persistRef.current();
        } catch (error) {
          // The store's refusal names the problem and the fix; the cluster
          // raises it as the save's one failure toast.
          throw new Error(automationErrorMessage(error), { cause: error });
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
            name={name}
            trigger={stored}
          />
        )}

        {!showForm && !triggersQuery.isPending && (
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
                <code className="bg-muted rounded px-1.5 py-0.5 text-xs break-all select-all">
                  curl -X POST {webhookUrl(mintedToken)}
                </code>
                <span>{t('trigger.tokenHint')}</span>
              </span>
            }
          />
        )}

        {showForm && (
          <div className="flex flex-col gap-4">
            <SettingsToggleRow
              label={t('trigger.enabledLabel')}
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={!canEdit}
            />
            <Select
              label={t('trigger.kindLabel')}
              options={TRIGGER_KINDS.map((value) => ({
                value,
                label: t(`trigger.kinds.${value}`),
              }))}
              value={kind}
              onValueChange={(value) => {
                if (isTriggerKind(value)) setKind(value);
              }}
              disabled={!canEdit}
              className="min-w-0"
            />
            {kind === 'schedule' && (
              <>
                <Field
                  label={t('trigger.cronLabel')}
                  htmlFor={cronId}
                  description={
                    cronPreview.kind === 'invalid' ? undefined : cronDescription
                  }
                  error={cronInvalidText}
                >
                  <Input
                    id={cronId}
                    value={cron}
                    placeholder="0 */6 * * *"
                    readOnly={!canEdit}
                    onChange={(event) => setCron(event.target.value)}
                    className="font-mono"
                  />
                </Field>
                <SearchableSelect
                  label={t('trigger.timezoneLabel')}
                  options={timezoneOptions}
                  value={timezone || null}
                  onValueChange={setTimezone}
                  disabled={!canEdit}
                  searchPlaceholder={t('trigger.timezoneSearch')}
                  emptyText={t('trigger.timezoneEmpty')}
                  placeholder="UTC"
                />
              </>
            )}
            {kind === 'event' && (
              <Field label={t('trigger.eventLabel')} htmlFor={eventId}>
                <Select
                  id={eventId}
                  placeholder={t('trigger.eventPlaceholder')}
                  disabled={!canEdit}
                  options={EMITTED_EVENT_TYPES.map((value) => ({
                    value,
                    label: value,
                  }))}
                  value={eventName}
                  onValueChange={(value) => {
                    // Radix fires a spurious '' on unmount — never un-pick.
                    if (value !== '') setEventName(value);
                  }}
                />
              </Field>
            )}
            {kind === 'webhook' && (
              <div className="flex flex-col gap-1">
                <Text as="span" variant="muted" className="text-xs font-medium">
                  {t('trigger.webhookEndpointLabel')}
                </Text>
                <code className="bg-muted rounded px-1.5 py-0.5 text-xs break-all select-all">
                  curl -X POST {webhookUrl(mintedToken ?? '<token>')}
                </code>
                <Text as="span" variant="muted" className="text-xs">
                  {t('trigger.webhookHowto')}{' '}
                  {stored?.hasToken === true
                    ? t('trigger.hasToken')
                    : t('trigger.noToken')}
                </Text>
                <Text as="span" variant="muted" className="text-xs">
                  {t('trigger.webhookProjectHint')}
                </Text>
                <code className="bg-muted rounded px-1.5 py-0.5 text-xs break-all select-all">
                  curl -X POST{' '}
                  {`${origin}/api/projects/<projectId>/automations/webhook/${mintedToken ?? '<token>'}`}
                </code>
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
            )}
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
              setRefusal(automationErrorMessage(error));
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
  name,
  trigger,
}: {
  organizationId: string;
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
        <code className="bg-muted rounded px-1 py-0.5 text-xs">
          {trigger.lastFailureCode}
        </code>
        {trigger.lastFailedRunId != null && (
          <Link
            to="/dashboard/$id/automations/$automationSlug/runs/$runId"
            params={{
              id: organizationId,
              automationSlug: automationSlugToParam(name),
              runId: trigger.lastFailedRunId,
            }}
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
    <div className="text-muted-foreground flex flex-col gap-0.5 text-xs">
      <p>
        {t('trigger.failures.streak', { count })}
        {trigger.kind === 'schedule' &&
          trigger.enabled &&
          ` ${t('trigger.failures.streakSchedule', {
            limit: PERMANENT_FAILURES_BEFORE_PAUSE,
          })}`}
      </p>
      {lastFailure}
    </div>
  );
}
