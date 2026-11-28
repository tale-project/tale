'use client';

import { CheckIcon, CopyIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '../../i18n/client';
import { cn } from '../../lib/cn';
import { Button } from '../primitives/button';
import { ValueTree } from './value-tree/value-tree';

export interface JsonViewerProps {
  /** A value, or JSON text that is read first. */
  data: unknown;
  /** `false` (the default) opens everything; `true` shows the top level
   *  with its lists and objects closed; a number opens that many levels. */
  collapsed?: boolean | number;
  /** @deprecated The viewer always caps its height at 24rem. */
  maxHeight?: boolean;
  /** A Copy button for the whole value as JSON, and copy actions on every
   *  row (⌘C / ⇧⌘C from the keyboard). */
  enableClipboard?: boolean;
  /** Spaces per level of the JSON text it copies and of a plain value. */
  indentWidth?: number;
  className?: string;
}

/**
 * A JSON value to read: a `ValueTree` of an object or a list (keys, values
 * coloured by type, keyboard navigation, long text cut to a line), or the
 * JSON text of a plain value (`null`, a string, a number). JSON text is
 * read first, so `'{"a":1}'` shows as the object.
 */
export function JsonViewer({
  data,
  collapsed = false,
  enableClipboard = false,
  indentWidth = 2,
  className,
}: JsonViewerProps) {
  const { t } = useT('common');
  const { t: tTree } = useT('valueTree');
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const json = useMemo(() => {
    try {
      return JSON.stringify(data, null, indentWidth);
    } catch (error) {
      console.warn('JsonViewer could not write its data as JSON', error);
      return String(data);
    }
  }, [data, indentWidth]);

  const parsedData = useMemo(() => {
    if (typeof data !== 'string') return data;
    try {
      const parsed: unknown = JSON.parse(data);
      return parsed;
    } catch {
      // Text that is not JSON is shown as the text it is.
      return data;
    }
  }, [data]);

  // An object or a list opens as a tree. A plain value is honest too (an
  // automation that maps no `output` returns null; a node can output a bare
  // string), so it renders as its JSON text.
  const isJsonContainer = typeof parsedData === 'object' && parsedData !== null;
  const scalarText = useMemo(() => {
    const text = JSON.stringify(parsedData, null, indentWidth);
    // JSON.stringify(undefined) is undefined, not a string.
    return text === undefined ? String(parsedData) : text;
  }, [parsedData, indentWidth]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json ?? '');
      setCopied(true);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy JSON', e);
    }
  };

  // `false` opens every level; `true` the top level; a number that many.
  const expandDepth =
    collapsed === false
      ? Number.POSITIVE_INFINITY
      : collapsed === true
        ? 1
        : Math.max(1, collapsed);

  return (
    <div className={cn('bg-background relative text-xs', className)}>
      {enableClipboard && (
        <div className="absolute top-2 right-2 z-10">
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('actions.copy')}
            onClick={() => void handleCopy()}
          >
            {copied ? (
              <CheckIcon aria-hidden="true" className="text-success size-4" />
            ) : (
              <CopyIcon aria-hidden="true" className="size-4" />
            )}
          </Button>
        </div>
      )}
      {isJsonContainer ? (
        <ValueTree
          value={parsedData}
          aria-label={tTree('label')}
          defaultExpandDepth={expandDepth}
          copyable={enableClipboard}
          density="compact"
          className={cn('max-h-[24rem] p-3', enableClipboard && 'pr-11')}
        />
      ) : (
        <div className="max-h-[24rem] overflow-auto p-3">
          <pre className="font-mono break-words whitespace-pre-wrap">
            {scalarText}
          </pre>
        </div>
      )}
    </div>
  );
}
