'use client';

import { Check, Copy } from 'lucide-react';
import { type ReactNode, useCallback, useState } from 'react';

import { cn } from '@/lib/utils/cn';

import { Button } from '../primitives/button';

interface CodeBlockProps {
  children: ReactNode;
  label?: string;
  copyValue?: string;
  copyLabel?: string;
  className?: string;
}

export function CodeBlock({
  children,
  label,
  copyValue,
  copyLabel,
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  }, [copyValue]);

  return (
    <div className={className}>
      {label && (
        <p className="text-muted-foreground mb-1.5 text-xs font-medium">
          {label}
        </p>
      )}
      <div className={cn('group relative', copyValue && 'pr-0')}>
        <pre className="bg-muted rounded-md p-3 pr-10 font-mono text-xs break-all whitespace-pre-wrap">
          {children}
        </pre>
        {copyValue && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={handleCopy}
            aria-label={copyLabel}
          >
            {copied ? (
              <Check className="size-3.5 text-green-500" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
