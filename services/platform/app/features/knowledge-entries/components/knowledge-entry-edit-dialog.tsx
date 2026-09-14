'use client';

import { FormDialog } from '@tale/ui/dialog/form-dialog';

import { useT } from '@/lib/i18n/client';

import type { KnowledgeEntryItem } from '../hooks/queries';
import {
  KnowledgeEntryEditFields,
  useKnowledgeEntryEditForm,
} from './knowledge-entry-edit-form';

interface EditKnowledgeEntryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  entry: KnowledgeEntryItem;
}

export function EditKnowledgeEntryDialog({
  isOpen,
  onClose,
  entry,
}: EditKnowledgeEntryDialogProps) {
  const { t } = useT('knowledgeEntries');
  const { register, errors, isPending, reset, submit } =
    useKnowledgeEntryEditForm(entry, onClose);

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      title={t('editEntry')}
      submittingText={t('saving')}
      isSubmitting={isPending}
      size="default"
      onSubmit={submit}
    >
      <KnowledgeEntryEditFields
        register={register}
        errors={errors}
        disabled={isPending}
      />
    </FormDialog>
  );
}
