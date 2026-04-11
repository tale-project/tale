'use client';

import { useState, useCallback, useMemo } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useT } from '@/lib/i18n/client';

import type { PromptTemplate } from '../hooks/queries';

type PromptScope = 'global' | 'team' | 'personal';

interface PromptFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: PromptFormData) => void;
  isSubmitting: boolean;
  initialData?: PromptTemplate;
}

export interface PromptFormData {
  title: string;
  content: string;
  description: string;
  scope: PromptScope;
  teamId?: string;
  category: string;
  tags: string[];
}

function PromptFormDialogContent({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
  initialData,
}: PromptFormDialogProps) {
  const { t } = useT('prompts');
  const { teams } = useTeams();

  const [title, setTitle] = useState(initialData?.title ?? '');
  const [content, setContent] = useState(initialData?.content ?? '');
  const [description, setDescription] = useState(
    initialData?.description ?? '',
  );
  const [scope, setScope] = useState<PromptScope>(
    initialData?.scope ?? 'personal',
  );
  const [teamId, setTeamId] = useState(initialData?.teamId);
  const [category, setCategory] = useState(initialData?.category ?? '');
  const [tagsInput, setTagsInput] = useState(
    initialData?.tags?.join(', ') ?? '',
  );

  const teamOptions = useMemo(
    () =>
      (teams ?? []).map((team) => ({
        value: team.id,
        label: team.name,
      })),
    [teams],
  );

  const isDirty =
    title !== (initialData?.title ?? '') ||
    content !== (initialData?.content ?? '') ||
    description !== (initialData?.description ?? '') ||
    scope !== (initialData?.scope ?? 'personal') ||
    teamId !== initialData?.teamId ||
    category !== (initialData?.category ?? '') ||
    tagsInput !== (initialData?.tags?.join(', ') ?? '');

  const isValid =
    title.trim().length > 0 &&
    content.trim().length > 0 &&
    (scope !== 'team' || !!teamId);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!isValid) return;

      const tags = tagsInput
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);

      onSubmit({
        title: title.trim(),
        content: content.trim(),
        description: description.trim(),
        scope,
        teamId: scope === 'team' ? teamId : undefined,
        category: category.trim(),
        tags,
      });
    },
    [
      title,
      content,
      description,
      scope,
      teamId,
      category,
      tagsInput,
      isValid,
      onSubmit,
    ],
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initialData ? t('form.editTitle') : t('form.createTitle')}
      description={
        initialData ? t('form.editDescription') : t('form.createDescription')
      }
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
      isDirty={isDirty && isValid}
      submitText={initialData ? t('form.save') : t('form.create')}
      large
    >
      <Input
        label={t('form.titleLabel')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('form.titlePlaceholder')}
        required
        aria-required
      />
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={t('form.contentPlaceholder')}
        className="min-h-[120px] font-mono text-sm"
        required
        aria-required
        aria-label={t('form.contentLabel')}
      />
      <Input
        label={t('form.descriptionLabel')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t('form.descriptionPlaceholder')}
      />
      <fieldset>
        <legend className="mb-2 text-sm font-medium">
          {t('form.scopeLabel')}
        </legend>
        <div className="flex gap-3" role="radiogroup">
          {(['personal', 'team', 'global'] as const).map((s) => (
            <label
              key={s}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="radio"
                name="scope"
                value={s}
                checked={scope === s}
                onChange={() => setScope(s)}
                className="accent-primary"
              />
              {t(`scope.${s}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {scope === 'team' && teamOptions.length > 0 && (
        <Select
          label={t('form.teamLabel')}
          options={teamOptions}
          value={teamId ?? ''}
          onValueChange={(v) => setTeamId(v || undefined)}
          placeholder={t('form.teamPlaceholder')}
          required
        />
      )}
      <Input
        label={t('form.categoryLabel')}
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder={t('form.categoryPlaceholder')}
      />
      <Input
        label={t('form.tagsLabel')}
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
        placeholder={t('form.tagsPlaceholder')}
      />
    </FormDialog>
  );
}

export function PromptFormDialog(props: PromptFormDialogProps) {
  if (!props.open) return null;
  return <PromptFormDialogContent {...props} />;
}
