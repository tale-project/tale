'use client';

import { Heading } from '@tale/ui/heading';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import {
  useUpdateProjectAgentSettings,
  useUpdateProjectModelSettings,
} from '../hooks/mutations';
import { useProject } from '../hooks/queries';
import {
  ProjectModeRadio,
  type ProjectModeRadioValue,
} from './project-mode-radio';

interface ProjectAgentsTabProps {
  projectId: Id<'projects'>;
}

export function ProjectAgentsTab({ projectId }: ProjectAgentsTabProps) {
  const { t } = useT('projects');
  const { project } = useProject(projectId);
  const { mutateAsync: updateAgents } = useUpdateProjectAgentSettings();
  const { mutateAsync: updateModels } = useUpdateProjectModelSettings();

  const [agentMode, setAgentMode] = useState<ProjectModeRadioValue>(
    (project?.agentMode as ProjectModeRadioValue | undefined) ?? 'all',
  );
  const [modelMode, setModelMode] = useState<ProjectModeRadioValue>(
    (project?.modelMode as ProjectModeRadioValue | undefined) ?? 'all',
  );

  if (!project) return null;
  const canEdit = project.canEdit;

  const handleAgentModeChange = async (next: ProjectModeRadioValue) => {
    setAgentMode(next);
    if (!canEdit) return;
    try {
      await updateAgents({
        projectId,
        agentMode: next,
        recommendedAgentSlugs: project.recommendedAgentSlugs,
        allowedAgentSlugs: project.allowedAgentSlugs,
      });
      toast({ title: t('agents.saveSuccess'), variant: 'success' });
    } catch (error) {
      console.error('updateProjectAgentSettings failed', error);
      toast({ title: t('agents.saveError'), variant: 'destructive' });
    }
  };

  const handleModelModeChange = async (next: ProjectModeRadioValue) => {
    setModelMode(next);
    if (!canEdit) return;
    try {
      await updateModels({
        projectId,
        modelMode: next,
        recommendedModels: project.recommendedModels,
        allowedModels: project.allowedModels,
      });
      toast({ title: t('agents.saveSuccess'), variant: 'success' });
    } catch (error) {
      console.error('updateProjectModelSettings failed', error);
      toast({ title: t('agents.saveError'), variant: 'destructive' });
    }
  };

  const options = [
    {
      value: 'all' as const,
      label: t('agents.modeAll'),
      description: t('agents.modeAllDescription'),
    },
    {
      value: 'recommended' as const,
      label: t('agents.modeRecommended'),
      description: t('agents.modeRecommendedDescription'),
    },
    {
      value: 'restricted' as const,
      label: t('agents.modeRestricted'),
      description: t('agents.modeRestrictedDescription'),
    },
  ];

  return (
    <Stack gap={6} className="p-6">
      <section>
        <Heading level={2} size="base" className="mb-3">
          {t('agents.agentsHeading')}
        </Heading>
        <ProjectModeRadio
          value={agentMode}
          onChange={handleAgentModeChange}
          options={options}
          disabled={!canEdit}
          legend={t('agents.agentsHeading')}
        />
        {agentMode !== 'all' ? (
          <Text variant="caption" className="mt-3 text-amber-600">
            ⚠ {t('agents.lockoutWarning')}
          </Text>
        ) : null}
      </section>

      <section>
        <Heading level={2} size="base" className="mb-3">
          {t('agents.modelsHeading')}
        </Heading>
        <ProjectModeRadio
          value={modelMode}
          onChange={handleModelModeChange}
          options={options}
          disabled={!canEdit}
          legend={t('agents.modelsHeading')}
        />
      </section>
    </Stack>
  );
}
