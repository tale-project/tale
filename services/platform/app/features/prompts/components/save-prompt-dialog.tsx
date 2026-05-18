'use client';

import { useCallback, useId, useMemo, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Text } from '@/app/components/ui/typography/text';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useCurrentUser } from '@/app/hooks/use-current-user';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useToast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { MAX_PROMPT_CONTENT_BYTES } from '@/convex/prompts/constants';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useSavePrompt } from '../hooks/mutations';
import { extractErrorCode } from '../lib/extract-error-code';
import { CategoryPickerPopover } from './category-picker-popover';

type PromptScope = 'personal' | 'team' | 'global';

function isPromptScope(value: string): value is PromptScope {
  return value === 'personal' || value === 'team' || value === 'global';
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

export interface SavePromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialContent: string;
  /** The message ID this prompt is being saved from. */
  sourceMessageId?: string;
}

function SavePromptDialogContent({
  open,
  onOpenChange,
  initialContent,
  sourceMessageId,
}: SavePromptDialogProps) {
  const { t } = useT('prompts');
  const organizationId = useOrganizationId();
  const savePrompt = useSavePrompt();
  const { toast } = useToast();
  const { teams } = useTeams();
  const { data: currentUser } = useCurrentUser();
  const { data: memberContext } = useCurrentMemberContext(organizationId);
  const isOrgAdmin =
    memberContext?.role === 'admin' || memberContext?.role === 'owner';

  const [content, setContent] = useState(initialContent);
  const [scope, setScope] = useState<PromptScope>('personal');
  const [teamId, setTeamId] = useState<string | undefined>();
  const [categoryId, setCategoryId] = useState<
    Id<'promptCategories'> | undefined
  >();

  const bytesId = useId();
  const categoryLabelId = useId();
  const bytesErrorId = `${bytesId}-error`;
  const isPending = savePrompt.isPending;
  const userTeamIds = useMemo(
    () => (teams ?? []).map((team) => team.id),
    [teams],
  );

  const teamOptions = useMemo(
    () => (teams ?? []).map((team) => ({ value: team.id, label: team.name })),
    [teams],
  );

  const scopeOptions = useMemo(
    () => [
      { value: 'personal', label: t('scope.personal') },
      { value: 'team', label: t('scope.team') },
      { value: 'global', label: t('scope.global') },
    ],
    [t],
  );

  const contentBytes = useMemo(
    () => new TextEncoder().encode(content).byteLength,
    [content],
  );
  const overByteLimit = contentBytes > MAX_PROMPT_CONTENT_BYTES;
  const approachingLimit =
    !overByteLimit && contentBytes >= MAX_PROMPT_CONTENT_BYTES * 0.9;

  const isValid =
    content.trim().length > 0 &&
    !overByteLimit &&
    (scope !== 'team' || !!teamId);

  // Whether the user has touched anything since the dialog opened. Used only to
  // gate the discard-confirm prompt — NOT to gate submit. The dialog's purpose
  // is to create a new prompt, so "submittable" is `isValid`, not "modified".
  const hasUserEdits =
    content !== initialContent ||
    scope !== 'personal' ||
    !!teamId ||
    !!categoryId;

  const scopeLabel =
    scope === 'personal'
      ? t('scope.personal')
      : scope === 'team'
        ? t('scope.team')
        : t('scope.global');

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!isValid || isPending || !organizationId) return;

      try {
        await savePrompt.mutateAsync({
          organizationId,
          content: content.trim(),
          scope,
          teamId: scope === 'team' ? teamId : undefined,
          categoryId,
          // Compose flow passes an empty string when there's no source
          // message; coerce so we never persist `''` as a meaningless id.
          sourceMessageId: sourceMessageId || undefined,
        });

        toast({
          title: t('toast.savedTo', { scope: scopeLabel }),
          variant: 'success',
        });

        onOpenChange(false);
      } catch (err) {
        const code = extractErrorCode(err);
        const toastKey =
          code === 'rate_limited'
            ? 'toast.rateLimited'
            : code === 'forbidden'
              ? 'toast.forbidden'
              : code === 'too_large'
                ? 'toast.tooLarge'
                : code === 'empty_content'
                  ? 'toast.emptyContent'
                  : 'toast.saveFailed';
        if (toastKey === 'toast.saveFailed') {
          console.error('[save-prompt-dialog] save failed', err);
        }
        toast({ title: t(toastKey), variant: 'destructive' });
      }
    },
    [
      isValid,
      isPending,
      organizationId,
      content,
      scope,
      teamId,
      categoryId,
      sourceMessageId,
      savePrompt,
      onOpenChange,
      toast,
      t,
      scopeLabel,
    ],
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('saveAs.title')}
      onSubmit={handleSubmit}
      isSubmitting={isPending}
      isDirty
      isValid={isValid}
      confirmDiscardOnDirty={hasUserEdits}
      submitText={t('form.save')}
    >
      <div className="flex flex-col gap-1">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-[120px] text-sm"
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

      <RadioGroup
        label={t('saveAs.saveTo')}
        value={scope}
        onValueChange={(v) => {
          if (isPromptScope(v)) setScope(v);
        }}
        options={scopeOptions}
      />

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
        <label
          id={categoryLabelId}
          className="text-muted-foreground text-sm font-medium"
        >
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
    </FormDialog>
  );
}

export function SavePromptDialog(props: SavePromptDialogProps) {
  if (!props.open) return null;
  return <SavePromptDialogContent {...props} />;
}
