import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { Skeletonize } from '@tale/ui/skeleton-context';
import type { RefObject } from 'react';

import { useMeta } from '@/app/hooks/use-meta';
import { readFailureText } from '@/app/lib/api/failure';
import type {
  SecretKind,
  SecretKindInfo,
  SecretSummary,
} from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { useSecret } from '../hooks/use-secret';
import { useSecretLabels } from '../hooks/use-secret-labels';
import { scopeOf } from '../lib/scope';
import type { SessionChoice } from '../lib/session-choices';
import { SecretForm } from './secret-form';

export type SecretFormTarget =
  | {
      type: 'create';
      /** The kind the form opens as. */
      kind: SecretKind;
      /** Who the secret is for when the form opens: `global` or a session's id. */
      scope: string;
      /**
       * The session `scope` names, when it names one: the select lists only
       * the newest sessions, and would show another's number for its name.
       */
      session?: SessionChoice;
    }
  | { type: 'edit'; secret: SecretSummary };

interface SecretFormDialogProps {
  target: SecretFormTarget;
  /** Called with false when the dialog is dismissed or the secret is saved. */
  onOpenChange: (open: boolean) => void;
  /** Called once the secret is saved, before the dialog closes. */
  onSaved?: () => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * The dialog to add a secret or to change one. Mount it while it is open: it
 * starts from what the person last saw, and drops it when it goes. Changing a
 * secret fetches the whole of it first (the list holds no hidden value), and
 * says so while it waits.
 */
export function SecretFormDialog({
  target,
  onOpenChange,
  onSaved,
  restoreFocusRef,
}: SecretFormDialogProps) {
  const meta = useMeta();
  const kinds = meta.data?.secretKinds;

  if (target.type === 'create' && kinds !== undefined) {
    return (
      <SecretForm
        mode="create"
        kinds={kinds}
        initialKind={target.kind}
        initialScope={target.scope}
        scopeSession={target.session}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
        restoreFocusRef={restoreFocusRef}
      />
    );
  }
  if (target.type === 'edit') {
    return (
      <EditSecretDialog
        summary={target.secret}
        kinds={kinds}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
        restoreFocusRef={restoreFocusRef}
      />
    );
  }
  return (
    <WaitingDialog
      kind={target.kind}
      failure={meta.error}
      onRetry={() => void meta.refetch()}
      retrying={meta.isFetching}
      onOpenChange={onOpenChange}
      restoreFocusRef={restoreFocusRef}
    />
  );
}

function EditSecretDialog({
  summary,
  kinds,
  onOpenChange,
  onSaved,
  restoreFocusRef,
}: {
  summary: SecretSummary;
  kinds: readonly SecretKindInfo[] | undefined;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}) {
  const query = useSecret(summary.id);
  if (query.data !== undefined && kinds !== undefined) {
    return (
      <SecretForm
        key={query.data.id}
        mode="edit"
        kinds={kinds}
        secret={query.data}
        initialKind={query.data.kind}
        initialScope={scopeOf(summary)}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
        restoreFocusRef={restoreFocusRef}
      />
    );
  }
  return (
    <WaitingDialog
      kind={summary.kind}
      title={summary.title}
      failure={query.error}
      onRetry={() => void query.refetch()}
      retrying={query.isFetching}
      onOpenChange={onOpenChange}
      restoreFocusRef={restoreFocusRef}
    />
  );
}

/**
 * The form's place while the secret (or the kinds' starting rows) is on its
 * way: the real fields, masked in place, with Save out of reach; or why they
 * did not come, and a way to ask again.
 */
function WaitingDialog({
  kind,
  title,
  failure,
  onRetry,
  retrying,
  onOpenChange,
  restoreFocusRef,
}: {
  kind: SecretKind;
  title?: string;
  failure: Error | null;
  onRetry: () => void;
  retrying: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { t } = useT('secrets');
  const { t: tErrors } = useT('errors');
  const { t: tCommon } = useT('common');
  const labels = useSecretLabels();
  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title={title === undefined ? t('form.createTitle') : t('form.editTitle')}
      description={title === undefined ? undefined : labels.kind(kind)}
      submitText={
        title === undefined ? t('form.createSubmit') : tCommon('actions.save')
      }
      size="entity"
      stickyFooter
      // Nothing to save yet: the button waits, out of reach, with the fields.
      isDirty={false}
      restoreFocusRef={restoreFocusRef}
      onSubmit={() => undefined}
    >
      {failure === null ? (
        <Skeletonize loading>
          <div className="flex flex-col gap-4">
            <Input label={t('form.title')} defaultValue={title ?? ''} />
            <Input label={t('scope.label')} defaultValue="" />
            {[0, 1, 2].map((row) => (
              <Input key={row} aria-label={t('form.values')} defaultValue="" />
            ))}
          </div>
        </Skeletonize>
      ) : (
        <CatalogLoadError
          message={readFailureText(
            // Adding a secret waits for the kinds, changing one for the secret.
            title === undefined ? t('kindsFailed') : t('loadFailed'),
            failure,
            tErrors,
          )}
          onRetry={onRetry}
          isRetrying={retrying}
        />
      )}
    </FormDialog>
  );
}
