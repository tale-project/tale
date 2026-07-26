'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useId, useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
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
 * body. `saveSkill` is an upsert keyed by slug, so creating over an existing
 * slug would silently edit it — refused client-side against the known slugs.
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
  const bodyId = useId();

  const [slug, setSlug] = useState('');
  const [metadata, setMetadata] = useState(EMPTY_METADATA);
  const [body, setBody] = useState('');
  const saveSkill = useSaveSkill(organizationId);

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

  const slugHelp = slugTaken
    ? t('createDialog.exists')
    : slugInvalid
      ? t('createDialog.namePatternError')
      : t('createDialog.nameHelp');

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
    <Stack gap={4} className="min-h-0">
      <div className="min-h-0 flex-1 overflow-y-auto pr-2">
        <Stack gap={4}>
          <Stack gap={1}>
            <label htmlFor={slugId} className="text-sm font-medium">
              {t('createDialog.nameLabel')}
            </label>
            <Input
              id={slugId}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={t('createDialog.namePlaceholder')}
              aria-invalid={slugInvalid || slugTaken}
              aria-describedby={`${slugId}-help`}
              autoFocus
            />
            <Text
              as="p"
              id={`${slugId}-help`}
              variant="caption"
              className={
                slugInvalid || slugTaken
                  ? 'text-destructive'
                  : 'text-muted-foreground'
              }
            >
              {slugHelp}
            </Text>
          </Stack>

          <SkillMetadataFields values={metadata} onChange={setMetadata} />

          <Stack gap={1}>
            <label htmlFor={bodyId} className="text-sm font-medium">
              {t('section.body')}
            </label>
            <Textarea
              id={bodyId}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="font-mono text-sm"
              aria-describedby={`${bodyId}-help`}
            />
            <Text
              as="p"
              id={`${bodyId}-help`}
              variant="caption"
              className="text-muted-foreground"
            >
              {t('editor.bodyHelp')}
            </Text>
          </Stack>
        </Stack>
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
    </Stack>
  );
}
