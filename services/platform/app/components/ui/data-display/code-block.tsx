'use client';

import { Check, Copy } from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

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
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  }, [copyValue]);

  const ariaLabel = copyLabel ?? 'Copy';

  return (
    <div className={className}>
      {label && (
        <p className="text-muted-foreground mb-1.5 text-xs font-medium">
          {label}
        </p>
      )}
      <div className="group relative">
        <pre
          className={cn(
            'bg-muted rounded-md p-3 font-mono text-xs break-all whitespace-pre-wrap',
            copyValue && 'pr-10',
          )}
        >
          {children}
        </pre>
        {copyValue && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={handleCopy}
            aria-label={ariaLabel}
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
