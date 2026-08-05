'use client';

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { isValidSkillSlug } from '@/lib/shared/schemas/skills';

import { useSaveSkill } from '../hooks/mutations';
import {
  parseLabelsInput,
  SkillMetadataFields,
  type SkillMetadataValues,
} from './skill-metadata-fields';

const EMPTY_METADATA: SkillMetadataValues = {
  description: '',
  icon: undefined,
  labels: '',
  sharing: { visibility: 'private', teams: [] },
  usageMode: 'all',
};

/**
 * Create a text-based skill: pick its slug (the immutable identity —
 * directory name AND frontmatter `name`), describe it, share it, write its
 * body — stacked label-above-control rows in a divided list (the dialog
 * column is too narrow for settings-page label-left rows).
 * `saveSkill` is an upsert keyed by slug, so creating over an existing slug
 * would silently edit it — refused client-side against the known slugs.
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

  const [slug, setSlug] = useState('');
  const [metadata, setMetadata] = useState(EMPTY_METADATA);
  const [body, setBody] = useState('');
  const saveSkill = useSaveSkill();

  const trimmedSlug = slug.trim();
  const slugInvalid = trimmedSlug.length > 0 && !isValidSkillSlug(trimmedSlug);
  const slugTaken = existingSlugs.includes(trimmedSlug);
  const teamsMissing =
    metadata.sharing.visibility === 'team' &&
    metadata.sharing.teams.length === 0;
  const canSubmit =
    trimmedSlug.length > 0 &&
    !slugInvalid &&
    !slugTaken &&
    metadata.description.trim().length > 0 &&
    !teamsMissing &&
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
        description: metadata.description.trim(),
        body,
        visibility: metadata.sharing.visibility,
        ...(metadata.sharing.visibility === 'team'
          ? { teams: [...metadata.sharing.teams] }
          : {}),
        usageMode: metadata.usageMode,
        ...(metadata.icon !== undefined ? { icon: metadata.icon } : {}),
        labels: parseLabelsInput(metadata.labels),
      });
      toast({ title: t('createDialog.created'), variant: 'success' });
      onCreated(trimmedSlug);
    } catch (error) {
      console.error('Failed to create skill', error);
      toast({ title: t('createDialog.createFailed'), variant: 'destructive' });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="min-h-0 flex-1 overflow-y-auto pr-2">
        {/* Stacked fields in the dialog column — label-left settings rows
            squeeze helper text beside the controls. Cap width so the form
            does not stretch across a wide dialog. */}
        <SettingsFieldList className="mx-auto w-full max-w-3xl">
          <SettingsFieldRow
            layout="stack"
            label={t('createDialog.nameLabel')}
            description={t('createDialog.nameHelp')}
            required
          >
            <Input
              aria-label={t('createDialog.nameLabel')}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={t('createDialog.namePlaceholder')}
              {...(slugError !== undefined ? { errorMessage: slugError } : {})}
              autoFocus
            />
          </SettingsFieldRow>

          <SkillMetadataFields values={metadata} onChange={setMetadata} />

          <SettingsFieldRow
            layout="stack"
            label={t('section.body')}
            description={t('editor.bodyHelp')}
          >
            <Textarea
              aria-label={t('section.body')}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="font-mono text-sm"
            />
          </SettingsFieldRow>
        </SettingsFieldList>
      </div>

      <Row gap={2} justify="end" className="shrink-0">
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
