'use client';

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useId } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
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
 * The metadata cluster the create pane and the detail pane share:
 * description, icon, labels, sharing, usage. Controlled throughout —
 * the owning pane holds the form state and the save wiring.
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
  const descriptionId = useId();
  const labelsId = useId();

  return (
    <Stack gap={4}>
      <Stack gap={1}>
        <label htmlFor={descriptionId} className="text-sm font-medium">
          {t('form.description')}
        </label>
        <Textarea
          id={descriptionId}
          value={values.description}
          onChange={(e) => onChange({ ...values, description: e.target.value })}
          rows={3}
          maxLength={1024}
          disabled={disabled}
          aria-describedby={`${descriptionId}-help`}
        />
        <Text
          as="p"
          id={`${descriptionId}-help`}
          variant="caption"
          className="text-muted-foreground"
        >
          {t('editor.descriptionHelp')}
        </Text>
      </Stack>

      <Stack gap={1}>
        <Text as="span" variant="label">
          {t('iconPicker.label')}
        </Text>
        <SkillIconPicker
          value={values.icon}
          onChange={(icon) => onChange({ ...values, icon })}
          disabled={disabled}
        />
      </Stack>

      <Stack gap={1}>
        <label htmlFor={labelsId} className="text-sm font-medium">
          {t('editor.labels')}
        </label>
        <Input
          id={labelsId}
          value={values.labels}
          onChange={(e) => onChange({ ...values, labels: e.target.value })}
          placeholder={t('editor.labelsPlaceholder')}
          disabled={disabled}
          aria-describedby={`${labelsId}-help`}
        />
        <Text
          as="p"
          id={`${labelsId}-help`}
          variant="caption"
          className="text-muted-foreground"
        >
          {t('editor.labelsHelp')}
        </Text>
      </Stack>

      <SkillVisibilityField
        value={values.sharing}
        savedValue={savedSharing}
        onChange={(sharing) => onChange({ ...values, sharing })}
        disabled={disabled}
      />

      <SkillUsageField
        value={values.usageMode}
        onChange={(usageMode) => onChange({ ...values, usageMode })}
        disabled={disabled}
      />
    </Stack>
  );
}
