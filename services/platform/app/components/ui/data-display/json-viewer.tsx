'use client';

import { Button } from '@tale/ui/button';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { lazyComponent } from '@/lib/utils/lazy-component';

const ReactJsonView = lazyComponent(
  () => import('@microlink/react-json-view'),
  {
    loading: () => (
      <div className="bg-muted rounded-md p-4">
        <div className="animate-pulse">
          <div className="mb-2 h-4 w-1/4 rounded bg-gray-300"></div>
          <div className="mb-2 h-4 w-1/2 rounded bg-gray-300"></div>
          <div className="h-4 w-3/4 rounded bg-gray-300"></div>
        </div>
      </div>
    ),
  },
);

export function JsonViewer({
  data,
  collapsed = false,
  enableClipboard = false,
  indentWidth = 2,
  className,
}: {
  data: unknown;
  collapsed?: boolean | number;
  maxHeight?: boolean;
  enableClipboard?: boolean;
  indentWidth?: number;
  className?: string;
}) {
  const { t } = useT('common');
  const [copied, setCopied] = useState(false);
  const json = useMemo(() => {
    try {
      return JSON.stringify(data, null, indentWidth);
    } catch {
      return String(data);
    }
  }, [data, indentWidth]);

  const parsedData = useMemo(() => {
    try {
      return typeof data === 'string' ? JSON.parse(data) : data;
    } catch {
      return data;
    }
  }, [data]);

  // `react-json-view` accepts only an object or array `src` — anything else
  // renders as the library's own {ERROR: …} placeholder. JSON scalars are
  // honest values too (an automation that maps no `output` returns null, a
  // node can output a bare string), so they render as plain JSON text.
  const isJsonContainer = typeof parsedData === 'object' && parsedData !== null;
  const scalarText = useMemo(() => {
    const text = JSON.stringify(parsedData, null, indentWidth);
    // JSON.stringify(undefined) is undefined, not a string.
    return text === undefined ? String(parsedData) : text;
  }, [parsedData, indentWidth]);

  const handleCopy = async () => {
    try {
      setCopied(true);
      await navigator.clipboard.writeText(json);
    } catch (e) {
      console.error('Failed to copy JSON', e);
    }
  };

  // Convert collapsed prop: false stays false, true becomes 1, number stays as is
  const collapsedDepth =
    collapsed === false ? false : collapsed === true ? 1 : collapsed;

  return (
    <div
      className={cn(
        'bg-background relative max-h-[24rem] overflow-auto p-3 text-xs',
        className,
      )}
    >
      {enableClipboard && (
        <div className="absolute top-2 right-2 z-10">
          <Button
            variant="ghost"
            size="icon"
            title={t('actions.copy')}
            className="p-1"
            onClick={handleCopy}
          >
            {copied ? (
              <CheckIcon className="text-success size-4 p-0.5" />
            ) : (
              <CopyIcon className="size-4 p-0.5" />
            )}
          </Button>
        </div>
      )}
      {isJsonContainer ? (
        <ReactJsonView
          src={parsedData}
          name={false}
          collapsed={collapsedDepth}
          displayObjectSize={false}
          displayDataTypes={false}
          enableClipboard={false}
          quotesOnKeys={false}
          indentWidth={indentWidth}
          theme={{
            base00: 'hsl(var(--background))',
            base01: 'hsl(var(--muted))',
            base02: 'hsl(var(--muted))',
            base03: 'hsl(var(--foreground))',
            base04: 'hsl(var(--foreground))',
            base05: 'hsl(var(--foreground))',
            base06: 'hsl(var(--muted-foreground))',
            base07: 'hsl(var(--foreground))',
            base08: 'hsl(var(--foreground))',
            base09: 'hsl(var(--destructive))',
            base0A: 'rgba(70, 70, 230, 1)',
            base0B: 'rgba(70, 70, 230, 1)',
            base0C: 'rgba(70, 70, 230, 1)',
            base0D: 'rgba(70, 70, 230, 1)',
            base0E: 'rgba(70, 70, 230, 1)',
            base0F: 'rgba(70, 70, 230, 1)',
          }}
          style={{
            backgroundColor: 'transparent',
            fontSize: '12px',
          }}
        />
      ) : (
        <pre className="font-mono break-words whitespace-pre-wrap">
          {scalarText}
        </pre>
      )}
    </div>
  );
}
