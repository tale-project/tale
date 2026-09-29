import type { SkillOrigin } from '@tale/shared/schemas/skills';
import { useCallback } from 'react';

import { useT } from '@/lib/i18n/client';

/** The facts "Created by" is read from. */
export interface SkillCreatorFacts {
  origin: SkillOrigin;
  /** The creator's name — present only while they are a member. */
  ownerName?: string;
}

/** The facts "Last edited by" is read from. */
export interface SkillEditorFacts {
  /** The member whose write produced the stored version, when known. */
  updatedBy?: string;
  updatedByName?: string;
}

/**
 * The words for who created and who last edited a skill — one reading for
 * the library table, the skill dialog and the agent skill pickers, so the
 * three can never disagree. The server resolves the names; a raw user id
 * never reaches the page:
 *
 * - a configuration release reads as such, beside the member who installed
 *   it, a skill with no recorded owner as built-in, and a member's skill as
 *   their name — or "Former member" once they have left the organization.
 *   The release marker is plain frontmatter any upload can carry, so every
 *   surface that shows it also names whose upload installed the skill;
 * - `creatorHint` is the same reading as a short caption under a picker
 *   row ("By Jane Doe"), where no column header says what the name means;
 * - "Last edited by" answers `null` when nobody is known to have written
 *   the stored version through Tale, and the row is then left out.
 */
export function useSkillAttribution(): {
  createdBy: (skill: SkillCreatorFacts) => string;
  creatorHint: (skill: SkillCreatorFacts) => string;
  lastEditedBy: (skill: SkillEditorFacts) => string | null;
} {
  const { t } = useT('skills');
  const createdBy = useCallback(
    (skill: SkillCreatorFacts): string => {
      if (skill.origin === 'release') {
        return skill.ownerName === undefined
          ? t('attribution.release')
          : t('attribution.releaseBy', { name: skill.ownerName });
      }
      if (skill.origin === 'builtin') return t('attribution.builtin');
      return skill.ownerName ?? t('attribution.formerMember');
    },
    [t],
  );
  const creatorHint = useCallback(
    (skill: SkillCreatorFacts): string => {
      if (skill.origin !== 'member') return createdBy(skill);
      return skill.ownerName === undefined
        ? t('attribution.byFormerMember')
        : t('attribution.byMember', { name: skill.ownerName });
    },
    [createdBy, t],
  );
  const lastEditedBy = useCallback(
    (skill: SkillEditorFacts): string | null => {
      if (skill.updatedBy === undefined) return null;
      return skill.updatedByName ?? t('attribution.formerMember');
    },
    [t],
  );
  return { createdBy, creatorHint, lastEditedBy };
}
