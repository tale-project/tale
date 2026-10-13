import { PermissionSummary } from '@tale/ui/permission-summary';
import { RadioGroup } from '@tale/ui/radio-group';
import { useState } from 'react';

const LEVELS = {
  read: 'Read automations',
  edit: 'Edit automations',
  settings: 'Change settings',
} as const;

type Level = keyof typeof LEVELS;

/** What each level lets the agent do, and why it cannot do the rest. */
function itemsFor(level: Level) {
  const rank = { read: 0, edit: 1, settings: 2 }[level];
  return [
    { label: 'Read automations, runs and versions', allowed: true },
    {
      label: 'Edit and deploy automations',
      allowed: rank >= 1,
      ...(rank < 1 && { detail: 'Choose "Edit automations" to allow this.' }),
    },
    {
      label: 'Read and change settings',
      allowed: rank >= 2,
      ...(rank < 2 && { detail: 'Choose "Change settings" to allow this.' }),
    },
  ];
}

export default function PermissionSummaryBasic() {
  const [level, setLevel] = useState<Level>('edit');

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <RadioGroup
        label="Access"
        value={level}
        onValueChange={(next) => setLevel(next as Level)}
        options={Object.entries(LEVELS).map(([value, label]) => ({
          value,
          label,
        }))}
      />
      <PermissionSummary
        aria-live="polite"
        title="What Claude Code will be able to do"
        items={itemsFor(level)}
        footer="Limited by your role in Acme, Developer."
      />
    </div>
  );
}
