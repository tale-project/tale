'use client';

import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { SettingsFieldRow } from '@/app/features/settings/components/settings-field-list';
import { useT } from '@/lib/i18n/client';
import type { SkillUsageMode } from '@/lib/shared/schemas/skills';

import { SkillIconPicker } from './skill-icon-picker';
import { SkillUsageField } from './skill-usage-field';
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
  readonly usageMode: SkillUsageMode;
}

/** Split the comma-separated labels field into the frontmatter list. */
export function parseLabelsInput(labels: string): string[] {
  return labels
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label.length > 0)
    .slice(0, 8);
}

/**
 * The metadata cluster the create pane and the detail pane share: the
 * label-left rows every settings section uses, rendered WITHOUT their own
 * `SettingsFieldList` wrapper so the owning pane composes one continuous
 * divided list around them (name row before, body row after). Controlled
 * throughout — the owning pane holds the form state and the save wiring.
 */
export function SkillMetadataFields({
  values,
  savedSharing,
  onChange,
  disabled,
}: {
  values: SkillMetadataValues;
  /** What the file on disk says — the narrowing warning's baseline. */
  savedSharing?: SkillSharingValue;
  onChange: (values: SkillMetadataValues) => void;
  disabled?: boolean;
}) {
  const { t } = useT('skills');

  return (
    <>
      <SettingsFieldRow
        label={t('form.description')}
        description={t('editor.descriptionHelp')}
        required
      >
        <Textarea
          aria-label={t('form.description')}
          value={values.description}
          onChange={(e) => onChange({ ...values, description: e.target.value })}
          rows={3}
          maxLength={1024}
          disabled={disabled}
        />
      </SettingsFieldRow>

      <SettingsFieldRow label={t('iconPicker.label')}>
        <SkillIconPicker
          value={values.icon}
          onChange={(icon) => onChange({ ...values, icon })}
          disabled={disabled}
        />
      </SettingsFieldRow>

      <SettingsFieldRow
        label={t('editor.labels')}
        description={t('editor.labelsHelp')}
      >
        <Input
          aria-label={t('editor.labels')}
          value={values.labels}
          onChange={(e) => onChange({ ...values, labels: e.target.value })}
          placeholder={t('editor.labelsPlaceholder')}
          disabled={disabled}
        />
      </SettingsFieldRow>

      <SettingsFieldRow label={t('visibility.label')}>
        <SkillVisibilityField
          value={values.sharing}
          savedValue={savedSharing}
          onChange={(sharing) => onChange({ ...values, sharing })}
          disabled={disabled}
        />
      </SettingsFieldRow>

      <SettingsFieldRow label={t('usage.label')}>
        <SkillUsageField
          value={values.usageMode}
          onChange={(usageMode) => onChange({ ...values, usageMode })}
          disabled={disabled}
        />
      </SettingsFieldRow>
    </>
  );
}
