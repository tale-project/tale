'use client';

import { Button } from '@tale/ui/button';
import { useMemo, useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import { useSubmitRecordForReview } from '../hooks/mutations';

interface DocumentRecordSubmitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  documentName?: string | null;
  organizationId: string;
}

function DocumentRecordSubmitDialogContent({
  open,
  onOpenChange,
  documentId,
  documentName,
  organizationId,
}: DocumentRecordSubmitDialogProps) {
  const { t: tDocuments } = useT('documents');
  const { t: tCommon } = useT('common');
  const { members } = useMembers(organizationId);
  const submit = useSubmitRecordForReview();
  const [reviewerUserId, setReviewerUserId] = useState<string | null>(null);

  const options = useMemo<SearchableSelectOption[]>(
    () =>
      (members ?? [])
        .filter((member) => member.role !== 'disabled')
        .map((member) => {
          const option: SearchableSelectOption = {
            value: member.userId,
            label: member.displayName ?? member.email ?? member.userId,
          };
          if (member.email !== undefined) option.description = member.email;
          return option;
        }),
    [members],
  );

  const handleSubmit = async () => {
    if (reviewerUserId === null) return;
    try {
      await submit.mutateAsync({
        documentId: toId<'documents'>(documentId),
        reviewerUserId,
      });
      toast({
        title: tDocuments('record.toast.submitted'),
        variant: 'success',
      });
      setReviewerUserId(null);
      onOpenChange(false);
    } catch (error) {
      console.error('[documents] submit record for review failed', error);
      toast({
        title: tDocuments('record.toast.submitFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={tDocuments('record.submit.title')}
      description={
        documentName ? (
          <span className="break-all">{documentName}</span>
        ) : undefined
      }
      footerClassName="px-6 pt-4 pb-5"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={submit.isPending}
          >
            {tCommon('actions.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submit.isPending || reviewerUserId === null}
          >
            {tDocuments('record.submit.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-1.5 px-6 pt-2 pb-4">
        <SearchableSelect
          value={reviewerUserId}
          onValueChange={setReviewerUserId}
          options={options}
          label={tDocuments('record.submit.reviewerLabel')}
          placeholder={tDocuments('record.submit.reviewerPlaceholder')}
          searchPlaceholder={tDocuments('record.submit.reviewerSearch')}
          emptyText={tCommon('search.noResults')}
          description={tDocuments('record.submit.freezeHint')}
          required
        />
      </div>
    </Dialog>
  );
}

/**
 * "Submit for review" step of the controlled-record lifecycle: pick the
 * named human reviewer, then freeze the draft (draft → in_review). A plain
 * org-member select — the tasks ReviewerPicker is project/task-coupled
 * (actor directory + editor-role filter), so it is not reused here.
 *
 * Mounted only while open (the DocumentTeamTagsDialog pattern): the content
 * holds live queries (org member directory), which must not subscribe once
 * per table row, and Radix keeps closed dialogs mounted through animations.
 */
export function DocumentRecordSubmitDialog(
  props: DocumentRecordSubmitDialogProps,
) {
  if (!props.open) {
    return null;
  }
  return <DocumentRecordSubmitDialogContent {...props} />;
}
