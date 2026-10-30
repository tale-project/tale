'use client';

import { Checkbox } from '@tale/ui/checkbox';
import { FormSection } from '@tale/ui/form-section';
import { Input } from '@tale/ui/input';
import { useId } from 'react';

import { useT } from '@/lib/i18n/client';

import {
  contextWindowOf,
  modelFactsDraft,
  type ModelFactsDraft,
} from './provider-definition-form';

interface ModelFactsFieldProps {
  /** The ids the credential's allowlist names, in its order. */
  ids: readonly string[];
  value: Readonly<Record<string, ModelFactsDraft>>;
  onValueChange: (next: Record<string, ModelFactsDraft>) => void;
  disabled?: boolean;
}

/**
 * What each model of a provider without a model listing can take — the
 * facts a listing would otherwise carry: its context window, and whether it
 * reads images. One group per allowlisted id, named by the id; a model left
 * blank keeps the neutral assumption the docs and the description state
 * (128,000 tokens, no image input).
 */
export function ModelFactsField({
  ids,
  value,
  onValueChange,
  disabled,
}: ModelFactsFieldProps) {
  const { t } = useT('settings');
  if (ids.length === 0) return null;
  const update = (id: string, patch: Partial<ModelFactsDraft>) =>
    onValueChange({
      ...value,
      [id]: { ...modelFactsDraft(value, id), ...patch },
    });
  return (
    <FormSection
      label={t('providers.custom.modelFacts.title')}
      description={t('providers.custom.modelFacts.description')}
    >
      {ids.map((id) => (
        <ModelFactsRow
          key={id}
          id={id}
          draft={modelFactsDraft(value, id)}
          onChange={(patch) => update(id, patch)}
          disabled={disabled}
        />
      ))}
    </FormSection>
  );
}

function ModelFactsRow({
  id,
  draft,
  onChange,
  disabled,
}: {
  id: string;
  draft: ModelFactsDraft;
  onChange: (patch: Partial<ModelFactsDraft>) => void;
  disabled?: boolean;
}) {
  const { t } = useT('settings');
  const labelId = useId();
  const invalid = contextWindowOf(draft.contextWindow) === null;
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-2">
      <span
        id={labelId}
        className="text-foreground font-mono text-xs break-all md:text-sm"
      >
        {id}
      </span>
      <Input
        label={t('providers.custom.modelFacts.contextWindow')}
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        placeholder="128000"
        suffix={t('providers.custom.modelFacts.tokens')}
        value={draft.contextWindow}
        onChange={(e) => onChange({ contextWindow: e.target.value })}
        errorMessage={
          invalid
            ? t('providers.custom.modelFacts.contextWindowInvalid')
            : undefined
        }
        disabled={disabled}
      />
      <Checkbox
        label={t('providers.custom.modelFacts.readsImages')}
        checked={draft.supportsVision}
        onCheckedChange={(checked) =>
          onChange({ supportsVision: checked === true })
        }
        disabled={disabled}
      />
    </div>
  );
}
