import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { CopyableField } from '@tale/ui/copyable-field';
import { EntityViewDialog } from '@tale/ui/entity/entity-view-dialog';
import { Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import type { RefObject } from 'react';

import { readFailureText } from '@/app/lib/api/failure';
import type { SecretField, SecretSummary } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { useSecret } from '../hooks/use-secret';
import { useSecretLabels } from '../hooks/use-secret-labels';
import { KIND_ICONS } from '../lib/kinds';
import { SecretFormDialog } from './secret-form-dialog';

/**
 * A value of the secret in the read dialog, under its label. A hidden one is
 * not in the page at all until it is shown (dots stand for it, whatever its
 * length); copying it never shows it. Every value shows whole: a long answer
 * wraps, a note keeps its lines.
 */
function SecretValue({ field }: { field: SecretField }) {
  const { t } = useT('secrets');
  const labels = useSecretLabels();
  const label = labels.field(field.label);
  return (
    <CopyableField
      label={label}
      value={field.value}
      mono={false}
      wrap
      masked={field.hidden}
      hiddenLabel={t('view.hidden')}
      revealLabels={{
        show: t('row.show', { label }),
        hide: t('row.hide', { label }),
      }}
      copyAriaLabel={t('row.copy', { label })}
      copiedLabel={t('row.copied', { label })}
    />
  );
}

interface SecretViewDialogProps {
  secret: SecretSummary;
  /** Called with false when the dialog is dismissed (or the secret was changed). */
  onOpenChange: (open: boolean) => void;
  /**
   * Where the focus goes when the dialog closes, for a dialog opened from a
   * menu item (gone by then). The form Edit hands over to gets it too: the
   * details that come back after it was cancelled have forgotten who asked.
   */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * The read dialog of a secret: each value under its label, hidden ones behind
 * a button, every value with a copy button. The whole secret is fetched when
 * the dialog opens. Edit hands the dialog over to the form and, once saved,
 * closes both.
 */
export function SecretViewDialog({
  secret: summary,
  onOpenChange,
  restoreFocusRef,
}: SecretViewDialogProps) {
  const { t } = useT('secrets');
  const { t: tErrors } = useT('errors');
  const labels = useSecretLabels();
  const query = useSecret(summary.id);
  const secret = query.data;

  return (
    <EntityViewDialog
      open
      onOpenChange={onOpenChange}
      restoreFocusRef={restoreFocusRef}
      title={t('view.title')}
      name={summary.title}
      icon={KIND_ICONS[summary.kind]}
      summary={labels.summary(summary)}
      edit={
        secret === undefined
          ? undefined
          : {
              label: t('actions.edit'),
              render: ({ onBack, onDone }) => (
                <SecretFormDialog
                  target={{ type: 'edit', secret: summary }}
                  onOpenChange={(open) => {
                    if (!open) onBack();
                  }}
                  onSaved={onDone}
                  restoreFocusRef={restoreFocusRef}
                />
              ),
            }
      }
      content={
        secret !== undefined ? (
          <Stack gap={4}>
            {secret.fields.map((field, index) => (
              // Labels are not unique: a secret may hold two of one name.
              <SecretValue key={`${index}-${field.label}`} field={field} />
            ))}
          </Stack>
        ) : query.isError ? (
          <CatalogLoadError
            message={readFailureText(t('loadFailed'), query.error, tErrors)}
            onRetry={() => void query.refetch()}
            isRetrying={query.isFetching}
          />
        ) : (
          <Skeletonize loading>
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((row) => (
                <SkeletonBox key={row} fullWidth>
                  <div className="h-5" />
                </SkeletonBox>
              ))}
            </div>
          </Skeletonize>
        )
      }
    />
  );
}
