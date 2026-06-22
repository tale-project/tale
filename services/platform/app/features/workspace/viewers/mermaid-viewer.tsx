'use client';

import { Row } from '@tale/ui/layout';
import { Spinner } from '@tale/ui/spinner';
import { Text } from '@tale/ui/text';
import { useTheme } from '@tale/ui/theme';
import { memo, useEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';

interface MermaidViewerProps {
  code: string;
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

function MermaidViewerComponent({ code }: MermaidViewerProps) {
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
          `workspace-mermaid-${renderId}`,
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
      <Row gap={0} justify="center" className="h-full p-4">
        <Text variant="muted" className="text-sm">
          {error}
        </Text>
      </Row>
    );
  }

  return (
    <div className="relative h-full overflow-auto p-4">
      {isLoading && (
        <Row gap={0} justify="center" className="absolute inset-0">
          <Spinner />
        </Row>
      )}
      <Row
        ref={containerRef}
        gap={0}
        justify="center"
        className="[&_svg]:max-w-full"
      />
    </div>
  );
}

export const MermaidViewer = memo(MermaidViewerComponent);
