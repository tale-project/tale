'use client';

import { useState, useCallback, useMemo } from 'react';

import { Dialog, DialogClose } from '@/app/components/ui/dialog/dialog';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Button } from '@/app/components/ui/primitives/button';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useSavePrompt } from '../hooks/mutations';
import { usePrompts } from '../hooks/queries';
import { AddCategoryPopover } from './add-category-popover';

type PromptScope = 'personal' | 'team' | 'global';

export interface SavePromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialContent: string;
  /** The message ID this prompt is being saved from. */
  sourceMessageId?: string;
}

function ScopeRadio({
  checked,
  label,
  onClick,
}: {
  checked: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className="flex items-center gap-1.5"
    >
      <span
        className={cn(
          'flex size-4 items-center justify-center rounded-full',
          checked ? 'bg-primary' : 'bg-border',
        )}
      >
        <span
          className={cn(
            'rounded-full bg-background',
            checked ? 'size-2.5' : 'size-3.5 shadow-sm',
          )}
        />
      </span>
      <span
        className={cn(
          'text-sm',
          checked ? 'text-foreground font-medium' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
    </button>
  );
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
  const { prompts } = usePrompts(organizationId ?? '');

  const [content, setContent] = useState(initialContent);
  const [scope, setScope] = useState<PromptScope>('personal');
  const [teamId, setTeamId] = useState<string | undefined>();
  const [category, setCategory] = useState('');
  const [localCategories, setLocalCategories] = useState<string[]>([]);

  const existingCategories = useMemo(() => {
    const fromPrompts = prompts
      .map((p) => p.category)
      .filter((c): c is string => !!c);
    const merged = [...new Set([...fromPrompts, ...localCategories])];
    return merged.sort((a, b) => a.localeCompare(b));
  }, [prompts, localCategories]);

  const teamOptions = useMemo(
    () => (teams ?? []).map((team) => ({ value: team.id, label: team.name })),
    [teams],
  );

  const isValid = content.trim().length > 0 && (scope !== 'team' || !!teamId);

  const scopeLabel =
    scope === 'personal'
      ? t('scope.personal')
      : scope === 'team'
        ? t('scope.team')
        : t('scope.global');

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!isValid || !organizationId) return;

      await savePrompt.mutateAsync({
        organizationId,
        content: content.trim(),
        scope,
        teamId: scope === 'team' ? teamId : undefined,
        category: category || undefined,
        isPublished: true,
        sourceMessageId,
      });

      toast({
        title: t('toast.savedTo', { scope: scopeLabel }),
        variant: 'success',
      });

      onOpenChange(false);
    },
    [
      isValid,
      organizationId,
      content,
      scope,
      teamId,
      category,
      sourceMessageId,
      savePrompt,
      onOpenChange,
      toast,
      t,
      scopeLabel,
    ],
  );

  const handleAddCategory = useCallback((newCategory: string) => {
    setLocalCategories((prev) => [...new Set([...prev, newCategory])]);
    setCategory(newCategory);
  }, []);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('saveAs.title')}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="secondary">{t('saveAs.cancel')}</Button>
          </DialogClose>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || savePrompt.isPending}
          >
            {t('form.save')}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-[120px] text-sm"
          required
          aria-required
          aria-label={t('form.contentLabel')}
        />

        <div className="flex flex-col gap-2">
          <label className="text-muted-foreground text-sm font-medium">
            {t('saveAs.saveTo')}
          </label>
          <div className="flex flex-col gap-2 py-0.5" role="radiogroup">
            <ScopeRadio
              checked={scope === 'personal'}
              label={t('scope.personal')}
              onClick={() => setScope('personal')}
            />
            <ScopeRadio
              checked={scope === 'team'}
              label={t('scope.team')}
              onClick={() => setScope('team')}
            />
            <ScopeRadio
              checked={scope === 'global'}
              label={t('scope.global')}
              onClick={() => setScope('global')}
            />
          </div>
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
          <label className="text-muted-foreground text-sm font-medium">
            {t('form.categoryLabel')}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {existingCategories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory((prev) => (prev === cat ? '' : cat))}
                className={cn(
                  'rounded-full px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                  category === cat
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent',
                )}
              >
                {cat}
              </button>
            ))}
            <AddCategoryPopover
              existingCategories={existingCategories}
              onAddCategory={handleAddCategory}
            />
          </div>
        </div>
      </form>
    </Dialog>
  );
}

export function SavePromptDialog(props: SavePromptDialogProps) {
  if (!props.open) return null;
  return <SavePromptDialogContent {...props} />;
}
