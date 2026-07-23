'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Input } from '@/app/components/ui/forms/input';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { SKILL_SLUG_REGEX } from '@/lib/shared/schemas/skills';

import { useSaveSkill } from '../hooks/mutations';

/**
 * Create a skill: pick its slug (the immutable identity — directory name AND
 * frontmatter `name`) and a one-line description, then land in the editor on
 * an empty body. `saveSkill` is an upsert keyed by slug, so creating over an
 * existing slug would silently edit it — refuse client-side when the slug is
 * already taken (the caller passes the known slugs).
 */
export function SkillCreateDialog({
  organizationId,
  open,
  onOpenChange,
  onCreated,
  existingSlugs,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (slug: string) => void;
  existingSlugs?: readonly string[];
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const saveSkill = useSaveSkill();

  const trimmedSlug = slug.trim();
  const slugInvalid =
    trimmedSlug.length > 0 && !SKILL_SLUG_REGEX.test(trimmedSlug);
  const slugTaken = !!existingSlugs?.includes(trimmedSlug);
  const canSubmit =
    trimmedSlug.length > 0 &&
    !slugInvalid &&
    !slugTaken &&
    description.trim().length > 0 &&
    !saveSkill.isPending;

  const slugHelp = slugTaken
    ? t('skills.createDialog.exists')
    : slugInvalid
      ? t('skills.createDialog.namePatternError')
      : t('skills.createDialog.nameHelp');

  const reset = () => {
    setSlug('');
    setDescription('');
  };

  const submit = async () => {
    if (!canSubmit) return;
    try {
      await saveSkill.mutateAsync({
        organizationId,
        slug: trimmedSlug,
        description: description.trim(),
        body: '',
      });
      toast({ title: t('skills.createDialog.created'), variant: 'success' });
      reset();
      onCreated(trimmedSlug);
    } catch (error) {
      console.error('Failed to create skill', error);
      toast({
        title: t('skills.createDialog.createFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={t('skills.createDialog.title')}
    >
      <Stack gap={4}>
        <Stack gap={1}>
          <label htmlFor="skill-create-slug" className="text-sm font-medium">
            {t('skills.createDialog.nameLabel')}
          </label>
          <Input
            id="skill-create-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={t('skills.createDialog.namePlaceholder')}
            aria-invalid={slugInvalid || slugTaken}
            aria-describedby="skill-create-slug-help"
            autoFocus
          />
          <p
            id="skill-create-slug-help"
            className={
              slugInvalid || slugTaken
                ? 'text-destructive text-xs'
                : 'text-muted-foreground text-xs'
            }
          >
            {slugHelp}
          </p>
        </Stack>
        <Stack gap={1}>
          <label
            htmlFor="skill-create-description"
            className="text-sm font-medium"
          >
            {t('skills.createDialog.descriptionLabel')}
          </label>
          <Input
            id="skill-create-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('skills.createDialog.descriptionPlaceholder')}
            aria-describedby="skill-create-description-help"
          />
          <p
            id="skill-create-description-help"
            className="text-muted-foreground text-xs"
          >
            {t('skills.createDialog.descriptionHelp')}
          </p>
        </Stack>
        <Row gap={2} justify="end">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {tCommon('actions.cancel')}
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {saveSkill.isPending
              ? t('skills.createDialog.creating')
              : t('skills.createDialog.submit')}
          </Button>
        </Row>
      </Stack>
    </Dialog>
  );
}
