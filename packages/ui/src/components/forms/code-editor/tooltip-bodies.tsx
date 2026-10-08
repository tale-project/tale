'use client';

import { Wrench } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';

import { useT } from '../../../i18n/client';
import { IssueSeverityIcon } from '../../feedback/issue-severity';
import { Button } from '../../primitives/button';
import type { PlacedDiagnostic, PlacedFix } from './extensions/diagnostics';
import { highlightType } from './extensions/highlight';
import type { CodeHoverInfo } from './providers';

/**
 * The React bodies of the editor's tooltips, rendered into the DOM
 * CodeMirror positions (see `extensions/tooltips.ts`).
 */

/** Arrow keys move between a tooltip's fix buttons. */
function moveBetweenButtons(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button'),
  ];
  const at = buttons.findIndex((button) => button === document.activeElement);
  if (at === -1) return;
  event.preventDefault();
  const next =
    (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
    buttons.length;
  buttons[next]?.focus();
}

export function DiagnosticTooltipBody({
  items,
  focusFix,
  onFix,
}: {
  items: readonly PlacedDiagnostic[];
  focusFix: boolean;
  onFix: (fix: PlacedFix) => void;
}) {
  const { t } = useT('codeEditor');
  const firstFix = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusFix) firstFix.current?.focus();
  }, [focusFix]);
  const severity = {
    error: t('diagnostics.severity.error'),
    warning: t('diagnostics.severity.warning'),
    info: t('diagnostics.severity.info'),
  };
  const fixes = items.flatMap((item) => item.fixes);
  return (
    <div className="flex max-w-80 flex-col gap-2 p-2">
      {items.map((item) => (
        <div key={item.key} className="flex gap-2">
          <IssueSeverityIcon
            severity={item.diagnostic.severity}
            className="mt-0.5 size-4 shrink-0"
          />
          <div className="min-w-0 space-y-1">
            <p className="text-foreground text-sm break-words">
              <span className="sr-only">
                {severity[item.diagnostic.severity]}:{' '}
              </span>
              {item.diagnostic.message}
            </p>
            {item.diagnostic.detail}
            {item.diagnostic.code !== undefined ? (
              <p className="text-muted-foreground font-mono text-xs">
                {item.diagnostic.code}
              </p>
            ) : null}
          </div>
        </div>
      ))}
      {fixes.length > 0 ? (
        <div
          role="toolbar"
          tabIndex={-1}
          aria-orientation="vertical"
          aria-label={t('diagnostics.fixMenu')}
          className="border-border flex flex-col items-start gap-1 border-t pt-2"
          onKeyDown={moveBetweenButtons}
        >
          {fixes.map((fix, index) => (
            <Button
              key={`${fix.label}-${index}`}
              ref={index === 0 ? firstFix : undefined}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onFix(fix)}
            >
              <Wrench className="size-3.5" aria-hidden="true" />
              {fix.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A TypeScript type in the editor's colours. */
function TypeText({ type }: { type: string }) {
  return (
    <code className="font-mono text-xs break-words whitespace-pre-wrap">
      {highlightType(type).map((run, index) => (
        <span key={index} className={run.className || undefined}>
          {run.text}
        </span>
      ))}
    </code>
  );
}

export function TypeTooltipBody({ info }: { info: CodeHoverInfo }) {
  const { t } = useT('codeEditor');
  return (
    <div className="flex max-w-80 flex-col gap-1 p-2 text-xs">
      {info.title !== undefined ? (
        <p className="text-foreground font-mono font-medium break-all">
          {info.title}
        </p>
      ) : null}
      <p className="flex gap-1">
        <span className="text-muted-foreground shrink-0">
          {t('typeInfo.label')}
        </span>
        <TypeText type={info.type} />
      </p>
      {info.description !== undefined ? (
        <p className="text-foreground">{info.description}</p>
      ) : null}
      {info.sample !== undefined ? (
        <p className="text-muted-foreground font-mono break-all">
          {t('typeInfo.sample', { value: info.sample })}
        </p>
      ) : null}
    </div>
  );
}
