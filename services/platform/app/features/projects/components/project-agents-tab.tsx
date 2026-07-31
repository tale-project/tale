'use client';

import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { Row, Stack } from '@tale/ui/layout';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { Text } from '@tale/ui/text';
import { Bot, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useDeleteProjectAgent } from '../hooks/mutations';
import {
  type ProjectAgentRow,
  useProject,
  useProjectAgents,
  useProjectCapabilityCatalog,
  useProjectHarnesses,
} from '../hooks/queries';
import { type HarnessOption, ProjectAgentDialog } from './project-agent-dialog';

interface ProjectAgentsTabProps {
  organizationId: string;
  projectId: Id<'projects'>;
}

/**
 * The project's agents — user-created, named workers. Each one runs on a
 * harness with the skills/connectors and instructions picked at creation;
 * tasks assign work to them. The harness roster and the capability catalog
 * come from the same org-scoped composer actions, so the surfaces can never
 * drift. (The fixed per-harness equipment list this tab used to be is
 * retired — equipment now travels with the agent instance.)
 */
export function ProjectAgentsTab({
  organizationId,
  projectId,
}: ProjectAgentsTabProps) {
  const { t } = useT('projects');
  const { project } = useProject(projectId);
  const rosterQuery = useProjectHarnesses(organizationId);
  const catalogQuery = useProjectCapabilityCatalog(organizationId, projectId);
  const { agents } = useProjectAgents(projectId);
  const { mutateAsync: deleteAgent } = useDeleteProjectAgent();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectAgentRow | undefined>(
    undefined,
  );
  const [deleting, setDeleting] = useState<ProjectAgentRow | undefined>(
    undefined,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const harnessRoster = rosterQuery.data?.harnesses;
  const harnesses: readonly HarnessOption[] = useMemo(
    () => harnessRoster ?? [],
    [harnessRoster],
  );
  // The listing carries one entry per (provider, model) pair; the dialog's
  // Select keys options by model id alone (an instance stores just the model
  // — its serving provider resolves at run time), so dedupe here.
  const modelRows = rosterQuery.data?.models;
  const models = useMemo(() => {
    const seen = new Set<string>();
    return (modelRows ?? []).filter((model) => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });
  }, [modelRows]);
  const harnessBySlug = useMemo(() => {
    const map = new Map<string, HarnessOption>();
    for (const option of harnesses) map.set(option.harness, option);
    return map;
  }, [harnesses]);

  if (!project) return null;

  const skills = catalogQuery.data?.skills ?? [];
  const connectors = catalogQuery.data?.connectors ?? [];
  const canEdit = project.canEdit;

  const openCreate = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };
  const openEdit = (agent: ProjectAgentRow) => {
    setEditing(agent);
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      await deleteAgent({ agentId: deleting._id });
      toast({ title: t('agents.deleteSuccess'), variant: 'success' });
      setDeleting(undefined);
    } catch (error) {
      console.error('deleteProjectAgent failed', error);
      toast({ title: t('agents.deleteError'), variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  const newAgentButton = (
    <Button size="sm" onClick={openCreate}>
      <Plus aria-hidden className="size-4" />
      {t('agents.newAgent')}
    </Button>
  );

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('agents.agentsHeading')}
        description={t('agents.sectionDescription')}
        action={canEdit ? newAgentButton : undefined}
      />

      {agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title={t('agents.emptyTitle')}
          description={t('agents.emptyBody')}
        />
      ) : (
        <Stack as="ul" gap={2}>
          {agents.map((agent) => {
            const option = harnessBySlug.get(agent.harness);
            const equipped = agent.skills.length + agent.connectors.length;
            return (
              <li key={agent._id}>
                <Row
                  justify="between"
                  align="center"
                  gap={3}
                  className="rounded-md border p-3"
                >
                  <Row align="center" gap={3} className="min-w-0">
                    {option?.iconUrl !== undefined ? (
                      <img
                        src={option.iconUrl}
                        alt=""
                        className="size-6 shrink-0 rounded-sm"
                      />
                    ) : (
                      <Bot
                        aria-hidden
                        className="text-muted-foreground size-6 shrink-0"
                      />
                    )}
                    <Stack gap={1} className="min-w-0">
                      <Text className="truncate font-medium">{agent.name}</Text>
                      <Text
                        variant="caption"
                        className="text-muted-foreground truncate"
                      >
                        {option?.label ?? agent.harness}
                        {agent.model !== undefined ? ` · ${agent.model}` : ''}
                        {equipped > 0
                          ? ` · ${t('agents.equippedCount', { count: equipped })}`
                          : ''}
                      </Text>
                    </Stack>
                  </Row>
                  {canEdit ? (
                    <Row gap={1} className="shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('agents.rowEdit')}
                        onClick={() => openEdit(agent)}
                      >
                        <Pencil aria-hidden className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('agents.rowDelete')}
                        onClick={() => setDeleting(agent)}
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </Button>
                    </Row>
                  ) : null}
                </Row>
              </li>
            );
          })}
        </Stack>
      )}

      <ProjectAgentDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(undefined);
        }}
        projectId={projectId}
        harnesses={harnesses}
        models={models}
        skills={skills}
        connectors={connectors}
        {...(editing !== undefined ? { agent: editing } : {})}
      />

      <DeleteDialog
        open={deleting !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        title={t('agents.deleteTitle')}
        description={t('agents.deleteBody', { name: deleting?.name ?? '' })}
        isDeleting={isDeleting}
        onDelete={() => void handleDelete()}
      />
    </ContentArea>
  );
}
