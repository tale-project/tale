'use client';

/**
 * The `llm` node's Model field: the same picker the agent node uses — the
 * models the organization's connected providers serve, from the composer
 * roster — instead of a bare text box that accepted any id and let the
 * mistake surface on the first live run (2026-09-26 evaluation, D-16).
 *
 * An llm node names a model and nothing more: the run's walk picks the
 * provider (`resolveServingTarget` is deliberately unpinned), so the pick
 * stores only `model`, never a provider pin, and subscription-served
 * entries — which only an agent harness can use — are not offered. A model
 * that is not listed can still be typed: the free-text escape keeps a
 * document authorable before its provider is connected, and says so.
 */

import { Button } from '@tale/ui/button';
import { Field } from '@tale/ui/field';
import { Input } from '@tale/ui/input';
import { Stack } from '@tale/ui/layout';
import { SearchableSelect } from '@tale/ui/searchable-select';
import { useId, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { useLlmModelOptions } from '../hooks/use-llm-model-options';

export function LlmModelField({
  organizationId,
  model,
  required,
  readOnly,
  onChange,
}: {
  organizationId: string;
  model: string;
  required: boolean;
  readOnly: boolean;
  onChange: (model: string | undefined) => void;
}) {
  const { t } = useT('automations');
  const { t: tProjects } = useT('projects');
  const inputId = useId();
  const { options, loaded } = useLlmModelOptions(organizationId);
  const [typing, setTyping] = useState(false);

  const listed = options.some((option) => option.value === model);
  // Only claim "not listed" once the roster has answered — an empty list
  // while it loads is not a missing model.
  const unlisted = loaded && model !== '' && !listed;
  const freeText = typing || unlisted;

  return (
    <Stack gap={2}>
      <SearchableSelect
        id={`${inputId}-picker`}
        label={t('editor.fields.model')}
        placeholder={t('editor.llm.modelPlaceholder')}
        searchPlaceholder={tProjects('agents.modelSearchPlaceholder')}
        emptyText={tProjects('agents.modelSearchEmpty')}
        options={options}
        required={required}
        disabled={readOnly}
        value={listed ? model : null}
        {...(unlisted
          ? { description: t('editor.llm.modelUnlisted', { model }) }
          : {})}
        onValueChange={(value) => {
          if (value === '') return;
          setTyping(false);
          onChange(value);
        }}
      />
      {freeText ? (
        <Field
          label={t('editor.llm.modelIdLabel')}
          htmlFor={inputId}
          description={t('editor.llm.modelIdHint')}
        >
          <Input
            id={inputId}
            readOnly={readOnly}
            value={model}
            className="font-mono text-xs"
            onChange={(event) => {
              onChange(
                event.target.value === '' ? undefined : event.target.value,
              );
            }}
          />
        </Field>
      ) : (
        !readOnly && (
          <div>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => {
                setTyping(true);
              }}
            >
              {t('editor.llm.typeUnlisted')}
            </Button>
          </div>
        )
      )}
    </Stack>
  );
}
