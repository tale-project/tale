'use client';

import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import { useT } from '@/lib/i18n/client';
import type { SkillUsageMode } from '@/lib/shared/schemas/skills';

/**
 * Where a skill may be equipped: conversations (the composer's capability
 * menu and the `/` command), agents (project agents, agent bindings,
 * automation nodes), or both. Distinct from `disable-model-invocation`,
 * which gates whether the model reaches for an already-staged skill on its
 * own.
 */
export function SkillUsageField({
  value,
  onChange,
  disabled,
}: {
  value: SkillUsageMode;
  onChange: (value: SkillUsageMode) => void;
  disabled?: boolean;
}) {
  const { t } = useT('skills');

  return (
    <RadioGroup
      // The visible label comes from the settings row framing this control.
      aria-label={t('usage.label')}
      value={value}
      onValueChange={(next) => {
        if (next === 'chat' || next === 'agent' || next === 'all') {
          onChange(next);
        }
      }}
      disabled={disabled}
      options={[
        {
          value: 'all',
          label: t('usage.all'),
          description: t('usage.allHelp'),
        },
        {
          value: 'chat',
          label: t('usage.chat'),
          description: t('usage.chatHelp'),
        },
        {
          value: 'agent',
          label: t('usage.agent'),
          description: t('usage.agentHelp'),
        },
      ]}
    />
  );
}
