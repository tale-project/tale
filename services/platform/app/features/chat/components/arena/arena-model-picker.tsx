'use client';

/**
 * Column B's model pick — a thin lens over the composer's own picker,
 * narrowed to direct-served options (arena turns are plain model calls; a
 * subscription-locked model cannot answer one).
 */

import { useMemo } from 'react';

import type { ComposerSelection } from '../../types';
import type { ComposerModelOption } from '../../types';
import {
  ComposerModelPicker,
  directServedModels,
} from '../composer-model-picker';

interface ArenaModelPickerProps {
  models: readonly ComposerModelOption[];
  modelId?: string;
  onChange: (modelId: string, providerSlug: string) => void;
}

export function ArenaModelPicker({
  models,
  modelId,
  onChange,
}: ArenaModelPickerProps) {
  const direct = useMemo(() => directServedModels(models), [models]);
  const selection = useMemo<ComposerSelection>(
    () => ({
      agentKind: 'platform',
      skills: [],
      connectors: [],
      ...(modelId !== undefined ? { modelId } : {}),
    }),
    [modelId],
  );

  return (
    <ComposerModelPicker
      models={direct}
      selection={selection}
      onSelectionChange={(next) => {
        if (next.modelId !== undefined && next.providerSlug !== undefined) {
          onChange(next.modelId, next.providerSlug);
        }
      }}
    />
  );
}
