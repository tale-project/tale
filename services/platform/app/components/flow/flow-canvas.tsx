'use client';

import '@xyflow/react/dist/style.css';
import { Button } from '@tale/ui/button';
import { HStack } from '@tale/ui/layout';
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
import type { ComponentProps, ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

/**
 * The ONE base React Flow canvas every graph editor in the app builds on
 * (the automation canvas today). Owns the
 * shared chrome and house defaults — theme-reactive `colorMode`, hidden
 * attribution, initial fit, the corner zoom cluster (zoom in / out / reset)
 * and the bottom-center action toolbar (editor actions + the AI-editor
 * toggle) — so editors differ only in nodes/edges/handlers and
 * minimap/background styling:
 *
 *  - `backgroundProps` — always rendered; pass variant/gap/color to style.
 *  - `minimapProps`    — renders a MiniMap when provided.
 *  - `centerActions`   — editor-specific buttons in the bottom-center toolbar.
 *  - `onOpenAi`        — adds the ✨ button to the bottom-center toolbar.
 *
 * Everything else spreads onto `<ReactFlow>` untouched; overlays and
 * `<Panel>`s ride through `children`.
 */
export interface FlowCanvasProps extends ReactFlowProps {
  backgroundProps?: ComponentProps<typeof Background>;
  minimapProps?: ComponentProps<typeof MiniMap>;
  /** Editor-specific buttons rendered in the bottom-center toolbar. */
  centerActions?: ReactNode;
  /** Opens the editor's AI assistant panel (✨ in the bottom-center toolbar). */
  onOpenAi?: () => void;
  /** Whether the AI assistant panel is open — drives the ✨ button's pressed
   *  (active) state so it reads as a toggle rather than a one-way open. */
  aiOpen?: boolean;
}

/** Corner cluster: zoom in / zoom out / reset view.
 *  Must render INSIDE <ReactFlow> — `useReactFlow` reads its store. */
function FlowCornerControls() {
  const { t } = useT('common');
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <Panel position="bottom-left" className="flex flex-col gap-1">
      <Button
        size="icon"
        variant="secondary"
        title={t('flow.zoomIn')}
        tooltipSide="right"
        onClick={() => void zoomIn({ duration: 150 })}
      >
        <Plus className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="secondary"
        title={t('flow.zoomOut')}
        tooltipSide="right"
        onClick={() => void zoomOut({ duration: 150 })}
      >
        <Minus className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="secondary"
        title={t('flow.resetView')}
        tooltipSide="right"
        onClick={() => void fitView({ padding: 0.2, duration: 300 })}
      >
        <Maximize className="size-4" />
      </Button>
    </Panel>
  );
}

/** Bottom-center toolbar: the editor's primary actions (+ the AI toggle). */
function FlowCenterToolbar({
  centerActions,
  onOpenAi,
  aiOpen,
}: {
  centerActions?: ReactNode;
  onOpenAi?: () => void;
  aiOpen?: boolean;
}) {
  const { t } = useT('common');
  if (!centerActions && !onOpenAi) return null;
  return (
    <Panel position="bottom-center" className="mb-4">
      <HStack
        gap={2}
        className="ring-border bg-background rounded-lg p-1 shadow-sm ring-1"
      >
        {centerActions}
        {onOpenAi && (
          <Button
            variant="secondary"
            size="icon"
            title={t('flow.aiEditor')}
            aria-pressed={aiOpen}
            onClick={onOpenAi}
          >
            <Sparkles className="size-4" />
          </Button>
        )}
      </HStack>
    </Panel>
  );
}

export function FlowCanvas({
  backgroundProps,
  minimapProps,
  centerActions,
  onOpenAi,
  aiOpen,
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
      <FlowCornerControls />
      <FlowCenterToolbar
        centerActions={centerActions}
        onOpenAi={onOpenAi}
        aiOpen={aiOpen}
      />
      {minimapProps && <MiniMap {...minimapProps} />}
      {children}
    </ReactFlow>
  );
}
