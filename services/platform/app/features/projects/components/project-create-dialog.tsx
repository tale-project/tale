'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  deriveProjectKey,
  isValidProjectKey,
  normalizeProjectKey,
} from '@tale/shared/utils/project-key';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Textarea } from '@tale/ui/textarea';
import { useForm } from '@tale/ui/use-form';
import { toast } from '@tale/ui/use-toast';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod/v4';

import { TeamMultiSelect } from '@/app/features/documents/components/team-multi-select';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';
import { AppError } from '@/lib/shared/errors/app-error';

import { useCreateProject } from '../hooks/mutations';
import {
  ProjectIdentityPicker,
  type ProjectIdentityValue,
} from './project-identity-picker';

type FormData = {
  name: string;
  key: string;
  description?: string;
};

interface ProjectCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /**
   * Called with the new project's id right after creation (before the dialog
   * navigates to it). Lets a caller record local UI state for the new project
   * — e.g. the chat sidebar pre-expands its folder.
   */
  onCreated?: (projectId: string) => void;
  /**
   * Navigate to the new project's detail page after creation (default `true`).
   * Set `false` when the caller drives its own follow-up navigation — e.g. the
   * app-install flow creates a project, then routes into the app under it.
   */
  navigateOnCreate?: boolean;
}

export function ProjectCreateDialog({
  open,
  onOpenChange,
  organizationId,
  onCreated,
  navigateOnCreate = true,
}: ProjectCreateDialogProps) {
  const { t } = useT('projects');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();
  const { mutateAsync: createProject } = useCreateProject();
  // The audience: the teams the creator may assign (their own; every team
  // for an admin). Empty = organization-wide, the default — so Create waits
  // for this read: one that has not answered, or failed, is never an org
  // without teams, and creating then would open the project to everyone
  // without the creator ever seeing the choice.
  const {
    teams: assignableTeams,
    unavailable: teamsUnavailable,
    stale: teamsStale,
    retrying: teamsRetrying,
    failureCount: teamsFailures,
    retry: retryTeams,
  } = useOrgTeams();
  const teamsFailed = teamsUnavailable || teamsStale;
  const audienceReady = assignableTeams !== undefined && !teamsFailed;
  const [teamIds, setTeamIds] = useState<string[]>([]);
  // The icon/color pair lives beside the form like the audience does: it has
  // no native input, and `null` (the default folder / gray) sends nothing.
  const [identity, setIdentity] = useState<ProjectIdentityValue>({
    icon: null,
    color: null,
  });

  const formSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(
            1,
            tCommon('validation.required', {
              field: t('create.nameLabel'),
            }),
          )
          .max(80, t('errors.PROJECT_NAME_INVALID')),
        key: z
          .string()
          .trim()
          .refine((value) => isValidProjectKey(normalizeProjectKey(value)), {
            message: t('errors.PROJECT_KEY_INVALID'),
          }),
        description: z.string().trim().max(500).optional(),
      }),
    [t, tCommon],
  );

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { isSubmitting, errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', key: '', description: '' },
  });

  // The key auto-tracks the name (e.g. "Tale Platform" → "TAL") until the user
  // types in the key field — after that it's theirs to control.
  const keyEditedRef = useRef(false);
  const name = watch('name');
  useEffect(() => {
    if (!keyEditedRef.current) {
      setValue('key', deriveProjectKey(name), { shouldValidate: false });
    }
  }, [name, setValue]);

  useEffect(() => {
    if (!open) {
      reset();
      setTeamIds([]);
      setIdentity({ icon: null, color: null });
      keyEditedRef.current = false;
    }
  }, [open, reset]);

  const keyField = register('key');

  // Try again hands the focus to the picker once it is back — or to the
  // field above it when the answer leaves no team to pick.
  const focusAudience = () =>
    (
      document.getElementById('project-audience') ??
      document.getElementById('project-description')
    )?.focus();

  const onSubmit = async (data: FormData) => {
    // Create is disabled until the audience read answers; this also holds a
    // submit that reaches the form some other way.
    if (!audienceReady) return;
    try {
      const projectId = await createProject({
        organizationId,
        name: data.name,
        key: normalizeProjectKey(data.key),
        description: data.description || undefined,
        ...(identity.icon !== null ? { icon: identity.icon } : {}),
        ...(identity.color !== null ? { color: identity.color } : {}),
        ...(teamIds.length > 0 ? { teamIds } : {}),
      });
      toast({
        title: t('create.successToast'),
        variant: 'success',
      });
      onCreated?.(projectId);
      onOpenChange(false);
      if (navigateOnCreate) {
        void navigate({
          to: '/dashboard/$id/projects/$projectId/tasks',
          params: { id: organizationId, projectId: projectId },
        });
      }
    } catch (error) {
      if (error instanceof AppError) {
        const code = error.data?.code;
        if (code === 'PROJECT_NAME_INVALID') {
          setError('name', { message: t('errors.PROJECT_NAME_INVALID') });
          return;
        }
        if (code === 'PROJECT_KEY_INVALID') {
          setError('key', { message: t('errors.PROJECT_KEY_INVALID') });
          return;
        }
        if (code === 'PROJECT_KEY_TAKEN') {
          setError('key', { message: t('errors.PROJECT_KEY_TAKEN') });
          return;
        }
        if (code === 'RBAC_FORBIDDEN') {
          toast({
            title: t('errors.RBAC_FORBIDDEN'),
            variant: 'destructive',
          });
          return;
        }
        if (
          code === 'TEAM_ACCESS_DENIED' ||
          code === 'PROJECT_SHARING_INVALID'
        ) {
          toast({
            title: t('errors.' + code, {
              defaultValue: t('create.errorToast'),
            }),
            variant: 'destructive',
          });
          return;
        }
      }
      console.error('createProject failed', error);
      toast({
        title: t('create.errorToast'),
        description: failureDetail(error),
        variant: 'destructive',
      });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('create.title')}
      submitText={t('create.submit')}
      submittingText={t('create.submitting')}
      isSubmitting={isSubmitting}
      isValid={audienceReady}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="project-name"
        label={t('create.nameLabel')}
        placeholder={t('create.namePlaceholder')}
        required
        {...register('name')}
        errorMessage={errors.name?.message}
      />
      <Input
        id="project-key"
        label={t('create.keyLabel')}
        hint={t('create.keyDescription')}
        placeholder="TAL"
        maxLength={6}
        autoComplete="off"
        required
        {...keyField}
        onChange={(e) => {
          keyEditedRef.current = true;
          e.target.value = normalizeProjectKey(e.target.value);
          void keyField.onChange(e);
        }}
        errorMessage={errors.key?.message}
      />
      <div
        role="group"
        aria-labelledby="project-identity-label"
        className="flex flex-col gap-1.5"
      >
        <p id="project-identity-label" className="text-sm font-medium">
          {t('identity.label')}
        </p>
        <ProjectIdentityPicker
          name={name.trim().length > 0 ? name : t('create.nameLabel')}
          value={identity}
          onChange={setIdentity}
          disabled={isSubmitting}
        />
      </div>
      <Textarea
        id="project-description"
        label={t('create.descriptionLabel')}
        placeholder={t('create.descriptionPlaceholder')}
        required={false}
        rows={3}
        {...register('description')}
        errorMessage={errors.description?.message}
      />
      {/* A settled failed read, also while its retry runs, and a refresh that
          failed are named in the field's place; a pending read holds the
          field's place. Only an answered, empty list leaves the field out:
          organization-wide is then the creator's only choice. */}
      {teamsFailed ? (
        <div
          role="group"
          aria-labelledby="project-audience-label"
          className="flex flex-col gap-1.5"
        >
          <p id="project-audience-label" className="text-sm font-medium">
            {t('create.audienceLabel')}
          </p>
          <CatalogLoadError
            message={t('sharing.teamsLoadError')}
            failureKey={teamsFailures}
            isRetrying={teamsRetrying}
            onRetry={retryTeams}
            onFocusLost={focusAudience}
          />
        </div>
      ) : assignableTeams === undefined || assignableTeams.length > 0 ? (
        <Skeletonize loading={assignableTeams === undefined}>
          <TeamMultiSelect
            id="project-audience"
            label={t('create.audienceLabel')}
            description={t('create.audienceHelp')}
            teams={assignableTeams ?? []}
            selectedTeamIds={teamIds}
            onSelectionChange={setTeamIds}
            orgWideLabel={t('list.sharingOrgWide')}
            disabled={isSubmitting}
          />
        </Skeletonize>
      ) : null}
    </FormDialog>
  );
}
