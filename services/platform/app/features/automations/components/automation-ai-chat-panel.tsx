'use client';

import { Button } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { HStack } from '@tale/ui/layout';
import { Sparkles, X } from 'lucide-react';
import { useRef, useEffect } from 'react';

import { PanelHeader } from '@/app/components/layout/panel-header';
import { useResizable } from '@/app/hooks/use-resizable';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { AutomationAssistant } from './automation-assistant';

interface AutomationAIChatPanelProps {
  workflowSlug?: string;
  workflowName?: string;
  organizationId: string;
  onClose: () => void;
  panelWidth?: number;
  onPanelWidthChange?: (width: number) => void;
  /** When true, the panel floats over the page content instead of taking layout space. */
  overlay?: boolean;
}

export function AutomationAIChatPanel({
  workflowSlug,
  workflowName,
  organizationId,
  onClose,
  panelWidth,
  onPanelWidthChange,
  overlay = false,
}: AutomationAIChatPanelProps) {
  const { t } = useT('automations');
  const panelRef = useRef<HTMLDivElement>(null);
  const { width, minWidth, maxWidth, handleMouseDown, handleKeyDown } =
    useResizable(panelRef, {
      width: panelWidth,
      onWidthChange: onPanelWidthChange,
    });

  useEffect(() => {
    const handleEscapeKey = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !e.defaultPrevented &&
        document.activeElement?.closest('[role="dialog"]') === null
      ) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscapeKey);
    return () => document.removeEventListener('keydown', handleEscapeKey);
  }, [onClose]);

  return (
    <aside
      ref={panelRef}
      role="complementary"
      aria-label={t('sidePanel.aiAssistant')}
      style={{ '--panel-width': `${width}px` }}
      className={cn(
        'bg-background border-border flex min-h-0 w-(--panel-width) flex-col overflow-hidden border-l shadow-lg max-md:absolute max-md:inset-0 max-md:z-20 max-md:w-full max-md:shadow-none',
        overlay
          ? 'absolute top-0 right-0 bottom-0 z-20'
          : 'relative flex-[0_0_auto] shadow-none',
      )}
    >
      {/* Resize handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('sidePanel.resizePanel')}
        tabIndex={0}
        onMouseDown={handleMouseDown}
        onKeyDown={handleKeyDown}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        className={cn(
          'absolute left-0 top-0 bottom-0 w-px cursor-col-resize z-51 max-md:hidden',
          'hover:bg-border focus-visible:ring-2 focus-visible:ring-ring transition-colors',
        )}
      >
        <div className="absolute top-0 bottom-0 left-0 w-2 -translate-x-1/2" />
      </div>

      <PanelHeader variant="compact" className="gap-3">
        <div className="rounded-lg bg-purple-600 p-2 text-white dark:bg-purple-700">
          <Sparkles className="size-4" />
        </div>
        <div className="flex-1">
          <Heading level={2} size="sm">
            {t('sidePanel.aiAssistant')}
          </Heading>
        </div>
        <HStack gap={1} className="shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onClose}
            title={t('sidePanel.close')}
          >
            <X className="size-4" />
          </Button>
        </HStack>
      </PanelHeader>

      <AutomationAssistant
        workflowSlug={workflowSlug}
        workflowName={workflowName}
        organizationId={organizationId}
      />
    </aside>
  );
}
