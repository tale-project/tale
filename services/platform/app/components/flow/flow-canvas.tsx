'use client';

import '@xyflow/react/dist/style.css';
import { Button } from '@tale/ui/button';
import { useTheme } from '@tale/ui/theme';
import {
  Background,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  type ReactFlowProps,
} from '@xyflow/react';
import { Maximize, Minus, Plus, Sparkles } from 'lucide-react';
import type { ComponentProps } from 'react';

import { useT } from '@/lib/i18n/client';

/**
 * The ONE base React Flow canvas every graph editor in the app builds on
 * (the automations step editor and the agent organigram today). Owns the
 * shared chrome and house defaults — theme-reactive `colorMode`, hidden
 * attribution, initial fit, and the corner control cluster (zoom in / out /
 * reset, plus the AI-editor toggle when `onOpenAi` is wired) — so editors
 * differ only in nodes/edges/handlers and minimap/background styling:
 *
 *  - `backgroundProps` — always rendered; pass variant/gap/color to style.
 *  - `minimapProps`    — renders a MiniMap when provided.
 *  - `onOpenAi`        — adds the ✨ button to the corner cluster.
 *
 * Everything else spreads onto `<ReactFlow>` untouched; overlays and
 * `<Panel>`s ride through `children`.
 */
export interface FlowCanvasProps extends ReactFlowProps {
  backgroundProps?: ComponentProps<typeof Background>;
  minimapProps?: ComponentProps<typeof MiniMap>;
  /** Opens the editor's AI assistant panel (✨ in the corner cluster). */
  onOpenAi?: () => void;
}

/** Corner cluster: zoom in / zoom out / reset view (+ optional AI toggle).
 *  Must render INSIDE <ReactFlow> — `useReactFlow` reads its store. */
function FlowCornerControls({ onOpenAi }: { onOpenAi?: () => void }) {
  const { t } = useT('common');
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <Panel position="bottom-left" className="flex flex-col gap-1">
      <Button
        size="icon"
        variant="secondary"
        aria-label={t('flow.zoomIn')}
        title={t('flow.zoomIn')}
        onClick={() => void zoomIn({ duration: 150 })}
      >
        <Plus className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="secondary"
        aria-label={t('flow.zoomOut')}
        title={t('flow.zoomOut')}
        onClick={() => void zoomOut({ duration: 150 })}
      >
        <Minus className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="secondary"
        aria-label={t('flow.resetView')}
        title={t('flow.resetView')}
        onClick={() => void fitView({ padding: 0.2, duration: 300 })}
      >
        <Maximize className="size-4" />
      </Button>
      {onOpenAi && (
        <Button
          size="icon"
          aria-label={t('flow.aiEditor')}
          title={t('flow.aiEditor')}
          onClick={onOpenAi}
          className="bg-purple-600 text-white hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-800"
        >
          <Sparkles className="size-4" />
        </Button>
      )}
    </Panel>
  );
}

export function FlowCanvas({
  backgroundProps,
  minimapProps,
  onOpenAi,
  children,
  ...flowProps
}: FlowCanvasProps) {
  const { resolvedTheme } = useTheme();
  return (
    <ReactFlow
      colorMode={resolvedTheme}
      fitView
      proOptions={{ hideAttribution: true }}
      {...flowProps}
    >
      <Background {...backgroundProps} />
      <FlowCornerControls onOpenAi={onOpenAi} />
      {minimapProps && <MiniMap {...minimapProps} />}
      {children}
    </ReactFlow>
  );
}
