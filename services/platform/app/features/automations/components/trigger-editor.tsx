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
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { toast } from '@tale/ui/use-toast';
import { Plus, Trash2 } from 'lucide-react';
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useProjects } from '@/app/features/projects/hooks/queries';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { SettingsToggleRow } from '@/app/features/settings/components/settings-toggle-row';
import type { Issue } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';
import { localTimeZone } from '@/lib/shared/zoned-time';

import {
  useDeleteAutomationTrigger,
  useSetAutomationTrigger,
} from '../hooks/mutations';
import {
  useAutomationProjects,
  useAutomationTriggers,
  useDeployedAutomation,
} from '../hooks/queries';
import { useTriggerDraft } from '../hooks/use-trigger-draft';
import { useTriggerInputCheck } from '../hooks/use-trigger-input-check';
import { TRIGGER_DIRTY_KEY } from '../lib/dirty-keys';
import { readDocument } from '../lib/document';
import { automationErrorMessage } from '../lib/errors';
import { AUTOMATION_PROJECTS_FIELD_ID } from '../lib/field-ids';
import {
  sameAsStored,
  toTriggerBody,
  triggerDraftIssue,
} from '../lib/trigger-draft';
import { triggerRefusalText } from '../lib/trigger-issue-text';
import {
  TriggerFixedInput,
  type TriggerFixedInputHandle,
} from './trigger-fixed-input';
import { TriggerForm } from './trigger-form';
import { TriggerHealth } from './trigger-health';
import { TriggerInputPreview } from './trigger-input-preview';
import type { TriggerPlace } from './trigger-links';
import { TriggerRunNow } from './trigger-run-now';
import { TriggerWebhookPanel } from './trigger-webhook-panel';

const NO_WARNINGS: readonly Issue[] = [];

/** Move focus to the control with `id`, when it is on the page. */
function focusField(id: string): void {
  const field = document.getElementById(id);
  if (field === null) return;
  field.scrollIntoView({ block: 'nearest' });
  field.focus();
}

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
  // The origin the operator is browsing IS the deployment origin (dev
  // proxies /api/* to the backend), so it is the base of the webhook URL an
  // external caller uses.
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  // A new trigger reads its schedule in the reader's own zone.
  const [viewerZone] = useState(localTimeZone);

  const triggersQuery = useAutomationTriggers(organizationId, name);
  const setTrigger = useSetAutomationTrigger();
  const deleteTrigger = useDeleteAutomationTrigger();

  const stored = triggersQuery.data?.[0];
  // What the trigger is checked against: the deployed version's inputs.
  const deployedQuery = useDeployedAutomation(
    organizationId,
    name,
    deployedVersion,
  );
  const inputsSchema = useMemo(
    () => readDocument(deployedQuery.data?.document)?.inputs,
    [deployedQuery.data?.document],
  );
  // The projects the automation is installed in, by name: where a run it
  // starts acts.
  const boundQuery = useAutomationProjects(organizationId, name);
  const { projects } = useProjects(organizationId);
  const boundProjects = useMemo(() => {
    const ids = new Set((boundQuery.data ?? []).map(String));
    return projects.filter((project) => ids.has(project._id));
  }, [boundQuery.data, projects]);
  const place: TriggerPlace = { organizationId, projectId, name };
  // A trigger names no project: a sole installation is where its runs act,
  // and otherwise they act organization-wide.
  const [soleProject] = boundProjects.length === 1 ? boundProjects : [];
  const runScopeText =
    soleProject === undefined
      ? t('detail.runScope.confirmOrgWide')
      : t('detail.runScope.confirmProject', { project: soleProject.name });
  const scheduleFieldId = useId();
  const fixedInputRef = useRef<TriggerFixedInputHandle>(null);
  // What the last save answered about the input the trigger sends.
  const [saveWarnings, setSaveWarnings] =
    useState<readonly Issue[]>(NO_WARNINGS);

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
  const inputCheck = useTriggerInputCheck({
    draft,
    stored: stored ?? null,
    inputsSchema,
    deployed: deployedVersion !== undefined && deployedQuery.data != null,
    clean: !dirty,
    saveWarnings,
  });

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
      setSaveWarnings(result.warnings ?? NO_WARNINGS);
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
        {stored !== undefined && (
          <TriggerHealth
            place={place}
            trigger={stored}
            actions={{
              editSchedule: () => focusField(scheduleFieldId),
              editProjects: () => focusField(AUTOMATION_PROJECTS_FIELD_ID),
              ...(canEdit &&
                inputCheck.missing.length > 0 && {
                  fillMissing: {
                    count: inputCheck.missing.length,
                    run: () => fixedInputRef.current?.fillMissing(),
                  },
                }),
            }}
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
              scheduleFieldId={scheduleFieldId}
              after={
                <>
                  <TriggerFixedInput
                    ref={fixedInputRef}
                    value={draft.input}
                    onChange={(input) => update({ input })}
                    canEdit={canEdit}
                    missing={inputCheck.missing}
                  />
                  <TriggerInputPreview
                    surface="panel"
                    kind={draft.kind}
                    check={inputCheck}
                    version={deployedVersion}
                    place={place}
                    {...(canEdit && {
                      action: (
                        <TriggerRunNow
                          place={place}
                          stored={stored ?? null}
                          deployedVersion={deployedVersion}
                          inputsSchema={inputsSchema}
                          dirty={dirty}
                          scopeText={runScopeText}
                        />
                      ),
                    })}
                  />
                </>
              }
              webhookDetails={
                <TriggerWebhookPanel
                  place={place}
                  origin={origin}
                  projects={boundProjects}
                  mintedToken={mintedToken}
                  hasToken={stored?.kind === 'webhook' && stored.hasToken}
                  storedWebhook={stored?.kind === 'webhook'}
                  canEdit={canEdit}
                  rotating={setTrigger.isPending}
                  onRotate={() => {
                    setConfirmRotate(true);
                  }}
                />
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
