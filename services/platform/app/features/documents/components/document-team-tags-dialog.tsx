'use client';

import { useState, useMemo, useCallback } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Button } from '@/app/components/ui/primitives/button';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Stack } from '@/app/components/ui/layout/layout';
import { Users } from 'lucide-react';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { useOrganizationId } from '@/app/hooks/use-organization-id';

interface DocumentTeamTagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  documentName?: string | null;
  currentTeamTags?: string[];
}

/**
 * Internal content component containing all hooks.
 * IMPORTANT: This component must only be rendered when the dialog is open.
 * Rendering it during Radix UI's closing animation causes "Maximum update depth exceeded"
 * errors due to hooks (useQuery, useMutation) triggering re-renders during the
 * animation phase. See the wrapper component below for the guard pattern.
 */
function DocumentTeamTagsDialogContent({
  open,
  onOpenChange,
  documentId,
  documentName,
  currentTeamTags = [],
}: DocumentTeamTagsDialogProps) {
  const { t: tDocuments } = useT('documents');
  const { t: tCommon } = useT('common');
  const organizationId = useOrganizationId();

  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(
    () => new Set(currentTeamTags),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Update document mutation
  const updateDocument = useMutation(api.documents.update_document_public.updateDocument);

  // Fetch only teams that the current user belongs to
  const teamsResult = useQuery(
    api.member.getMyTeams,
    organizationId ? { organizationId } : 'skip',
  );
  const teams = teamsResult?.teams ?? null;
  const isLoading = teamsResult === undefined;

  const handleToggleTeam = useCallback((teamId: string) => {
    setSelectedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  }, []);

  const handleClose = () => {
    if (!isSubmitting) {
      onOpenChange(false);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);

    try {
      await updateDocument({
        documentId: documentId as Id<'documents'>,
        teamTags: Array.from(selectedTeams),
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

  // Check if there are any changes
  const hasChanges = useMemo(() => {
    const currentSet = new Set(currentTeamTags);
    if (currentSet.size !== selectedTeams.size) return true;
    for (const teamId of selectedTeams) {
      if (!currentSet.has(teamId)) return true;
    }
    return false;
  }, [currentTeamTags, selectedTeams]);

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
            variant="outline"
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
          <p className="text-sm text-muted-foreground break-words">
            {tDocuments('teamTags.description', { name: displayName })}
          </p>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-muted-foreground">
              {tCommon('actions.loading')}
            </span>
          </div>
        ) : !teams || teams.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Users className="size-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">
              {tDocuments('teamTags.noTeams')}
            </p>
          </div>
        ) : (
          <Stack gap={2}>
            {teams.map((team: { id: string; name: string }) => (
              <div
                key={team.id}
                className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 cursor-pointer transition-colors"
              >
                <Checkbox
                  id={`team-tag-${team.id}`}
                  checked={selectedTeams.has(team.id)}
                  onCheckedChange={() => handleToggleTeam(team.id)}
                  label={team.name}
                />
              </div>
            ))}
          </Stack>
        )}

        <p className="text-xs text-muted-foreground">
          {tDocuments('teamTags.hint')}
        </p>
      </Stack>
    </Dialog>
  );
}

/**
 * Dialog for managing team tags on a document.
 *
 * CRITICAL: This wrapper pattern prevents "Maximum update depth exceeded" errors.
 * Radix UI Dialog keeps components mounted during closing animations. When hooks
 * (useQuery, useMutation) run during this phase, they trigger state updates that
 * conflict with Radix's usePresence hook, causing infinite re-render loops.
 *
 * The fix: Return null when closed to fully unmount the content component,
 * ensuring hooks don't execute during animations.
 *
 * DO NOT refactor this to render DocumentTeamTagsDialogContent unconditionally.
 * See: https://github.com/radix-ui/primitives/issues/3675
 */
export function DocumentTeamTagsDialog(props: DocumentTeamTagsDialogProps) {
  if (!props.open) {
    return null;
  }

  return <DocumentTeamTagsDialogContent {...props} />;
}
