'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { AlertTriangle } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { HStack } from '@/app/components/ui/layout/layout';
import { Tabs } from '@/app/components/ui/navigation/tabs';
import { Text } from '@/app/components/ui/typography/text';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useCurrentUser } from '@/app/hooks/use-current-user';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import type { Id } from '@/convex/_generated/dataModel';
import {
  MAX_PROMPT_CONTENT_BYTES,
  MAX_PROMPT_TAG_LEN,
  MAX_PROMPT_TAGS_COUNT,
  MAX_PROMPT_TITLE_LEN,
} from '@/convex/prompts/constants';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { PromptTemplate } from '../hooks/queries';
import { useCategories, usePrompt } from '../hooks/queries';
import { CategoryPickerPopover } from './category-picker-popover';
import { TagChipInput } from './tag-chip-input';

type PromptScope = 'global' | 'team' | 'personal';

// Positional tag equality. Mirrors `metadataDiffers` on the server so a
// reorder counts as an edit. Module-scope so it's a stable reference across
// renders and doesn't need to live in any callback's dep array.
function tagsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((tag, i) => tag === b[i]);
}

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
  /** Optional. When blank on create, the server generates an AI title. */
  title: string;
  content: string;
  scope: PromptScope;
  teamId?: string;
  /** Reference to a `promptCategories` row. `undefined` = no category. */
  categoryId?: Id<'promptCategories'>;
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
  const { data: currentUser } = useCurrentUser();
  const { data: categoriesData } = useCategories(organizationId);

  const initialTags = useMemo(
    () => initialData?.tags ?? [],
    [initialData?.tags],
  );

  const [title, setTitle] = useState(initialData?.title ?? '');
  const [content, setContent] = useState(initialData?.content ?? '');
  const [scope, setScope] = useState<PromptScope>(
    initialData?.scope ?? 'personal',
  );
  const [teamId, setTeamId] = useState(initialData?.teamId);
  const [categoryId, setCategoryId] = useState(initialData?.categoryId);
  const [tags, setTags] = useState(initialTags);

  const contentId = useId();
  const bytesId = `${contentId}-bytes`;
  const bytesErrorId = `${contentId}-bytes-error`;
  const categoryLabelId = useId();

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
    // Confirm before clobbering in-progress edits. `isDirty` is computed
    // below this callback (closure-captured at call time via the latest
    // `current` snapshots of state), so we re-check the relevant fields here
    // against the same baselines used by `isDirty` to avoid stale closure.
    const draftHasEdits =
      title !== (initialData?.title ?? '') ||
      content !== (initialData?.content ?? '') ||
      scope !== (initialData?.scope ?? 'personal') ||
      teamId !== initialData?.teamId ||
      categoryId !== initialData?.categoryId ||
      !tagsEqual(tags, initialTags);
    if (
      draftHasEdits &&
      !globalThis.confirm(t('form.versionConflictDiscardConfirm'))
    ) {
      return;
    }
    setTitle(live.title);
    setContent(live.content);
    setScope(live.scope);
    setTeamId(live.teamId);
    setCategoryId(live.categoryId);
    setTags(live.tags ?? []);
    startVersionRef.current = live.version;
  }, [
    live,
    title,
    content,
    scope,
    teamId,
    categoryId,
    tags,
    initialData,
    initialTags,
    t,
  ]);

  // The picker filters visible categories itself; the form's job is to
  // build the user's team-id set and, when scope/teamId changes, clear
  // `categoryId` if it isn't compatible with the new scope (silent
  // clear, matches the server's safety net). Using stable string-keys
  // for the effect deps so we don't re-run on every render.
  const userTeamIds = useMemo(
    () => (teams ?? []).map((team) => team.id),
    [teams],
  );

  // Map id -> category for quick lookup of the current selection's scope.
  const allVisibleCategories = useMemo(() => {
    if (!categoriesData) return new Map();
    const m = new Map<
      Id<'promptCategories'>,
      { scope: PromptScope; teamId?: string }
    >();
    for (const c of categoriesData.personal)
      m.set(c._id, { scope: c.scope, teamId: c.teamId });
    for (const c of categoriesData.team)
      m.set(c._id, { scope: c.scope, teamId: c.teamId });
    for (const c of categoriesData.global)
      m.set(c._id, { scope: c.scope, teamId: c.teamId });
    return m;
  }, [categoriesData]);

  useEffect(() => {
    if (!categoryId) return;
    const sel = allVisibleCategories.get(categoryId);
    if (!sel) {
      // Selection no longer visible (deleted, or scope flip made it
      // invisible) — clear silently.
      setCategoryId(undefined);
      return;
    }
    const compatible =
      sel.scope === 'global' ||
      (scope === 'personal' &&
        (sel.scope === 'personal' ||
          (sel.scope === 'team' &&
            !!sel.teamId &&
            userTeamIds.includes(sel.teamId)))) ||
      (scope === 'team' && sel.scope === 'team' && sel.teamId === teamId);
    if (!compatible) setCategoryId(undefined);
  }, [scope, teamId, categoryId, allVisibleCategories, userTeamIds]);

  const teamOptions = useMemo(
    () =>
      (teams ?? []).map((team) => ({
        value: team.id,
        label: team.name,
      })),
    [teams],
  );

  // Hide the "global" scope tab for non-admins entirely. A non-admin
  // creator editing an already-global prompt still sees the tab so the
  // current scope is visible and the form's value matches the rendered
  // selection — they just can't switch other prompts INTO global.
  const showGlobalTab = isOrgAdmin || scope === 'global';
  const scopeTabItems = [
    { value: 'personal', label: t('scope.personal') },
    { value: 'team', label: t('scope.team') },
    ...(showGlobalTab ? [{ value: 'global', label: t('scope.global') }] : []),
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

  const isDirty =
    title !== (initialData?.title ?? '') ||
    content !== (initialData?.content ?? '') ||
    scope !== (initialData?.scope ?? 'personal') ||
    teamId !== initialData?.teamId ||
    categoryId !== initialData?.categoryId ||
    !tagsEqual(tags, initialTags);

  // Title is optional on create — the server AI-generates one when blank.
  // On edit, a blank title would erase what's already there; the server's
  // updatePrompt path accepts that, so we let edit clear it too. Block
  // submit while OCC banner is showing — the user must Load latest first
  // (which re-anchors startVersionRef so hasNewerVersion flips false).
  const isValid =
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
        scope,
        teamId: scope === 'team' ? teamId : undefined,
        categoryId,
        tags,
        expectedVersion: startVersionRef.current,
      });
    },
    [
      title,
      content,
      scope,
      teamId,
      categoryId,
      tags,
      isValid,
      isSubmitting,
      onSubmit,
    ],
  );

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
      {isEditing && (initialData?.version !== undefined || headerActions) && (
        <HStack gap={2} align="center" justify="between">
          {initialData?.version !== undefined ? (
            <Badge
              variant="outline"
              aria-label={t('version.badge', {
                version: String(initialData.version),
              })}
            >
              {t('version.badge', { version: initialData.version })}
            </Badge>
          ) : (
            <span />
          )}
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
      <div className="flex flex-col gap-1">
        <Input
          label={t('form.titleLabel')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('form.titlePlaceholder')}
          maxLength={MAX_PROMPT_TITLE_LEN}
        />
        {!isEditing && (
          <Text variant="muted" className="text-xs">
            {t('form.titleAutoGenHint')}
          </Text>
        )}
      </div>
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
      <div role="group" aria-label={t('form.scopeLabel')}>
        <Tabs
          items={scopeTabItems}
          value={scope}
          onValueChange={(v) => {
            if (v === 'global' || v === 'team' || v === 'personal') setScope(v);
          }}
          listClassName="flex w-full"
          triggerClassName="flex-1"
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
      {scope === 'team' && teamOptions.length === 0 && (
        <Text variant="muted" className="text-xs">
          {t('form.noTeamsAvailable')}
        </Text>
      )}
      {!(scope === 'team' && teamOptions.length === 0) && (
        <div className="flex flex-col gap-2">
          <label id={categoryLabelId} className="text-sm font-medium">
            {t('form.categoryLabel')}
          </label>
          <CategoryPickerPopover
            organizationId={organizationId}
            userId={currentUser?.userId}
            isOrgAdmin={isOrgAdmin}
            scope={scope}
            teamId={teamId}
            userTeamIds={userTeamIds}
            selectedId={categoryId}
            onSelect={setCategoryId}
            ariaLabelledBy={categoryLabelId}
          />
        </div>
      )}
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
