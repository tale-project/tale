'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const ReactJsonView = dynamic(() => import('@microlink/react-json-view'), {
  ssr: false,
  loading: () => (
    <div className="bg-muted p-4 rounded-md">
      <div className="animate-pulse">
        <div className="h-4 bg-gray-300 rounded w-1/4 mb-2"></div>
        <div className="h-4 bg-gray-300 rounded w-1/2 mb-2"></div>
        <div className="h-4 bg-gray-300 rounded w-3/4"></div>
      </div>
    </div>
  ),
});

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
        'relative text-xs bg-background p-3 overflow-auto max-h-[24rem]',
        className,
      )}
    >
      {enableClipboard && (
        <div className="absolute right-2 top-2 z-10">
          <Button
            variant="ghost"
            size="icon"
            className="p-1"
            onClick={handleCopy}
          >
            {copied ? (
              <CheckIcon className="size-4 text-success p-0.5" />
            ) : (
              <CopyIcon className="size-4 p-0.5" />
            )}
          </Button>
        </div>
      )}
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
    </div>
  );
}
