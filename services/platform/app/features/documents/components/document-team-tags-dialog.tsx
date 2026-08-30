'use client';

import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import { Settings, Users } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Label } from '@/app/components/ui/forms/label';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useUpdateDocument, useUpdateFolderTeams } from '../hooks/mutations';
import { TeamMultiSelect } from './team-multi-select';

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

  // A document/folder can belong to multiple teams (backend stores teamIds as
  // an array). Edit the full set here so re-assigning doesn't silently drop the
  // other teams (#1325). An empty selection means org-wide.
  const initialTeamIds = useMemo(() => currentTeamIds ?? [], [currentTeamIds]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>(
    () => currentTeamIds ?? [],
  );
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
      const teamIds = selectedTeamIds;

      if (entityType === 'folder') {
        await updateFolderTeams.mutateAsync({
          folderId: entityId,
          teamIds,
        });
      } else {
        await updateDocument.mutateAsync({
          documentId: entityId,
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
    selectedTeamIds,
    updateDocument,
    updateFolderTeams,
    onOpenChange,
    tDocuments,
  ]);

  const hasChanges =
    selectedTeamIds.length !== initialTeamIds.length ||
    selectedTeamIds.some((id) => !initialTeamIds.includes(id));

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

  return (
    <Dialog
      open={open}
      onOpenChange={handleClose}
      title={tDocuments('teamTags.title')}
      // break-all so a long file name with no spaces wraps instead of
      // overflowing the dialog header (#1324).
      description={
        displayName ? (
          <span className="break-all">{displayName}</span>
        ) : undefined
      }
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
        <Row gap={0} justify="center" className="py-8">
          <Text as="span" variant="muted">
            {tCommon('actions.loading')}
          </Text>
        </Row>
      ) : !hasTeams ? (
        <EmptyState
          icon={Users}
          title={tDocuments('teamTags.noTeamsTitle')}
          description={tDocuments('teamTags.noTeamsDescription')}
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={handleGoToSettings}
            >
              <Settings className="size-3.5" aria-hidden="true" />
              {tDocuments('teamTags.goToSettings')}
            </Button>
          }
          className="py-8"
        />
      ) : (
        <div className="space-y-1.5 px-6 pt-2 pb-4">
          <Label>{tDocuments('teamTags.team')}</Label>
          <TeamMultiSelect
            teams={teams ?? []}
            selectedTeamIds={selectedTeamIds}
            onSelectionChange={setSelectedTeamIds}
            orgWideLabel={tDocuments('teamTags.orgWide')}
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
