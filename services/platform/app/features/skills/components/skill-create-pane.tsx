'use client';

import { Button } from '@tale/ui/button';
import { Label } from '@tale/ui/label';
import { Stack, Row } from '@tale/ui/layout';
import { useId, useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { isValidSkillSlug } from '@/lib/shared/schemas/skills';

import { useSaveSkill } from '../hooks/mutations';

/**
 * Create a text-based skill: pick its slug (the immutable identity) and write
 * a description. Icon, labels, sharing, and the body are all set in the editor
 * once the skill exists — keeping this form to just the two required fields
 * means the creation step stays appropriately lightweight.
 */
export function SkillCreatePane({
  organizationId,
  existingSlugs,
  onCreated,
  onCancel,
}: {
  organizationId: string;
  existingSlugs: readonly string[];
  onCreated: (slug: string) => void;
  onCancel: () => void;
}) {
  const { t } = useT('skills');
  const { t: tCommon } = useT('common');
  const slugId = useId();
  const descriptionId = useId();

  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const saveSkill = useSaveSkill();

  const trimmedSlug = slug.trim();
  const slugInvalid = trimmedSlug.length > 0 && !isValidSkillSlug(trimmedSlug);
  const slugTaken = existingSlugs.includes(trimmedSlug);
  const canSubmit =
    trimmedSlug.length > 0 &&
    !slugInvalid &&
    !slugTaken &&
    description.trim().length > 0 &&
    !saveSkill.isPending;

  const slugError = slugTaken
    ? t('createDialog.exists')
    : slugInvalid
      ? t('createDialog.namePatternError')
      : undefined;

  const submit = async () => {
    if (!canSubmit) return;
    try {
      await saveSkill.mutateAsync({
        organizationId,
        slug: trimmedSlug,
        description: description.trim(),
        body: '',
        visibility: 'org',
        labels: [],
      });
      toast({ title: t('createDialog.created'), variant: 'success' });
      onCreated(trimmedSlug);
    } catch (error) {
      console.error('Failed to create skill', error);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Stack gap={5}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={slugId}>
            {t('createDialog.nameLabel')}
            <span
              className="ml-0.5 text-[color:var(--color-danger)]"
              aria-hidden
            >
              *
            </span>
          </Label>
          <Input
            id={slugId}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={t('createDialog.namePlaceholder')}
            autoFocus
          />
          {slugError ? (
            <p
              className="text-xs text-[color:var(--color-danger)]"
              role="alert"
            >
              {slugError}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              {t('createDialog.nameHelp')}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={descriptionId}>
            {t('form.description')}
            <span
              className="ml-0.5 text-[color:var(--color-danger)]"
              aria-hidden
            >
              *
            </span>
          </Label>
          <Textarea
            id={descriptionId}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={1024}
          />
          <p className="text-muted-foreground text-xs">
            {t('editor.descriptionHelp')}
          </p>
        </div>
      </Stack>

      <Row gap={2} justify="end">
        <Button variant="secondary" onClick={onCancel}>
          {tCommon('actions.cancel')}
        </Button>
        <Button disabled={!canSubmit} onClick={() => void submit()}>
          {saveSkill.isPending
            ? t('createDialog.creating')
            : t('createDialog.submit')}
        </Button>
      </Row>
    </div>
  );
}
