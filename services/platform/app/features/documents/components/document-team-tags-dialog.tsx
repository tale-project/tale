'use client';

import { Users } from 'lucide-react';
import { useState, useMemo } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { EmptyState } from '@/app/components/ui/feedback/empty-state';
import { Select } from '@/app/components/ui/forms/select';
import { Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import { useUpdateDocument } from '../hooks/mutations';

interface DocumentTeamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  documentName?: string | null;
  currentTeamId?: string | null;
}

const ORG_WIDE_VALUE = '__org_wide__';

/**
 * Internal content component containing all hooks.
 * IMPORTANT: This component must only be rendered when the dialog is open.
 * Rendering it during Radix UI's closing animation causes "Maximum update depth exceeded"
 * errors due to hooks triggering re-renders during the animation phase.
 */
function DocumentTeamDialogContent({
  open,
  onOpenChange,
  documentId,
  documentName,
  currentTeamId,
}: DocumentTeamDialogProps) {
  const { t: tDocuments } = useT('documents');
  const { t: tCommon } = useT('common');

  const [selectedValue, setSelectedValue] = useState<string>(
    () => currentTeamId ?? ORG_WIDE_VALUE,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateDocument = useUpdateDocument();
  const { teams, isLoading } = useTeams();

  const teamOptions = useMemo(() => {
    const items = [
      { value: ORG_WIDE_VALUE, label: tDocuments('teamTags.orgWide') },
    ];
    if (teams) {
      for (const team of teams) {
        items.push({ value: team.id, label: team.name });
      }
    }
    return items;
  }, [teams, tDocuments]);

  const handleClose = () => {
    if (!isSubmitting) {
      onOpenChange(false);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);

    try {
      const newTeamId = selectedValue === ORG_WIDE_VALUE ? null : selectedValue;

      await updateDocument.mutateAsync({
        documentId: toId<'documents'>(documentId),
        teamId: newTeamId,
      });

      toast({
        title: tDocuments('teamTags.updated'),
        variant: 'success',
      });

      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast({
        title: tDocuments('teamTags.updateFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasChanges = useMemo(() => {
    const currentValue = currentTeamId ?? ORG_WIDE_VALUE;
    return currentValue !== selectedValue;
  }, [currentTeamId, selectedValue]);

  const displayName = useMemo(() => {
    if (!documentName) return '';
    const parts = documentName.split('/');
    return parts[parts.length - 1] || documentName;
  }, [documentName]);

  return (
    <Dialog
      open={open}
      onOpenChange={handleClose}
      title={tDocuments('teamTags.title')}
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            {tCommon('actions.cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !hasChanges}
          >
            {isSubmitting ? tCommon('actions.saving') : tCommon('actions.save')}
          </Button>
        </>
      }
    >
      <Stack gap={4} className="min-w-0">
        {documentName && (
          <Text variant="muted" className="wrap-break-word">
            {tDocuments('teamTags.description', { name: displayName })}
          </Text>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Text as="span" variant="muted">
              {tCommon('actions.loading')}
            </Text>
          </div>
        ) : !teams || teams.length === 0 ? (
          <EmptyState
            icon={Users}
            title={tDocuments('teamTags.noTeams')}
            className="py-8"
          />
        ) : (
          <Select
            options={teamOptions}
            value={selectedValue}
            onValueChange={setSelectedValue}
            label={tDocuments('teamTags.selectLabel')}
          />
        )}

        <Text variant="caption">{tDocuments('teamTags.hint')}</Text>
      </Stack>
    </Dialog>
  );
}

/**
 * Dialog for managing team assignment on a document.
 *
 * CRITICAL: This wrapper pattern prevents "Maximum update depth exceeded" errors.
 * Radix UI Dialog keeps components mounted during closing animations.
 *
 * DO NOT refactor this to render DocumentTeamDialogContent unconditionally.
 * See: https://github.com/radix-ui/primitives/issues/3675
 */
export function DocumentTeamTagsDialog(props: DocumentTeamDialogProps) {
  if (!props.open) {
    return null;
  }

  return <DocumentTeamDialogContent {...props} />;
}
