'use client';

import { CopyIcon, CheckIcon } from 'lucide-react';
import {
  ComponentPropsWithoutRef,
  ReactNode,
  useRef,
  useState,
  useEffect,
  memo,
} from 'react';

import { useTheme } from '@/app/components/theme/theme-provider';
import { Button } from '@/app/components/ui/primitives/button';
import { highlightCode } from '@/lib/utils/shiki';

/**
 * Extract the inner HTML from Shiki's codeToHtml output.
 * Shiki wraps output in `<pre class="shiki ..."><code>...tokens...</code></pre>`.
 * Since we're already inside a `<pre>` from react-markdown's CodeBlock,
 * we extract only the inner content of the `<code>` element.
 */
function extractShikiCodeContent(html: string): string {
  const codeMatch = html.match(/<code[^>]*>([\s\S]*?)<\/code>/);
  return codeMatch ? codeMatch[1] : html;
}

export const HighlightedCode = memo(function HighlightedCode({
  lang,
  code,
}: {
  lang: string;
  code: string;
}) {
  const [html, setHtml] = useState<string>('');
  const { resolvedTheme } = useTheme();
  const shikiTheme = resolvedTheme === 'dark' ? 'github-dark' : 'github-light';

  useEffect(() => {
    let cancelled = false;
    void highlightCode(code, lang, shikiTheme).then((result) => {
      if (!cancelled && result) setHtml(extractShikiCodeContent(result));
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang, shikiTheme]);

  if (!html) {
    const lines = code.split('\n');
    return (
      <code>
        {lines.map((line, i) => (
          <span key={i} className="line">
            {line}
            {i < lines.length - 1 ? '\n' : ''}
          </span>
        ))}
      </code>
    );
  }

  return <code dangerouslySetInnerHTML={{ __html: html }} />;
});

export function CodeBlock({
  children,
  ...props
}: ComponentPropsWithoutRef<'pre'> & { children?: ReactNode }) {
  const [isCopied, setIsCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    const textContent = preRef.current?.textContent ?? '';

    try {
      await navigator.clipboard.writeText(textContent);
      setIsCopied(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy code:', error);
    }
  };

  return (
    <div className="group code-line-numbers relative">
      <pre
        ref={preRef}
        {...props}
        className="max-w-(--chat-max-width) overflow-x-auto"
      >
        {children}
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="bg-background/80 hover:bg-background absolute top-2 right-2 size-7 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={handleCopy}
      >
        {isCopied ? (
          <CheckIcon className="text-success size-3.5" />
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </Button>
    </div>
  );
}
