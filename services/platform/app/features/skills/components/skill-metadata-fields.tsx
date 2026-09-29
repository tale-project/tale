'use client';

import {
  MAX_SKILL_LABEL_LENGTH,
  MAX_SKILL_LABELS,
} from '@tale/shared/schemas/skills';
import { Input } from '@tale/ui/input';
import { Textarea } from '@tale/ui/textarea';

import { SettingsFieldRow } from '@/app/features/settings/components/settings-field-list';
import { useT } from '@/lib/i18n/client';

import { SkillIconPicker } from './skill-icon-picker';
import {
  SkillVisibilityField,
  type SkillSharingValue,
} from './skill-visibility-field';

export interface SkillMetadataValues {
  readonly description: string;
  readonly icon: string | undefined;
  /** Comma-separated, exactly as typed; split on save. */
  readonly labels: string;
  readonly sharing: SkillSharingValue;
}

/** Split the comma-separated labels field into the frontmatter list —
 * every entry, so a save sends exactly what the field holds. */
export function parseLabelsInput(labels: string): string[] {
  return labels
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
}

/** How much of a too-long label its error quotes: enough to find it, and
 * the same sentence while the member keeps typing (the error is a live
 * region; a sentence that grew per keystroke would be read out each time). */
const QUOTED_LABEL_LENGTH = 20;

/** Why the labels field cannot be saved as typed. */
export type LabelsProblem =
  | { readonly kind: 'tooMany'; readonly count: number }
  | { readonly kind: 'tooLong'; readonly label: string };

/**
 * Hold the typed labels to the caps the skill doors enforce
 * (`skillEditFields` in `@tale/shared/schemas/skills`): at most
 * `MAX_SKILL_LABELS`, each at most `MAX_SKILL_LABEL_LENGTH` characters.
 * The field keeps the whole draft either way; this says why Save waits.
 */
export function labelsProblem(labels: string): LabelsProblem | null {
  const parsed = parseLabelsInput(labels);
  if (parsed.length > MAX_SKILL_LABELS) {
    return { kind: 'tooMany', count: parsed.length };
  }
  const long = parsed.find((label) => label.length > MAX_SKILL_LABEL_LENGTH);
  return long === undefined ? null : { kind: 'tooLong', label: long };
}

/**
 * The metadata cluster the create pane and the detail pane share: stacked
 * label-above-control rows (the dialog column is too narrow for label-left
 * settings rows), rendered WITHOUT their own `SettingsFieldList` wrapper so
 * the owning pane composes one continuous divided list around them (name
 * row before, body row after). Controlled throughout — the owning pane holds
 * the form state and the save wiring.
 */
export function SkillMetadataFields({
  values,
  savedSharing,
  savedLabels,
  onChange,
  disabled,
  orgReservedReason,
}: {
  values: SkillMetadataValues;
  /** What the file on disk says — the narrowing warning's baseline. */
  savedSharing?: SkillSharingValue;
  /** The stored labels as the field shows them. Left as they are, they are
   * not checked (a save leaves them alone); only an edit is held to the caps. */
  savedLabels?: string;
  onChange: (values: SkillMetadataValues) => void;
  disabled?: boolean;
  /** Why the Organization audience is withheld from this viewer, if it is. */
  orgReservedReason?: string;
}) {
  const { t } = useT('skills');
  const problem =
    values.labels === savedLabels ? null : labelsProblem(values.labels);
  const labelsError =
    problem === null
      ? undefined
      : problem.kind === 'tooMany'
        ? t('editor.labelsTooMany', {
            max: MAX_SKILL_LABELS,
            excess: problem.count - MAX_SKILL_LABELS,
          })
        : t('editor.labelTooLong', {
            label: `${problem.label.slice(0, QUOTED_LABEL_LENGTH)}…`,
            max: MAX_SKILL_LABEL_LENGTH,
          });

  return (
    <>
      <SettingsFieldRow
        layout="stack"
        label={t('form.description')}
        description={t('editor.descriptionHelp')}
        required
      >
        <Textarea
          aria-label={t('form.description')}
          required
          value={values.description}
          onChange={(e) => onChange({ ...values, description: e.target.value })}
          rows={3}
          maxLength={1024}
          disabled={disabled}
        />
      </SettingsFieldRow>

      <SettingsFieldRow
        label={t('iconPicker.label')}
        wideControl
        className="@xl/field-layout:items-center"
      >
        <SkillIconPicker
          value={values.icon}
          onChange={(icon) => onChange({ ...values, icon })}
          disabled={disabled}
        />
      </SettingsFieldRow>

      <SettingsFieldRow layout="stack" label={t('editor.labels')}>
        <Input
          aria-label={t('editor.labels')}
          value={values.labels}
          onChange={(e) => onChange({ ...values, labels: e.target.value })}
          placeholder={t('editor.labelsPlaceholder')}
          disabled={disabled}
          hint={t('editor.labelsHelp')}
          errorMessage={labelsError}
        />
      </SettingsFieldRow>

      <SettingsFieldRow
        layout="stack"
        label={t('visibility.label')}
        className="gap-4"
      >
        <SkillVisibilityField
          value={values.sharing}
          savedValue={savedSharing}
          onChange={(sharing) => onChange({ ...values, sharing })}
          disabled={disabled}
          orgReservedReason={orgReservedReason}
        />
      </SettingsFieldRow>
    </>
  );
}
