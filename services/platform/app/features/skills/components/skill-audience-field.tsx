'use client';

import { Alert } from '@tale/ui/alert';
import { Label } from '@tale/ui/label';
import { useId } from 'react';

import { useT } from '@/lib/i18n/client';

import type { SkillAudience } from '../hooks/use-skill-audience';
import {
  SkillVisibilityField,
  type SkillSharingValue,
} from './skill-visibility-field';

/**
 * The labelled Visibility group a new skill is created or uploaded with
 * ({@link useSkillAudience}): the audience field, or — when the member has
 * nowhere to share the skill — who can change that.
 */
export function SkillAudienceField({
  audience,
  onChange,
}: {
  audience: SkillAudience;
  onChange: (value: SkillSharingValue) => void;
}) {
  const { t } = useT('skills');
  const labelId = useId();

  return (
    <div
      className="flex flex-col gap-1.5"
      role="group"
      aria-labelledby={labelId}
    >
      <Label id={labelId}>{t('visibility.label')}</Label>
      {audience.noAudience ? (
        <Alert variant="warning" description={t('publishing.noTeams')} />
      ) : (
        <SkillVisibilityField
          value={audience.sharing}
          onChange={onChange}
          orgReservedReason={audience.orgReservedReason}
        />
      )}
    </div>
  );
}
