'use client';

import { useNavigate } from '@tanstack/react-router';
import { Settings, Users } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { EmptyState } from '@/app/components/ui/feedback/empty-state';
import { Select } from '@/app/components/ui/forms/select';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import { useUpdateDocument, useUpdateFolderTeams } from '../hooks/mutations';

const ORG_WIDE_VALUE = '__org_wide__';

type EntityType = 'file' | 'folder';

interface DocumentTeamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string;
  entityType?: EntityType;
  documentName?: string | null;
  currentTeamIds?: string[];
}

/**
 * Internal content component containing all hooks.
 * IMPORTANT: This component must only be rendered when the dialog is open.
 * Rendering it during Radix UI's closing animation causes "Maximum update depth exceeded"
 * errors due to hooks triggering re-renders during the animation phase.
 */
function DocumentTeamDialogContent({
  open,
  onOpenChange,
  entityId,
  entityType = 'file',
  documentName,
  currentTeamIds,
}: DocumentTeamDialogProps) {
  const { t: tDocuments } = useT('documents');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();
  const organizationId = useOrganizationId();

  const currentTeamId = currentTeamIds?.[0] ?? ORG_WIDE_VALUE;
  const [selectedTeamId, setSelectedTeamId] = useState(currentTeamId);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateDocument = useUpdateDocument();
  const updateFolderTeams = useUpdateFolderTeams();
  const { teams, isLoading } = useTeams();

  const hasTeams = teams && teams.length > 0;

  const handleClose = useCallback(() => {
    if (!isSubmitting) {
      onOpenChange(false);
    }
  }, [isSubmitting, onOpenChange]);

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);

    try {
      const teamIds =
        selectedTeamId && selectedTeamId !== ORG_WIDE_VALUE
          ? [selectedTeamId]
          : [];

      if (entityType === 'folder') {
        await updateFolderTeams.mutateAsync({
          folderId: toId<'folders'>(entityId),
          teamIds,
        });
      } else {
        await updateDocument.mutateAsync({
          documentId: toId<'documents'>(entityId),
          teamIds,
        });
      }

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
  }, [
    entityId,
    entityType,
    selectedTeamId,
    updateDocument,
    updateFolderTeams,
    onOpenChange,
    tDocuments,
  ]);

  const hasChanges = selectedTeamId !== currentTeamId;

  const displayName = useMemo(() => {
    if (!documentName) return '';
    const parts = documentName.split('/');
    return parts[parts.length - 1] || documentName;
  }, [documentName]);

  const handleGoToSettings = useCallback(() => {
    if (!organizationId) return;
    onOpenChange(false);
    void navigate({
      to: '/dashboard/$id/settings/teams',
      params: { id: organizationId },
    });
  }, [organizationId, onOpenChange, navigate]);

  const teamOptions = useMemo(
    () => [
      { value: ORG_WIDE_VALUE, label: tDocuments('teamTags.orgWide') },
      ...(teams ?? []).map((team) => ({ value: team.id, label: team.name })),
    ],
    [teams, tDocuments],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={handleClose}
      title={tDocuments('teamTags.title')}
      description={displayName || undefined}
      footerClassName="px-6 pt-4 pb-5"
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
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Text as="span" variant="muted">
            {tCommon('actions.loading')}
          </Text>
        </div>
      ) : !hasTeams ? (
        <EmptyState
          icon={Users}
          title={tDocuments('teamTags.noTeamsTitle')}
          description={tDocuments('teamTags.noTeamsDescription')}
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleGoToSettings}
            >
              <Settings className="size-3.5" aria-hidden="true" />
              {tDocuments('teamTags.goToSettings')}
            </Button>
          }
          className="py-8"
        />
      ) : (
        <div className="px-6 pt-2 pb-4">
          <Select
            id="team-assignment"
            label={tDocuments('teamTags.team')}
            placeholder={tDocuments('teamTags.orgWide')}
            value={selectedTeamId}
            onValueChange={setSelectedTeamId}
            options={teamOptions}
            disabled={isSubmitting}
          />
        </div>
      )}
    </Dialog>
  );
}

/**
 * Dialog for managing team assignment on a document or folder.
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
