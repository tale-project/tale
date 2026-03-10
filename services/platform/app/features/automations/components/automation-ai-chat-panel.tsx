'use client';

import { Sparkles, X } from 'lucide-react';
import { useRef, useEffect } from 'react';

import { PanelHeader } from '@/app/components/layout/panel-header';
import { HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { Heading } from '@/app/components/ui/typography/heading';
import { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useResizable } from '../hooks/use-resizable';
import { AutomationAssistant } from './automation-assistant';

interface AutomationAIChatPanelProps {
  automationId: Id<'wfDefinitions'>;
  organizationId: string;
  onClose: () => void;
  panelWidth?: number;
  onPanelWidthChange?: (width: number) => void;
}

export function AutomationAIChatPanel({
  automationId,
  organizationId,
  onClose,
  panelWidth,
  onPanelWidthChange,
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
      className="bg-background border-border relative flex min-h-0 w-(--panel-width) flex-[0_0_auto] flex-col overflow-hidden border-l max-md:absolute max-md:inset-0 max-md:z-20 max-md:w-full"
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
            aria-label={t('sidePanel.close')}
          >
            <X className="size-4" />
          </Button>
        </HStack>
      </PanelHeader>

      <AutomationAssistant
        automationId={automationId}
        organizationId={organizationId}
      />
    </aside>
  );
}
