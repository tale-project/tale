'use client';

/**
 * Column B's model pick — a thin lens over the composer's own picker,
 * narrowed to direct-served options (arena turns are plain model calls; a
 * subscription-locked model cannot answer one).
 */

import { useMemo } from 'react';

import type { HiddenModelsRule } from '@/app/lib/backend/contract/lib';

import type { ComposerSelection } from '../../types';
import type { ComposerModelOption } from '../../types';
import {
  ComposerModelPicker,
  directServedModels,
} from '../composer-model-picker';

interface ArenaModelPickerProps {
  models: readonly ComposerModelOption[];
  modelId?: string;
  /** The provider of the column's pick: two providers can offer `modelId`,
   * and only the copy the column runs on reads as chosen. */
  providerSlug?: string;
  onChange: (modelId: string, providerSlug: string) => void;
  /** Why the EU/EEA processing rule left models out of `models`, if it did. */
  modelsHiddenBy?: HiddenModelsRule;
}

export function ArenaModelPicker({
  models,
  modelId,
  providerSlug,
  onChange,
  modelsHiddenBy,
}: ArenaModelPickerProps) {
  const direct = useMemo(() => directServedModels(models), [models]);
  const selection = useMemo<ComposerSelection>(
    () => ({
      agentKind: 'platform',
      skills: [],
      connectors: [],
      ...(modelId !== undefined ? { modelId } : {}),
      ...(providerSlug !== undefined ? { providerSlug } : {}),
    }),
    [modelId, providerSlug],
  );

  return (
    <ComposerModelPicker
      models={direct}
      selection={selection}
      modelsHiddenBy={modelsHiddenBy}
      onSelectionChange={(next) => {
        if (next.modelId !== undefined && next.providerSlug !== undefined) {
          onChange(next.modelId, next.providerSlug);
        }
      }}
    />
  );
}
