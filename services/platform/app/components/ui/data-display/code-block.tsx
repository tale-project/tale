'use client';

import { Check, Copy } from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useTheme } from '@/app/components/theme/theme-provider';
import { cn } from '@/lib/utils/cn';
import { extractShikiCodeContent, highlightCode } from '@/lib/utils/shiki';

import { Button } from '../primitives/button';
import { Text } from '../typography/text';

interface CodeBlockProps {
  children: ReactNode;
  language?: string;
  label?: string;
  copyValue?: string;
  copyLabel?: string;
  className?: string;
}

function PlainCodeLines({ text }: { text: string }) {
  const lines = useMemo(() => text.split('\n'), [text]);
  return (
    <>
      {lines.map((line, i) => (
        <span key={i} className="line">
          {line}
          {i < lines.length - 1 ? '\n' : ''}
        </span>
      ))}
    </>
  );
}

export function CodeBlock({
  children,
  language,
  label,
  copyValue,
  copyLabel,
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const { resolvedTheme } = useTheme();
  const shikiTheme = resolvedTheme === 'dark' ? 'github-dark' : 'github-light';

  const textContent =
    typeof children === 'string'
      ? children
      : Array.isArray(children)
        ? children.join('')
        : '';

  useEffect(() => {
    if (!language || !textContent) return undefined;
    let cancelled = false;
    void highlightCode(textContent, language, shikiTheme).then((result) => {
      if (!cancelled && result) {
        setHighlightedHtml(extractShikiCodeContent(result));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [textContent, language, shikiTheme]);

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
        <Text variant="caption" className="mb-1.5 font-medium">
          {label}
        </Text>
      )}
      <div className="group relative">
        <pre
          className={cn(
            'bg-muted rounded-md p-3 font-mono text-xs break-all whitespace-pre-wrap',
            copyValue && 'pr-10',
            language &&
              'code-line-numbers code-line-hover whitespace-pre break-normal',
          )}
        >
          {language && highlightedHtml ? (
            <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
          ) : language && textContent ? (
            <code>
              <PlainCodeLines text={textContent} />
            </code>
          ) : (
            children
          )}
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
