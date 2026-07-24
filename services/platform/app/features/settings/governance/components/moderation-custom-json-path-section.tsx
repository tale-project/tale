'use client';

import { Stack } from '@tale/ui/layout';
import { useState } from 'react';

import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { useT } from '@/lib/i18n/client';

import type { EndpointDraft } from './moderation-presets';

interface ShapeSample {
  json: string;
  categoriesPath: string;
}

const SHAPE_SAMPLES: Record<
  'array' | 'record_of_bool' | 'record_of_score',
  ShapeSample
> = {
  record_of_bool: {
    json: `{
  "results": [
    {
      "flagged": true,
      "categories": {
        "hate": false,
        "violence": true,
        "sexual": false
      }
    }
  ]
}`,
    categoriesPath: '$.results[0].categories',
  },
  record_of_score: {
    json: `{
  "attributeScores": {
    "TOXICITY":   { "summaryScore": { "value": 0.87 } },
    "INSULT":     { "summaryScore": { "value": 0.12 } }
  }
}`,
    categoriesPath: '$.attributeScores.*.summaryScore.value',
  },
  array: {
    json: `{
  "flaggedCategories": ["hate", "violence"]
}`,
    categoriesPath: '$.flaggedCategories',
  },
};

// ---------------------------------------------------------------------------
// Custom JSONPath section
// ---------------------------------------------------------------------------
//
// Two-question flow instead of three separate inputs:
//   1. "What shape does the provider return categories in?" (pick from
//      examples — the JSON format itself is the answer)
//   2. Paste the path to the categories, with the correct JSONPath for
//      THAT shape pre-filled as a placeholder.
//
// "Overall flagged path" is a seldom-needed optional that used to take
// the same visual weight as the required fields. Now it's collapsed
// behind "Show advanced" — providers that don't return a top-level
// boolean (most of them) never have to see it.

export function CustomJsonPathSection({
  draft,
  onChange,
}: {
  draft: EndpointDraft;
  onChange: (patch: Partial<EndpointDraft>) => void;
}) {
  const { t } = useT('governance');
  const [showAdvanced, setShowAdvanced] = useState(
    draft.customFlaggedPath.trim().length > 0,
  );
  const sample = SHAPE_SAMPLES[draft.customCategoryShape];
  return (
    <FormSection
      label={t('moderationProvider.parseResponseLabel')}
      description={t('moderationProvider.parseResponseDescription')}
    >
      <Stack>
        <div>
          <p className="text-sm font-medium">
            {t('moderationProvider.shapeStepTitle')}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('moderationProvider.shapeStepDescription')}
          </p>
          <Select
            className="mt-1.5"
            value={draft.customCategoryShape}
            onValueChange={(v) => {
              if (
                v === 'array' ||
                v === 'record_of_bool' ||
                v === 'record_of_score'
              ) {
                onChange({ customCategoryShape: v });
              }
            }}
            options={[
              {
                value: 'record_of_bool',
                label: `${t('moderationProvider.shapeRecordBool')} — { "hate": true, "violence": false }`,
              },
              {
                value: 'record_of_score',
                label: `${t('moderationProvider.shapeRecordScore')} — { "hate": 0.02, "violence": 0.87 }`,
              },
              {
                value: 'array',
                label: `${t('moderationProvider.shapeArray')} — ["hate", "violence"]`,
              },
            ]}
          />
        </div>

        <div>
          <label className="text-sm font-medium">
            {t('moderationProvider.pathStepTitle')}{' '}
            <span className="text-destructive">
              {t('moderationProvider.pathStepRequired')}
            </span>
          </label>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('moderationProvider.pathStepDescription')}
          </p>
          <Input
            className="mt-1.5 font-mono text-base md:text-sm"
            value={draft.customCategoriesPath}
            onChange={(e) => onChange({ customCategoriesPath: e.target.value })}
            placeholder={sample.categoriesPath}
          />
          <div className="border-border bg-muted/40 mt-2 rounded-md border p-3">
            <div className="text-muted-foreground mb-1 text-xs">
              {t('moderationProvider.pathExampleTitle')}
            </div>
            <pre className="bg-background overflow-x-auto rounded border p-2 font-mono text-xs">
              {sample.json}
            </pre>
            <div className="text-muted-foreground mt-2 text-xs">
              <code className="text-foreground bg-background rounded px-1 font-mono">
                {sample.categoriesPath}
              </code>{' '}
              — {t('moderationProvider.pathExampleExplanation')}
            </div>
          </div>
        </div>

        {!showAdvanced ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground self-start text-xs underline underline-offset-2"
            onClick={() => setShowAdvanced(true)}
          >
            {t('moderationProvider.showAdvanced')}
          </button>
        ) : (
          <div>
            <label className="text-sm font-medium">
              {t('moderationProvider.flaggedPathLabel')}{' '}
              <span className="text-muted-foreground">
                {t('moderationProvider.flaggedPathOptional')}
              </span>
            </label>
            <p className="text-muted-foreground mt-1 text-xs">
              {t('moderationProvider.flaggedPathDescription')}
            </p>
            <Input
              className="mt-1.5 font-mono text-base md:text-sm"
              value={draft.customFlaggedPath}
              onChange={(e) => onChange({ customFlaggedPath: e.target.value })}
              placeholder="$.results[0].flagged"
            />
          </div>
        )}
      </Stack>
    </FormSection>
  );
}
