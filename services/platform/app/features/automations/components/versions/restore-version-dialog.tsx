'use client';

import * as ToastPrimitives from '@radix-ui/react-toast';
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Checkbox } from '@tale/ui/checkbox';
import { Dialog } from '@tale/ui/dialog/dialog';
import { Field } from '@tale/ui/field';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Input } from '@tale/ui/input';
import { IssueList } from '@tale/ui/issue-list';
import { Text } from '@tale/ui/text';
import { toast } from '@tale/ui/use-toast';
import { useNavigate } from '@tanstack/react-router';
import { useId, useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import type { WireAutomationIssue } from '@/lib/shared/schemas/automation-issues';

import { useRestoreAutomationVersion } from '../../hooks/mutations';
import type { DeployVersion } from '../../hooks/use-deploy-version';
import { editorVersionLink } from '../../lib/detail-paths';
import {
  automationErrorCode,
  automationErrorIssues,
  automationErrorMessage,
  automationVersionStale,
  type StaleChange,
} from '../../lib/errors';
import { refusalIssueItems } from './deploy-refused-dialog';
import { useAuthorText } from './version-author';

/** Long enough to read the toast and reach Open before it fades. */
const RESTORE_TOAST_MS = 10_000;

export interface RestoreVersionDialogProps {
  organizationId: string;
  automationSlug: string;
  projectId?: string | undefined;
  /** The version to restore; null while the dialog is closed. */
  version: number | null;
  /** The newest version the page shows: the restore saves on top of it. */
  latestVersion: number;
  /** The version the page shows as live; null when none is. */
  liveVersion: number | null;
  /** May put the restored version live right away. */
  canDeploy: boolean;
  deployer: Pick<DeployVersion, 'deploy'>;
  onClose: () => void;
}

/**
 * Brings an older version back as the newest: Tale saves a copy of it — as
 * it was, with its message — on top of the latest, and every version in
 * between stays in the history. The live version only changes when the
 * author asks for it here. A version saved meanwhile, or one that no longer
 * passes the checks, is said in the dialog, never in a toast: the author
 * restores on top of the newer version, or opens the old one to fix it.
 */
export function RestoreVersionDialog(props: RestoreVersionDialogProps) {
  // A fresh form for every version the dialog opens on.
  return props.version === null ? null : (
    <RestoreVersionForm
      key={props.version}
      {...props}
      version={props.version}
    />
  );
}

function RestoreVersionForm({
  organizationId,
  automationSlug,
  projectId,
  version,
  latestVersion,
  liveVersion,
  canDeploy,
  deployer,
  onClose,
}: RestoreVersionDialogProps & { version: number }) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { locale } = useLocale();
  const navigate = useNavigate();
  const authorText = useAuthorText(organizationId);
  const restore = useRestoreAutomationVersion();
  const messageId = useId();
  const [message, setMessage] = useState(() =>
    t('restore.defaultMessage', { version }),
  );
  const [deployNow, setDeployNow] = useState(false);
  // The latest version the restore saves on top of: the page's, or the one
  // a refusal said was saved meanwhile, once the author chose to go on.
  const [base, setBase] = useState(latestVersion);
  const [stale, setStale] = useState<StaleChange | null>(null);
  const [invalid, setInvalid] = useState<readonly WireAutomationIssue[] | null>(
    null,
  );
  const [failure, setFailure] = useState<string | null>(null);
  const invalidItems = useMemo(
    () => (invalid === null ? [] : refusalIssueItems(invalid, { locale, t })),
    [invalid, locale, t],
  );

  const next = base + 1;
  const staleLatest = stale?.version ?? null;

  const submit = () => {
    if (restore.isPending) return;
    const onTopOf = staleLatest ?? base;
    setFailure(null);
    setInvalid(null);
    restore
      .mutateAsync({
        organizationId,
        name: automationSlug,
        version,
        message:
          message.trim() === ''
            ? t('restore.defaultMessage', { version })
            : message,
        baseVersion: onTopOf,
      })
      .then(
        (result) => {
          onClose();
          if (result.unchanged === true) {
            toast({
              title: t('restore.toast.unchanged', {
                latest: result.version,
                version,
              }),
            });
          } else {
            toast({
              title: t('restore.toast.saved', {
                next: result.version,
                version,
              }),
              variant: 'success',
              duration: RESTORE_TOAST_MS,
              action: (
                <ToastPrimitives.Action
                  altText={t('restore.toast.open', { next: result.version })}
                  asChild
                  onClick={() =>
                    void navigate(
                      editorVersionLink({
                        organizationId,
                        automationSlug,
                        projectId,
                        version: result.version,
                      }),
                    )
                  }
                >
                  <Button type="button" variant="secondary" size="sm">
                    {t('restore.toast.open', { next: result.version })}
                  </Button>
                </ToastPrimitives.Action>
              ),
            });
          }
          if (deployNow && result.version !== liveVersion) {
            deployer.deploy(result.version, liveVersion);
          }
        },
        (error: unknown) => {
          const newer = automationVersionStale(error);
          if (newer !== undefined && newer.version !== null) {
            setBase(newer.version);
            setStale(newer);
            return;
          }
          const issues = automationErrorIssues(error);
          if (
            issues !== undefined ||
            automationErrorCode(error) === 'AUTOMATION_INVALID'
          ) {
            setInvalid(issues?.errors ?? []);
            return;
          }
          setFailure(automationErrorMessage(error));
        },
      );
  };

  const staleSentence = (() => {
    if (stale === null || staleLatest === null) return null;
    const author =
      stale.by === null
        ? { who: 'other' as const, author: t('versions.author.someone') }
        : authorText({
            actor: stale.by,
            via: stale.via,
            clientName: stale.client,
          }).subject;
    return t('restore.stale', { ...author, latest: staleLatest });
  })();

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // A restore in flight cannot be backed out of.
        if (!open && !restore.isPending) onClose();
      }}
      title={t('restore.title', { version })}
      size="md"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            disabled={restore.isPending}
            onClick={onClose}
          >
            {tCommon('actions.cancel')}
          </Button>
          {invalid === null && (
            <Button
              type="button"
              isLoading={restore.isPending}
              onClick={submit}
            >
              {staleLatest === null
                ? t('restore.confirm')
                : t('restore.staleConfirm', { latest: staleLatest })}
            </Button>
          )}
          {invalid !== null && (
            <Button
              type="button"
              onClick={() =>
                void navigate(
                  editorVersionLink({
                    organizationId,
                    automationSlug,
                    projectId,
                    version,
                  }),
                )
              }
            >
              {t('deploy.refused.openInEditor', { version })}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Text>
          {t('restore.body', {
            version,
            next,
            from: version + 1,
            to: base,
            count: Math.max(base - version, 1),
          })}
          {!deployNow && <> {t('restore.liveStays')}</>}
        </Text>
        {staleSentence !== null && (
          <Alert variant="warning" description={staleSentence} />
        )}
        {invalid !== null && (
          <>
            <Alert
              variant="destructive"
              description={t('restore.invalid', { version })}
            />
            {invalidItems.length > 0 && (
              <IssueList
                issues={invalidItems}
                density="compact"
                aria-label={t('restore.title', { version })}
              />
            )}
          </>
        )}
        {failure !== null && (
          <Alert
            variant="destructive"
            title={t('restore.failed', { version })}
            description={failure}
          />
        )}
        <Field label={t('detail.saveMessageLabel')} htmlFor={messageId}>
          <Input
            id={messageId}
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
            }}
          />
        </Field>
        {canDeploy && (
          <Checkbox
            label={t('restore.deployNow', { next })}
            checked={deployNow}
            onCheckedChange={(checked) => setDeployNow(checked === true)}
          />
        )}
      </div>
    </Dialog>
  );
}
