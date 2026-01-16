'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { FormDialog } from '@/components/ui/dialog/form-dialog';
import { Checkbox } from '@/components/ui/forms/checkbox';
import { Stack } from '@/components/ui/layout/layout';
import { Users } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { useOrganizationId } from '@/hooks/use-organization-id';

interface DocumentTeamTagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  documentName?: string | null;
  currentTeamTags?: string[];
}

export function DocumentTeamTagsDialog({
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
  const updateDocument = useMutation(api.documents.updateDocument);

  // Fetch only teams that the current user belongs to
  const teamsResult = useQuery(
    api.member.getMyTeams,
    open && organizationId ? { organizationId } : 'skip',
  );
  const teams = teamsResult?.teams ?? null;
  const isLoading = teamsResult === undefined && open;

  // Reset selection when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedTeams(new Set(currentTeamTags));
    }
  }, [open, currentTeamTags]);

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

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
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
  }, [documentId, selectedTeams, updateDocument, tDocuments, onOpenChange]);

  // Check if there are any changes
  const hasChanges = useMemo(() => {
    const currentSet = new Set(currentTeamTags);
    if (currentSet.size !== selectedTeams.size) return true;
    for (const teamId of selectedTeams) {
      if (!currentSet.has(teamId)) return true;
    }
    return false;
  }, [currentTeamTags, selectedTeams]);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={tDocuments('teamTags.title')}
      submitText={tCommon('actions.save')}
      submittingText={tCommon('actions.saving')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
      submitDisabled={!hasChanges}
    >
      <Stack gap={4}>
        {documentName && (
          <p className="text-sm text-muted-foreground">
            {tDocuments('teamTags.description', { name: documentName })}
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
            {teams.map((team) => (
              <label
                key={team.id}
                className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 cursor-pointer transition-colors"
              >
                <Checkbox
                  checked={selectedTeams.has(team.id)}
                  onCheckedChange={() => handleToggleTeam(team.id)}
                />
                <span className="text-sm font-medium">{team.name}</span>
              </label>
            ))}
          </Stack>
        )}

        <p className="text-xs text-muted-foreground">
          {tDocuments('teamTags.hint')}
        </p>
      </Stack>
    </FormDialog>
  );
}
