'use client';

import { useNavigate } from '@tanstack/react-router';
import { Settings, Users } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { EmptyState } from '@/app/components/ui/feedback/empty-state';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useUpdateDocument } from '../hooks/mutations';

interface DocumentTeamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
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
  documentId,
  documentName,
  currentTeamIds,
}: DocumentTeamDialogProps) {
  const { t: tDocuments } = useT('documents');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();
  const organizationId = useOrganizationId();

  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(
    () => new Set(currentTeamIds ?? []),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateDocument = useUpdateDocument();
  const { teams, isLoading } = useTeams();

  const hasTeams = teams && teams.length > 0;

  const handleClose = useCallback(() => {
    if (!isSubmitting) {
      onOpenChange(false);
    }
  }, [isSubmitting, onOpenChange]);

  const isOrgWide = selectedTeamIds.size === 0;

  const handleSelectOrgWide = useCallback(() => {
    setSelectedTeamIds(new Set());
  }, []);

  const handleToggleTeam = useCallback((teamId: string) => {
    setSelectedTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);

    try {
      await updateDocument.mutateAsync({
        documentId: toId<'documents'>(documentId),
        teamIds: [...selectedTeamIds],
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
  }, [documentId, selectedTeamIds, updateDocument, onOpenChange, tDocuments]);

  const hasChanges = useMemo(() => {
    const currentSet = new Set(currentTeamIds ?? []);
    if (currentSet.size !== selectedTeamIds.size) return true;
    for (const id of currentSet) {
      if (!selectedTeamIds.has(id)) return true;
    }
    return false;
  }, [currentTeamIds, selectedTeamIds]);

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
      description={displayName || undefined}
      className="gap-0 p-0!"
      headerClassName="border-border border-b px-6 pt-5 pb-4"
      footerClassName="px-6 pt-4 pb-5"
      footer={
        hasTeams ? (
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
              {isSubmitting
                ? tCommon('actions.saving')
                : tCommon('actions.save')}
            </Button>
          </>
        ) : undefined
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
        <div className="flex min-w-0 flex-col gap-1 px-2 pt-2 pb-4">
          <div role="group" aria-label={tDocuments('teamTags.title')}>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={handleSelectOrgWide}
                disabled={isSubmitting}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-left transition-colors',
                  isOrgWide ? 'bg-muted' : 'hover:bg-muted/50',
                  isSubmitting && 'cursor-not-allowed opacity-50',
                )}
              >
                <Checkbox
                  checked={isOrgWide}
                  onCheckedChange={handleSelectOrgWide}
                  aria-label={tDocuments('teamTags.orgWide')}
                  tabIndex={-1}
                />
                <Text as="span" className="text-sm select-none">
                  {tDocuments('teamTags.orgWide')}
                </Text>
              </button>
              {teams.map((team) => {
                const isChecked = selectedTeamIds.has(team.id);
                return (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => handleToggleTeam(team.id)}
                    disabled={isSubmitting}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-left transition-colors',
                      isChecked ? 'bg-muted' : 'hover:bg-muted/50',
                      isSubmitting && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => handleToggleTeam(team.id)}
                      aria-label={team.name}
                      tabIndex={-1}
                    />
                    <Text as="span" className="text-sm select-none">
                      {team.name}
                    </Text>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
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
