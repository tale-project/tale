'use client';

import { isValidSkillSlug } from '@tale/shared/schemas/skills';
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Input } from '@tale/ui/input';
import { Label } from '@tale/ui/label';
import { Stack, Row } from '@tale/ui/layout';
import { Textarea } from '@tale/ui/textarea';
import { toast } from '@tale/ui/use-toast';
import { useId, useState } from 'react';

import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { useT } from '@/lib/i18n/client';

import { useSaveSkill } from '../hooks/mutations';
import { useOrgReservedReason } from '../hooks/use-org-reserved-reason';
import {
  SkillVisibilityField,
  type SkillSharingValue,
} from './skill-visibility-field';

/**
 * Create a text-based skill: pick its slug (the immutable identity), write a
 * description, and choose who sees it. Icon, labels and the body are set in
 * the editor once the skill exists; the audience is asked here because the
 * skill is shared from the moment it is created. Organization is preselected
 * while the viewer may publish to the whole organization; when the
 * organization reserves that, Teams is preselected and Organization is
 * disabled with the reason.
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
  const visibilityId = useId();

  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  // `null` until the member picks one: the default follows what the
  // organization lets them publish, which may still be loading.
  const [pickedSharing, setPickedSharing] = useState<SkillSharingValue | null>(
    null,
  );
  const saveSkill = useSaveSkill();
  const { teams, isLoading: teamsLoading } = useOrgTeams();

  const orgReservedReason = useOrgReservedReason(organizationId);
  const sharing: SkillSharingValue = pickedSharing ?? {
    visibility: orgReservedReason === undefined ? 'org' : 'team',
    teams: [],
  };
  // Nowhere to share it: the whole organization is reserved and the member
  // is in no team they could share it with.
  const noAudience =
    orgReservedReason !== undefined &&
    !teamsLoading &&
    (teams ?? []).length === 0;

  const trimmedSlug = slug.trim();
  const slugInvalid = trimmedSlug.length > 0 && !isValidSkillSlug(trimmedSlug);
  const slugTaken = existingSlugs.includes(trimmedSlug);
  const audienceMissing =
    (sharing.visibility === 'team' && sharing.teams.length === 0) ||
    (sharing.visibility === 'org' && orgReservedReason !== undefined);
  const canSubmit =
    trimmedSlug.length > 0 &&
    !slugInvalid &&
    !slugTaken &&
    description.trim().length > 0 &&
    !audienceMissing &&
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
        visibility: sharing.visibility,
        ...(sharing.visibility === 'team' ? { teams: [...sharing.teams] } : {}),
        labels: [],
        createOnly: true,
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
          <Label htmlFor={slugId}>{t('createDialog.nameLabel')}</Label>
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
          <Label htmlFor={descriptionId}>{t('form.description')}</Label>
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

        <div
          className="flex flex-col gap-1.5"
          role="group"
          aria-labelledby={visibilityId}
        >
          <Label id={visibilityId}>{t('visibility.label')}</Label>
          {noAudience ? (
            <Alert variant="warning" description={t('publishing.noTeams')} />
          ) : (
            <SkillVisibilityField
              value={sharing}
              onChange={setPickedSharing}
              orgReservedReason={orgReservedReason}
            />
          )}
        </div>
      </Stack>

      <Row gap={2} justify="end">
        <Button variant="secondary" onClick={onCancel}>
          {tCommon('actions.cancel')}
        </Button>
        <Button
          disabled={!canSubmit}
          isLoading={saveSkill.isPending}
          onClick={() => void submit()}
        >
          {saveSkill.isPending
            ? t('createDialog.creating')
            : t('createDialog.submit')}
        </Button>
      </Row>
    </div>
  );
}
