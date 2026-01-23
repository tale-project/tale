'use client';

import { JsonViewer } from '@/app/components/ui/data-display/json-viewer';
import {
  Zap,
  Cpu,
  HelpCircle,
  CheckCircle2,
  Repeat,
  Pickaxe,
  Sparkles,
  TestTubeDiagonal,
  Workflow,
  Trash2,
} from 'lucide-react';
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from '@/app/components/ui/overlays/tooltip';
import { cn } from '@/lib/utils/cn';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Doc, Id } from '@/convex/_generated/dataModel';
import { AutomationTester } from './automation-tester';
import { AutomationAssistant } from './automation-assistant';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

interface AutomationSidePanelProps {
  step: Doc<'wfStepDefs'> | null;
  isOpen: boolean;
  onClose: () => void;
  showAIChat?: boolean;
  showTestPanel?: boolean;
  automationId?: Id<'wfDefinitions'>;
  organizationId?: string;
}

const getStepIcon = (stepType: string) => {
  switch (stepType) {
    case 'trigger':
      return <Zap className="size-4" />;
    case 'llm':
      return <Cpu className="size-4" />;
    case 'condition':
      return <HelpCircle className="size-4" />;
    case 'approval':
      return <CheckCircle2 className="size-4" />;
    case 'loop':
      return <Repeat className="size-4" />;
    case 'action':
      return <Pickaxe className="size-4" />;
    default:
      return <div className="size-4 rounded-full bg-muted" />;
  }
};

const getStepTypeColor = (stepType: string) => {
  switch (stepType) {
    case 'trigger':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300';
    case 'llm':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300';
    case 'condition':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';

    case 'loop':
      return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300';
    case 'action':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

export function AutomationSidePanel({
  step,
  isOpen,
  onClose,
  showAIChat = false,
  showTestPanel = false,
  automationId,
  organizationId,
}: AutomationSidePanelProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const [width, setWidth] = useState(384); // 96 * 4 = 384px (w-96)
  const [isResizing, setIsResizing] = useState(false);
  const [canClearChat, setCanClearChat] = useState(false);
  const clearChatRef = useRef<(() => void) | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleClearChatStateChange = useCallback(
    (canClear: boolean, clearFn: () => void) => {
      setCanClearChat(canClear);
      clearChatRef.current = clearFn;
    },
    [],
  );

  const handleClearChat = useCallback(() => {
    clearChatRef.current?.();
  }, []);

  const MIN_WIDTH = 280; // ~70 in tailwind
  const MAX_WIDTH = 600; // ~150 in tailwind

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !panelRef.current) return;

      const panelRect = panelRef.current.getBoundingClientRect();
      const newWidth = panelRect.right - e.clientX;

      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, MIN_WIDTH, MAX_WIDTH]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      style={{ '--panel-width': `${width}px` } as React.CSSProperties}
      className="bg-background border-l border-border flex flex-col flex-[0_0_auto] min-h-0 relative overflow-hidden w-(--panel-width) max-md:w-full max-md:absolute max-md:inset-0 max-md:z-10"
    >
      {/* Resize handle - hidden on mobile */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'absolute left-0 top-0 bottom-0 w-px cursor-col-resize z-10 max-md:hidden',
          'hover:bg-border transition-colors',
        )}
      >
        <div className="absolute left-0 top-0 bottom-0 w-2 -translate-x-1/2" />
      </div>

      {/* Panel header */}
      <div className="bg-background/70 backdrop-blur-sm p-3 border-b border-border shrink-0 sticky top-0">
        <div className="flex items-center gap-3">
          {showAIChat ? (
            <>
              <div className="p-2 rounded-lg bg-purple-600 text-white dark:bg-purple-700">
                <Sparkles className="size-4" />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-foreground">
                  {t('sidePanel.aiAssistant')}
                </h2>
              </div>
            </>
          ) : showTestPanel ? (
            <>
              <div className="p-2 rounded-lg border bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <TestTubeDiagonal className="size-4" />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-foreground">
                  {t('sidePanel.testAutomation')}
                </h2>
              </div>
            </>
          ) : step ? (
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        'p-2 rounded-lg border',
                        getStepTypeColor(step.stepType),
                      )}
                    >
                      {getStepIcon(step.stepType)}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {t('sidePanel.stepTooltip', { stepType: step.stepType })}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-foreground">
                  {step.name}
                </h2>
              </div>
            </>
          ) : null}
          {/* Desktop action buttons */}
          {showAIChat && canClearChat && (
            <div className="hidden md:flex items-center shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={handleClearChat}
                aria-label={tCommon('actions.delete')}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          )}
          {/* Mobile action buttons */}
          <div className="flex items-center gap-1 md:hidden shrink-0">
            {showAIChat && canClearChat && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={handleClearChat}
                aria-label={tCommon('actions.delete')}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
            <Button
              size="icon"
              className="size-8"
              onClick={onClose}
              aria-label={t('sidePanel.viewAutomation')}
            >
              <Workflow className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Panel content */}
      {showTestPanel && automationId && organizationId ? (
        <AutomationTester
          organizationId={organizationId}
          automationId={automationId}
        />
      ) : showAIChat && organizationId ? (
        <AutomationAssistant
          automationId={automationId}
          organizationId={organizationId}
          onClearChatStateChange={handleClearChatStateChange}
        />
      ) : step ? (
        <div className="flex-1 overflow-y-auto p-3">
          <JsonViewer
            className="rounded-xl border max-h-none px-2"
            data={step.config || {}}
            collapsed={false}
            enableClipboard={true}
            maxHeight={false}
            indentWidth={1}
          />
        </div>
      ) : null}
    </div>
  );
}
