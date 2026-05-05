'use client';

import { Spinner } from '@tale/ui/spinner';
import { memo, useEffect, useRef, useState } from 'react';

import { useTheme } from '@/app/components/theme/theme-provider';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface CanvasMermaidRendererProps {
  code: string;
  isEditing: boolean;
  onContentChange: (content: string) => void;
}

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
};

let mermaidDefault: MermaidApi | null = null;

async function getMermaid(): Promise<MermaidApi> {
  if (!mermaidDefault) {
    const mod = await import('mermaid');
    mermaidDefault = mod.default;
  }
  return mermaidDefault;
}

function CanvasMermaidRendererComponent({
  code,
  isEditing,
  onContentChange,
}: CanvasMermaidRendererProps) {
  const { t } = useT('chat');
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { resolvedTheme } = useTheme();
  const renderIdRef = useRef(0);

  useEffect(() => {
    const renderId = ++renderIdRef.current;
    setIsLoading(true);
    setError(null);

    void (async () => {
      try {
        const mermaid = await getMermaid();
        if (renderId !== renderIdRef.current) return;

        mermaid.initialize({
          startOnLoad: false,
          theme: resolvedTheme === 'dark' ? 'dark' : 'default',
          securityLevel: 'strict',
        });

        const { svg } = await mermaid.render(
          `mermaid-canvas-${renderId}`,
          code,
        );

        if (renderId !== renderIdRef.current) return;
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err) {
        if (renderId !== renderIdRef.current) return;
        setError(err instanceof Error ? err.message : t('canvas.mermaidError'));
      } finally {
        if (renderId === renderIdRef.current) {
          setIsLoading(false);
        }
      }
    })();
  }, [code, resolvedTheme, t]);

  if (isEditing) {
    return (
      <div className="flex h-full flex-col">
        <textarea
          value={code}
          onChange={(e) => onContentChange(e.target.value)}
          className={cn(
            'bg-muted text-foreground min-h-0 flex-1 resize-none p-4 font-mono text-xs leading-relaxed',
            'focus:outline-none',
          )}
          spellCheck={false}
          aria-label={t('canvas.mermaidEditor')}
        />
        {error && (
          <div className="border-border bg-destructive/10 border-t px-4 py-2">
            <Text variant="muted" className="text-destructive text-xs">
              {error}
            </Text>
          </div>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Text variant="muted" className="text-sm">
          {error}
        </Text>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-auto p-4">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner />
        </div>
      )}
      <div
        ref={containerRef}
        className="flex items-center justify-center [&_svg]:max-w-full"
      />
    </div>
  );
}

export const CanvasMermaidRenderer = memo(CanvasMermaidRendererComponent);
