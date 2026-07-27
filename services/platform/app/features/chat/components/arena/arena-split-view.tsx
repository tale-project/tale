'use client';

/**
 * The arena stage: two live columns over one composer, with the verdict bar
 * between them and the input. Mounts only while a pair is active — the
 * surface swaps it in for the normal transcript and swaps it out the moment
 * the pair settles (the pair watch is uncached; absence collapses it).
 *
 * Column A's model is the composer's own picker — one source of truth for
 * "the model I am talking to"; column B carries its picker in its header.
 */

import { useT } from '@/lib/i18n/client';
import type { ArenaVerdict } from '@/lib/shared/arena';

import type { ComposerModelOption } from '../../types';
import { ArenaColumn } from './arena-column';
import { ArenaModelPicker } from './arena-model-picker';
import { ArenaVerdictBar } from './arena-verdict-bar';

interface ArenaSplitViewProps {
  organizationId: string;
  threadIdA: string;
  threadIdB: string;
  /** Column A's model label (the composer's current pick). */
  modelALabel?: string;
  /** Direct-served options for column B's picker. */
  models: readonly ComposerModelOption[];
  modelBId?: string;
  onModelBChange: (modelId: string, providerSlug: string) => void;
  /** Either column is still answering. */
  generating: boolean;
  onVerdict: (verdict: ArenaVerdict) => void;
  onExit: () => void;
}

export function ArenaSplitView({
  organizationId,
  threadIdA,
  threadIdB,
  modelALabel,
  models,
  modelBId,
  onModelBChange,
  generating,
  onVerdict,
  onExit,
}: ArenaSplitViewProps) {
  const { t } = useT('chat');

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col md:pt-13">
      <div className="md:divide-border flex min-h-0 min-w-0 flex-1 flex-col md:flex-row md:divide-x">
        <ArenaColumn
          organizationId={organizationId}
          threadId={threadIdA}
          label={t('arena.modelALabel')}
          headerExtra={
            modelALabel !== undefined ? (
              <span className="text-foreground truncate text-sm">
                {modelALabel}
              </span>
            ) : undefined
          }
        />
        <ArenaColumn
          organizationId={organizationId}
          threadId={threadIdB}
          label={t('arena.modelBLabel')}
          headerExtra={
            <ArenaModelPicker
              models={models}
              modelId={modelBId}
              onChange={onModelBChange}
            />
          }
        />
      </div>
      <ArenaVerdictBar
        disabled={generating}
        onVerdict={onVerdict}
        onExit={onExit}
      />
    </div>
  );
}
