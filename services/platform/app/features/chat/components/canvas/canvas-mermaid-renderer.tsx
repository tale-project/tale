'use client';

import { memo, useEffect, useRef, useState } from 'react';

import { useTheme } from '@/app/components/theme/theme-provider';
import { Spinner } from '@/app/components/ui/feedback/spinner';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

interface CanvasMermaidRendererProps {
  code: string;
}

let mermaidDefault: {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
} | null = null;

async function getMermaid() {
  if (!mermaidDefault) {
    const mod = await import('mermaid');
    mermaidDefault = mod.default;
  }
  return mermaidDefault;
}

function CanvasMermaidRendererComponent({ code }: CanvasMermaidRendererProps) {
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
