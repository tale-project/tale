'use client';

import { useState, useCallback, useMemo } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { HStack } from '@/app/components/ui/layout/layout';
import { Tabs } from '@/app/components/ui/navigation/tabs';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useT } from '@/lib/i18n/client';

import type { PromptTemplate } from '../hooks/queries';
import { usePrompts } from '../hooks/queries';
import { AddCategoryPopover } from './add-category-popover';

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
  const organizationId = useOrganizationId();
  const { prompts } = usePrompts(organizationId ?? '');

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
  const [localCategories, setLocalCategories] = useState<string[]>([]);

  const existingCategories = useMemo(() => {
    const fromPrompts = prompts
      .map((p) => p.category)
      .filter((c): c is string => !!c);
    const merged = [...new Set([...fromPrompts, ...localCategories])];
    return merged.sort((a, b) => a.localeCompare(b));
  }, [prompts, localCategories]);

  const categoryOptions = useMemo(
    () => existingCategories.map((c) => ({ value: c, label: c })),
    [existingCategories],
  );

  const teamOptions = useMemo(
    () =>
      (teams ?? []).map((team) => ({
        value: team.id,
        label: team.name,
      })),
    [teams],
  );

  const scopeTabItems = [
    { value: 'personal', label: t('scope.personal') },
    { value: 'team', label: t('scope.team') },
    { value: 'global', label: t('scope.global') },
  ];

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

  const handleAddCategory = useCallback((newCategory: string) => {
    setLocalCategories((prev) => [...new Set([...prev, newCategory])]);
    setCategory(newCategory);
  }, []);

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
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">{t('form.scopeLabel')}</label>
        <Tabs
          items={scopeTabItems}
          value={scope}
          onValueChange={(v) => {
            if (v === 'global' || v === 'team' || v === 'personal') setScope(v);
          }}
        />
      </div>
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
      <div className="flex flex-col gap-2">
        <HStack justify="between" align="center">
          <label className="text-sm font-medium">
            {t('form.categoryLabel')}
          </label>
          <AddCategoryPopover
            existingCategories={existingCategories}
            onAddCategory={handleAddCategory}
          />
        </HStack>
        {categoryOptions.length > 0 ? (
          <Select
            options={categoryOptions}
            value={category}
            onValueChange={setCategory}
            placeholder={t('form.categoryPlaceholder')}
          />
        ) : (
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={t('form.categoryPlaceholder')}
          />
        )}
      </div>
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
