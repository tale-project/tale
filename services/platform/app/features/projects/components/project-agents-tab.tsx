'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { PageSection } from '@tale/ui/page-section';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { Text } from '@tale/ui/text';
import { AlertTriangle } from 'lucide-react';
import { useMemo } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { useListAgents } from '@/app/features/agents/hooks/queries';
import { useListProviders } from '@/app/features/settings/providers/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { resolveAgentLocale } from '@/lib/shared/utils/resolve-agent-locale';
import { resolveModelLocale } from '@/lib/shared/utils/resolve-provider-locale';

import {
  useUpdateProjectAgentSettings,
  useUpdateProjectModelSettings,
} from '../hooks/mutations';
import { useProject } from '../hooks/queries';
import {
  ProjectModeRadio,
  type ProjectModeRadioValue,
} from './project-mode-radio';
import {
  ProjectSlugListEditor,
  type SlugOption,
} from './project-slug-list-editor';

interface ProjectAgentsTabProps {
  organizationId: string;
  projectId: Id<'projects'>;
}

/**
 * Humanize an agent slug for display when the catalog entry carries no
 * localized `displayName` (e.g. system agents like `image-generator`).
 * Trims provider qualifier suffixes, splits on dash/underscore, and
 * title-cases each token.
 */
function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function ProjectAgentsTab({
  organizationId,
  projectId,
}: ProjectAgentsTabProps) {
  const { t } = useT('projects');
  const { locale } = useLocale();
  const { project } = useProject(projectId);
  const { mutateAsync: updateAgents } = useUpdateProjectAgentSettings();
  const { mutateAsync: updateModels } = useUpdateProjectModelSettings();
  const { agents: rawAgents } = useListAgents(organizationId);
  const { providers } = useListProviders(organizationId);

  const agentOptions = useMemo<SlugOption[]>(() => {
    if (!rawAgents) return [];
    const out: SlugOption[] = [];
    for (const a of rawAgents) {
      if (!a || typeof a.name !== 'string' || 'status' in a) continue;
      const resolved = resolveAgentLocale(a, locale);
      // Some system agents (e.g. `image-generator`) carry no localized
      // displayName — fall back to a humanized slug rather than dropping
      // them from the picker, otherwise admins can't restrict/recommend
      // them at all.
      const label =
        resolved.displayName && resolved.displayName.length > 0
          ? resolved.displayName
          : humanizeSlug(a.name);
      out.push({
        value: a.name,
        label,
        description: resolved.description,
      });
    }
    return out;
  }, [rawAgents, locale]);

  const modelOptions = useMemo<SlugOption[]>(() => {
    const out: SlugOption[] = [];
    for (const provider of providers) {
      if (
        !provider ||
        !('models' in provider) ||
        !Array.isArray(provider.models)
      )
        continue;
      for (const model of provider.models) {
        const resolved = resolveModelLocale(model, provider.i18n, locale);
        out.push({
          value: `${provider.name}:${model.id}`,
          label: resolved.displayName || model.displayName,
          description: provider.name,
        });
      }
    }
    return out;
  }, [providers, locale]);

  if (!project) return null;
  const canEdit = project.canEdit;

  // The model is now a single ordered list per category; the mode picks how
  // it behaves. Legacy `'all'` rows map to `'recommended'` (empty list =
  // nothing pinned, same effective access).
  const agentMode: ProjectModeRadioValue =
    project.agentMode === 'restricted' ? 'restricted' : 'recommended';
  const modelMode: ProjectModeRadioValue =
    project.modelMode === 'restricted' ? 'restricted' : 'recommended';

  // Single source-of-truth list per category. In `restricted` mode the
  // canonical list lives in the allowed array (matches the legacy storage);
  // in `recommended` mode it lives in the recommended array.
  const agentList =
    agentMode === 'restricted'
      ? (project.allowedAgentSlugs ?? [])
      : (project.recommendedAgentSlugs ?? []);
  const modelList =
    modelMode === 'restricted'
      ? (project.allowedModels ?? [])
      : (project.recommendedModels ?? []);

  const saveAgents = async (
    nextMode: 'recommended' | 'restricted',
    nextList: string[],
  ) => {
    try {
      await updateAgents({
        projectId,
        agentMode: nextMode,
        recommendedAgentSlugs: nextList,
        // Mirror into the allowed slot only when restricted, so the
        // server-side gate sees the same set as the UI's single list.
        allowedAgentSlugs: nextMode === 'restricted' ? nextList : [],
      });
      toast({ title: t('agents.saveSuccess'), variant: 'success' });
    } catch (error) {
      console.error('updateProjectAgentSettings failed', error);
      toast({ title: t('agents.saveError'), variant: 'destructive' });
    }
  };

  const saveModels = async (
    nextMode: 'recommended' | 'restricted',
    nextList: string[],
  ) => {
    try {
      await updateModels({
        projectId,
        modelMode: nextMode,
        recommendedModels: nextList,
        allowedModels: nextMode === 'restricted' ? nextList : [],
      });
      toast({ title: t('agents.saveSuccess'), variant: 'success' });
    } catch (error) {
      console.error('updateProjectModelSettings failed', error);
      toast({ title: t('agents.saveError'), variant: 'destructive' });
    }
  };

  const modeOptions = [
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

  const showLockoutWarning =
    (agentMode === 'restricted' && agentList.length === 0) ||
    (modelMode === 'restricted' && modelList.length === 0);

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('agents.agentsHeading')}
        description={t('agents.sectionDescription')}
      />

      <FormSection>
        <ProjectModeRadio
          value={agentMode}
          onChange={(next) => void saveAgents(next, agentList)}
          options={modeOptions}
          disabled={!canEdit}
          legend={t('agents.agentsHeading')}
        />

        <ProjectSlugListEditor
          value={agentList}
          onChange={(next) => void saveAgents(agentMode, next)}
          options={agentOptions}
          addLabel={t('agents.addAgent')}
          mode={agentMode}
          disabled={!canEdit}
        />
      </FormSection>

      <PageSection
        title={t('agents.modelsHeading')}
        gap={6}
        className="mt-8 border-t pt-8"
      >
        <FormSection>
          <ProjectModeRadio
            value={modelMode}
            onChange={(next) => void saveModels(next, modelList)}
            options={modeOptions}
            disabled={!canEdit}
            legend={t('agents.modelsHeading')}
          />

          <ProjectSlugListEditor
            value={modelList}
            onChange={(next) => void saveModels(modelMode, next)}
            options={modelOptions}
            addLabel={t('agents.addModel')}
            mode={modelMode}
            disabled={!canEdit}
          />
        </FormSection>
      </PageSection>

      {showLockoutWarning ? (
        <div
          role="note"
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-amber-600"
            aria-hidden="true"
          />
          <Text variant="caption" className="text-amber-700">
            {t('agents.lockoutWarning')}
          </Text>
        </div>
      ) : null}
    </ContentArea>
  );
}
