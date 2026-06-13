'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { PageSection } from '@tale/ui/page-section';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { Text } from '@tale/ui/text';
import { AlertTriangle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import {
  useJsonConfigEditor,
  useRegisterActiveEditor,
} from '@/app/components/ui/editor';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { useListAgents } from '@/app/features/agents/hooks/queries';
import { useListProviders } from '@/app/features/settings/providers/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { resolveAgentLocale } from '@/lib/shared/utils/resolve-agent-locale';
import { resolveModelLocale } from '@/lib/shared/utils/resolve-provider-locale';
import { structuralEqual } from '@/lib/utils/structural-equal';

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

/** Staged agent/model access settings — edited locally, persisted on Save. */
interface AgentsModelsForm {
  agentMode: 'recommended' | 'restricted';
  agentList: string[];
  modelMode: 'recommended' | 'restricted';
  modelList: string[];
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

  // Single source-of-truth list per category. In `restricted` mode the
  // canonical list lives in the allowed array (matches the legacy storage);
  // in `recommended` mode it lives in the recommended array. Legacy `'all'`
  // rows map to `'recommended'` (empty list = nothing pinned, same access).
  const data = useMemo<AgentsModelsForm | undefined>(() => {
    if (!project) return undefined;
    const agentMode: ProjectModeRadioValue =
      project.agentMode === 'restricted' ? 'restricted' : 'recommended';
    const modelMode: ProjectModeRadioValue =
      project.modelMode === 'restricted' ? 'restricted' : 'recommended';
    return {
      agentMode,
      agentList:
        agentMode === 'restricted'
          ? (project.allowedAgentSlugs ?? [])
          : (project.recommendedAgentSlugs ?? []),
      modelMode,
      modelList:
        modelMode === 'restricted'
          ? (project.allowedModels ?? [])
          : (project.recommendedModels ?? []),
    };
  }, [project]);

  // Last-saved baseline, used inside `save` to skip the mutation for the
  // category that didn't change (each mutation is a separate write).
  const baselineRef = useRef(data);

  const save = useCallback(
    async (next: AgentsModelsForm) => {
      const base = baselineRef.current;
      const agentChanged =
        !base ||
        base.agentMode !== next.agentMode ||
        !structuralEqual(base.agentList, next.agentList);
      const modelChanged =
        !base ||
        base.modelMode !== next.modelMode ||
        !structuralEqual(base.modelList, next.modelList);
      try {
        if (agentChanged) {
          await updateAgents({
            projectId,
            agentMode: next.agentMode,
            recommendedAgentSlugs: next.agentList,
            // Mirror into the allowed slot only when restricted, so the
            // server-side gate sees the same set as the UI's single list.
            allowedAgentSlugs:
              next.agentMode === 'restricted' ? next.agentList : [],
          });
        }
        if (modelChanged) {
          await updateModels({
            projectId,
            modelMode: next.modelMode,
            recommendedModels: next.modelList,
            allowedModels:
              next.modelMode === 'restricted' ? next.modelList : [],
          });
        }
        toast({ title: t('agents.saveSuccess'), variant: 'success' });
      } catch (error) {
        console.error('updateProject agent/model settings failed', error);
        toast({ title: t('agents.saveError'), variant: 'destructive' });
        throw error;
      }
    },
    [projectId, t, updateAgents, updateModels],
  );

  const editor = useJsonConfigEditor<AgentsModelsForm>({ initial: data, save });

  // Keep the baseline pointed at the latest saved value for the diff above.
  useEffect(() => {
    baselineRef.current = editor.savedConfig;
  }, [editor.savedConfig]);

  // Surface this editor to the project layout's Save/Discard cluster.
  useRegisterActiveEditor(editor);

  const config = editor.config;
  if (!project || !config) return null;
  const canEdit = project.canEdit;
  const fieldsDisabled = !canEdit || editor.isSaving;

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
    (config.agentMode === 'restricted' && config.agentList.length === 0) ||
    (config.modelMode === 'restricted' && config.modelList.length === 0);

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('agents.agentsHeading')}
        description={t('agents.sectionDescription')}
      />

      <FormSection>
        <ProjectModeRadio
          value={config.agentMode}
          onChange={(next) => editor.updateConfig({ agentMode: next })}
          options={modeOptions}
          disabled={fieldsDisabled}
          legend={t('agents.agentsHeading')}
        />

        <ProjectSlugListEditor
          value={config.agentList}
          onChange={(next) => editor.updateConfig({ agentList: next })}
          options={agentOptions}
          addLabel={t('agents.addAgent')}
          mode={config.agentMode}
          disabled={fieldsDisabled}
        />
      </FormSection>

      <PageSection
        title={t('agents.modelsHeading')}
        gap={6}
        className="mt-8 border-t pt-8"
      >
        <FormSection>
          <ProjectModeRadio
            value={config.modelMode}
            onChange={(next) => editor.updateConfig({ modelMode: next })}
            options={modeOptions}
            disabled={fieldsDisabled}
            legend={t('agents.modelsHeading')}
          />

          <ProjectSlugListEditor
            value={config.modelList}
            onChange={(next) => editor.updateConfig({ modelList: next })}
            options={modelOptions}
            addLabel={t('agents.addModel')}
            mode={config.modelMode}
            disabled={fieldsDisabled}
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
