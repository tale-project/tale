'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { AlertTriangle } from 'lucide-react';
import { useCallback, useId, useMemo, useRef, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { HStack } from '@/app/components/ui/layout/layout';
import { Tabs } from '@/app/components/ui/navigation/tabs';
import { Text } from '@/app/components/ui/typography/text';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import {
  MAX_PROMPT_CATEGORY_LEN,
  MAX_PROMPT_CONTENT_BYTES,
  MAX_PROMPT_DESCRIPTION_LEN,
  MAX_PROMPT_TAG_LEN,
  MAX_PROMPT_TAGS_COUNT,
  MAX_PROMPT_TITLE_LEN,
} from '@/convex/prompts/constants';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { PromptTemplate } from '../hooks/queries';
import { usePrompt, usePrompts } from '../hooks/queries';
import { AddCategoryPopover } from './add-category-popover';
import { TagChipInput } from './tag-chip-input';

type PromptScope = 'global' | 'team' | 'personal';

interface PromptFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: PromptFormData) => void;
  isSubmitting: boolean;
  initialData?: PromptTemplate;
  /** When true, the "global" scope tab is selectable. */
  isOrgAdmin?: boolean;
  /** Optional render slot above the form (e.g. "View history" link). */
  headerActions?: React.ReactNode;
}

export interface PromptFormData {
  title: string;
  content: string;
  description: string;
  scope: PromptScope;
  teamId?: string;
  category: string;
  tags: string[];
  /** Version the form was opened against. Server uses this for OCC. */
  expectedVersion?: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function PromptFormDialogContent({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
  initialData,
  isOrgAdmin = false,
  headerActions,
}: PromptFormDialogProps) {
  const { t } = useT('prompts');
  const { teams } = useTeams();
  const organizationId = useOrganizationId();
  const { prompts } = usePrompts(organizationId ?? '');

  const initialTags = useMemo(
    () => initialData?.tags ?? [],
    [initialData?.tags],
  );

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
  const [tags, setTags] = useState(initialTags);
  const [localCategories, setLocalCategories] = useState<string[]>([]);

  const contentId = useId();
  const bytesId = `${contentId}-bytes`;
  const bytesErrorId = `${contentId}-bytes-error`;

  const isEditing = !!initialData;

  // OCC banner: watch live server state for the prompt being edited, compare
  // against the version the form was opened with. If a concurrent writer
  // saves a newer version, surface a warning so the user knows their save
  // will be rejected with version_conflict. The outer <PromptFormDialog>
  // unmounts the content on close, so the ref is freshly captured each time
  // the dialog opens — no re-anchor needed.
  const startVersionRef = useRef(initialData?.version);

  const liveQuery = usePrompt(isEditing ? initialData?._id : undefined);
  const live = liveQuery.data;
  const liveVersion = live?.version;
  const hasNewerVersion =
    isEditing &&
    typeof startVersionRef.current === 'number' &&
    typeof liveVersion === 'number' &&
    liveVersion > startVersionRef.current;

  const handleLoadLatest = useCallback(() => {
    if (!live) return;
    setTitle(live.title);
    setContent(live.content);
    setDescription(live.description ?? '');
    setScope(live.scope);
    setTeamId(live.teamId);
    setCategory(live.category ?? '');
    setTags(live.tags ?? []);
    startVersionRef.current = live.version;
  }, [live]);

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

  // Lock the "global" scope tab for non-admins. Existing globally-scoped
  // prompts stay editable but no one can promote a personal/team prompt to
  // global without admin rights.
  const scopeTabItems = [
    { value: 'personal', label: t('scope.personal') },
    { value: 'team', label: t('scope.team') },
    {
      value: 'global',
      label: t('scope.global'),
      disabled: !isOrgAdmin && scope !== 'global',
    },
  ];

  // Server measures the trimmed content (size_guards.assertPromptSizes) — mirror
  // that here so trailing whitespace doesn't block submit on a value the server
  // would accept.
  const contentBytes = useMemo(
    () => new TextEncoder().encode(content.trim()).byteLength,
    [content],
  );
  const overByteLimit = contentBytes > MAX_PROMPT_CONTENT_BYTES;
  const approachingLimit =
    !overByteLimit && contentBytes >= MAX_PROMPT_CONTENT_BYTES * 0.9;

  const tagsEqual = (a: string[], b: string[]): boolean => {
    if (a.length !== b.length) return false;
    return a.every((tag, i) => tag === b[i]);
  };

  const isDirty =
    title !== (initialData?.title ?? '') ||
    content !== (initialData?.content ?? '') ||
    description !== (initialData?.description ?? '') ||
    scope !== (initialData?.scope ?? 'personal') ||
    teamId !== initialData?.teamId ||
    category !== (initialData?.category ?? '') ||
    !tagsEqual(tags, initialTags);

  // Block submit while OCC banner is showing — the user must Load latest
  // first (which re-anchors startVersionRef so hasNewerVersion flips false).
  const isValid =
    title.trim().length > 0 &&
    content.trim().length > 0 &&
    !overByteLimit &&
    (scope !== 'team' || !!teamId) &&
    !hasNewerVersion;

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!isValid || isSubmitting) return;

      onSubmit({
        title: title.trim(),
        content: content.trim(),
        description: description.trim(),
        scope,
        teamId: scope === 'team' ? teamId : undefined,
        category: category.trim(),
        tags,
        expectedVersion: startVersionRef.current,
      });
    },
    [
      title,
      content,
      description,
      scope,
      teamId,
      category,
      tags,
      isValid,
      isSubmitting,
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
      title={isEditing ? t('form.editTitle') : t('form.createTitle')}
      description={
        isEditing ? t('form.editDescription') : t('form.createDescription')
      }
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      isValid={isValid}
      confirmDiscardOnDirty
      submitText={isEditing ? t('form.save') : t('form.create')}
      large
    >
      {isEditing && (
        <HStack gap={2} align="center" justify="between">
          <HStack gap={2} align="center">
            {initialData?.version !== undefined && (
              <Badge
                variant="outline"
                aria-label={t('version.badge', {
                  version: String(initialData.version),
                })}
              >
                {t('version.badge', { version: initialData.version })}
              </Badge>
            )}
          </HStack>
          {headerActions}
        </HStack>
      )}
      {hasNewerVersion && (
        <div
          role="alert"
          className="border-warning bg-warning/10 text-warning-foreground flex items-start gap-2 rounded-md border p-3 text-sm"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <div className="flex-1">
            <div className="font-medium">{t('form.versionConflictTitle')}</div>
            <Text variant="muted" className="mt-0.5 text-xs">
              {t('form.versionConflictDescription', {
                version: String(liveVersion),
              })}
            </Text>
            {isDirty && (
              <Text variant="muted" className="mt-0.5 text-xs">
                {t('form.versionConflictDirtyWarning')}
              </Text>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant={isDirty ? 'destructive' : 'secondary'}
            onClick={handleLoadLatest}
            disabled={!live}
          >
            {t('form.loadLatest')}
          </Button>
        </div>
      )}
      <Input
        label={t('form.titleLabel')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('form.titlePlaceholder')}
        maxLength={MAX_PROMPT_TITLE_LEN}
        required
        aria-required
      />
      <div className="flex flex-col gap-1">
        <Textarea
          id={contentId}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t('form.contentPlaceholder')}
          className="min-h-[120px] font-mono text-sm"
          required
          aria-required
          aria-label={t('form.contentLabel')}
          aria-describedby={`${bytesId}${overByteLimit ? ` ${bytesErrorId}` : ''}`}
          aria-invalid={overByteLimit || undefined}
        />
        <Text
          id={bytesId}
          variant="muted"
          className={cn(
            'text-right text-xs',
            overByteLimit && 'text-destructive',
            approachingLimit && 'text-warning-foreground',
          )}
          aria-live="polite"
        >
          {t('form.bytesUsed', {
            used: formatBytes(contentBytes),
            max: formatBytes(MAX_PROMPT_CONTENT_BYTES),
          })}
        </Text>
        {overByteLimit && (
          <Text
            id={bytesErrorId}
            role="alert"
            className="text-destructive text-right text-xs"
          >
            {t('form.bytesOverLimitAlert')}
          </Text>
        )}
      </div>
      <Input
        label={t('form.descriptionLabel')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t('form.descriptionPlaceholder')}
        maxLength={MAX_PROMPT_DESCRIPTION_LEN}
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
            maxLength={MAX_PROMPT_CATEGORY_LEN}
          />
        )}
      </div>
      <TagChipInput
        value={tags}
        onChange={setTags}
        maxTags={MAX_PROMPT_TAGS_COUNT}
        maxTagLength={MAX_PROMPT_TAG_LEN}
        label={t('form.tagsLabel')}
        placeholder={t('form.tagsPlaceholder')}
      />
    </FormDialog>
  );
}

export function PromptFormDialog(props: PromptFormDialogProps) {
  if (!props.open) return null;
  return <PromptFormDialogContent {...props} />;
}
