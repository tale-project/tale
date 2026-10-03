'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { DeleteDialog } from '@tale/ui/dialog/delete-dialog';
import { EmptyState } from '@tale/ui/empty-state';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { toast } from '@tale/ui/use-toast';
import { Bot, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import { useDeleteProjectAgent } from '../hooks/mutations';
import {
  type ProjectAgentRow,
  useProject,
  useProjectAgents,
  useProjectCapabilityCatalog,
  useProjectHarnesses,
  useStandardAgent,
} from '../hooks/queries';
import { toModelOptions, type ModelOption } from '../lib/model-options';
import { type HarnessOption, ProjectAgentDialog } from './project-agent-dialog';
import {
  ProjectAgentRowsSkeleton,
  ProjectAgentsFrame,
  ProjectAgentsSkeleton,
} from './project-tab-skeletons';

interface ProjectAgentsTabProps {
  organizationId: string;
  projectId: string;
}

/**
 * The project's agents — user-created, named workers. Each one runs on a
 * harness with the skills/connectors and instructions picked at creation;
 * tasks assign work to them. The harness roster and the capability catalog
 * come from the same org-scoped composer actions, so the surfaces can never
 * drift. (The fixed per-harness equipment list this tab used to be is
 * retired — equipment now travels with the agent instance.)
 *
 * The organization's standard agent shows here too once someone handed the
 * project work: marked, and without Edit — its runtime, model and
 * instructions follow the organization's settings. Editors may remove it.
 * A project without agents says the standard agent takes its tasks, while
 * the organization provides one.
 */
export function ProjectAgentsTab({
  organizationId,
  projectId,
}: ProjectAgentsTabProps) {
  const { t } = useT('projects');
  const { project, isLoading: projectLoading } = useProject(projectId);
  const rosterQuery = useProjectHarnesses(organizationId);
  const catalogQuery = useProjectCapabilityCatalog(organizationId, projectId);
  const { agents, isLoading: agentsLoading } = useProjectAgents(projectId);
  const standardAgentAvailable =
    useStandardAgent(organizationId)?.available === true;
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
  // One option per (provider, model) pair, exactly as the listing carries
  // them: the dialog stores the PAIR (`model` + `modelProvider`), so two
  // providers serving the same id stay separately pickable — collapsing them
  // was how a pick silently landed on the wrong provider's bill.
  const modelRows = rosterQuery.data?.models;
  const models = useMemo<readonly ModelOption[]>(
    () => toModelOptions(modelRows ?? []),
    [modelRows],
  );
  const harnessBySlug = useMemo(() => {
    const map = new Map<string, HarnessOption>();
    for (const option of harnesses) map.set(option.harness, option);
    return map;
  }, [harnesses]);
  // Slug → display name for the row captions; falls back to the raw slug for
  // a provider that dropped out of the listing since the agent was saved.
  const providerLabelBySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of models)
      map.set(option.providerSlug, option.providerLabel);
    return map;
  }, [models]);

  if (!project) return projectLoading ? <ProjectAgentsSkeleton /> : null;

  const skills = catalogQuery.data?.skills;
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
      toast({
        title: t('agents.deleteError'),
        description: failureDetail(error),
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const newAgentButton = (
    <Button variant="secondary" size="sm" icon={Plus} onClick={openCreate}>
      {t('agents.newAgent')}
    </Button>
  );

  return (
    <ProjectAgentsFrame
      action={canEdit ? newAgentButton : undefined}
      reader={!canEdit}
    >
      {agentsLoading && agents.length === 0 ? (
        <ProjectAgentRowsSkeleton canEdit={canEdit} />
      ) : agents.length === 0 ? (
        // Adding an agent is the editors'. A reader is told who can, not to
        // "give one a model" on a page that offers them no way to — and,
        // while the organization provides one, that its standard agent
        // takes the project's tasks meanwhile.
        <EmptyState
          icon={Bot}
          title={t(
            standardAgentAvailable
              ? 'agents.standard.emptyTitle'
              : canEdit
                ? 'agents.emptyTitle'
                : 'agents.emptyReaderTitle',
          )}
          description={t(
            standardAgentAvailable
              ? canEdit
                ? 'agents.standard.emptyBody'
                : 'agents.standard.emptyReaderBody'
              : canEdit
                ? 'agents.emptyBody'
                : 'agents.emptyReaderBody',
          )}
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
                      <Row align="center" gap={2} className="min-w-0">
                        <Text className="truncate font-medium">
                          {agent.name}
                        </Text>
                        {agent.managed && (
                          <Badge variant="outline" className="shrink-0">
                            {t('agents.standard.badge')}
                          </Badge>
                        )}
                      </Row>
                      <Text
                        variant="caption"
                        className="text-muted-foreground truncate"
                      >
                        {option?.label ?? agent.harness}
                        {agent.modelProvider !== undefined
                          ? ` · ${providerLabelBySlug.get(agent.modelProvider) ?? agent.modelProvider}`
                          : ''}
                        {agent.model !== undefined ? ` · ${agent.model}` : ''}
                        {equipped > 0
                          ? ` · ${t('agents.equippedCount', { count: equipped })}`
                          : ''}
                      </Text>
                      {agent.managed && (
                        <Text
                          variant="caption"
                          className="text-muted-foreground"
                        >
                          {t('agents.standard.managedNote')}
                        </Text>
                      )}
                    </Stack>
                  </Row>
                  {canEdit ? (
                    <Row gap={1} className="shrink-0">
                      {/* The standard agent's settings are the
                          organization's: removable here, not editable. */}
                      {!agent.managed && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('agents.rowEdit')}
                          onClick={() => openEdit(agent)}
                        >
                          <Pencil aria-hidden className="size-4" />
                        </Button>
                      )}
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
        organizationId={organizationId}
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
    </ProjectAgentsFrame>
  );
}
