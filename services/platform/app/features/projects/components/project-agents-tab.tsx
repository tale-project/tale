'use client';

import { Row, Stack } from '@tale/ui/layout';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { Text } from '@tale/ui/text';
import { useCallback } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useSetProjectAgentCapabilities } from '../hooks/mutations';
import {
  useProject,
  useProjectCapabilityCatalog,
  useProjectExternalAgents,
} from '../hooks/queries';
import {
  type AgentCapabilityBinding,
  ProjectAgentCapabilityMenu,
} from './project-agent-capability-menu';

interface ProjectAgentsTabProps {
  organizationId: string;
  projectId: Id<'projects'>;
}

const EMPTY_BINDING: AgentCapabilityBinding = { skills: [], connectors: [] };

/**
 * The project's per-agent equipment. The agent set is fixed — the same
 * third-party agents (sandbox harnesses) chat offers — and this page
 * binds each one to the skills and connectors it runs with IN THIS PROJECT.
 * The persistent, project-scoped analog of the chat composer's per-turn
 * capability assembly: what a member picks here is what that agent shows up
 * pre-equipped with for everyone in the project.
 *
 * The catalog (which skills/connectors exist, connectors gated on an active
 * org credential) comes from the same org-scoped composer actions chat reads,
 * so the two surfaces can never drift. Each change saves immediately, one
 * agent at a time — there is no staged Save/Discard here.
 */
export function ProjectAgentsTab({
  organizationId,
  projectId,
}: ProjectAgentsTabProps) {
  const { t } = useT('projects');
  const { project } = useProject(projectId);
  const agentsQuery = useProjectExternalAgents(organizationId);
  const catalogQuery = useProjectCapabilityCatalog(organizationId);
  const { mutateAsync: setCapabilities } = useSetProjectAgentCapabilities();

  const save = useCallback(
    async (agentId: string, next: AgentCapabilityBinding) => {
      try {
        await setCapabilities({
          projectId,
          agentId,
          skills: [...next.skills],
          connectors: [...next.connectors],
        });
        toast({ title: t('agents.saveSuccess'), variant: 'success' });
      } catch (error) {
        console.error('setProjectAgentCapabilities failed', error);
        toast({ title: t('agents.saveError'), variant: 'destructive' });
      }
    },
    [projectId, setCapabilities, t],
  );

  if (!project) return null;

  const agents = agentsQuery.data?.externalAgents ?? [];
  const skills = catalogQuery.data?.skills ?? [];
  const connectors = catalogQuery.data?.connectors ?? [];
  const bindings = project.agentCapabilities ?? {};
  const canEdit = project.canEdit;

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('agents.agentsHeading')}
        description={t('agents.sectionDescription')}
      />

      {agents.length === 0 ? (
        <Text variant="caption" className="text-muted-foreground">
          {t('agents.noExternalAgents')}
        </Text>
      ) : (
        <Stack as="ul" gap={2}>
          {agents.map((agent) => {
            const binding = bindings[agent.harness] ?? EMPTY_BINDING;
            return (
              <li key={agent.harness}>
                <Row
                  justify="between"
                  align="center"
                  gap={3}
                  className="rounded-md border p-3"
                >
                  <Text className="truncate font-medium">{agent.label}</Text>
                  <ProjectAgentCapabilityMenu
                    skills={skills}
                    connectors={connectors}
                    value={binding}
                    onChange={(next) => void save(agent.harness, next)}
                    disabled={!canEdit}
                  />
                </Row>
              </li>
            );
          })}
        </Stack>
      )}
    </ContentArea>
  );
}
