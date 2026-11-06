'use client';

/**
 * `@tale/ui/code-diff` — two versions of a text compared line by line: a
 * document's YAML, a prompt, a script. Changed lines carry a sign and a
 * tint, the words that changed inside them a stronger tint; unchanged runs
 * fold away; a reader steps from change to change and copies the patch.
 *
 * This module is light: the types, rows of the same height as the diff's
 * while its implementation (`code-diff-view.tsx`: jsdiff and the
 * highlighter) loads, and the words a failed load leaves in its place.
 * Nothing here imports jsdiff or Shiki, so a page that shows no diff never
 * downloads them.
 */

import {
  forwardRef,
  lazy,
  Suspense,
  type ForwardRefExoticComponent,
  type RefAttributes,
} from 'react';

import { useT } from '../../../i18n/client';
import { cn } from '../../../lib/cn';
import { ErrorBoundaryBase } from '../../error-boundaries/core/error-boundary-base';
import { SKELETON_PULSE } from '../../feedback/skeleton';
import { Button } from '../../primitives/button';
import type { CodeDiffHandle, CodeDiffProps } from './types';

export type { CodeDiffHandle, CodeDiffLayout, CodeDiffProps } from './types';

const loadView = () => import('./code-diff-view');
/** The diff's implementation, shared by every diff. React keeps a lazy
 *  component whose load failed failed for good, so a retry swaps in a fresh
 *  one (`retryView`). */
let CodeDiffView = lazy(loadView);
let viewFailed = false;
function retryView(): void {
  if (!viewFailed) return;
  viewFailed = false;
  CodeDiffView = lazy(loadView);
}

/**
 * Starts loading the diff's implementation, so the first diff a reader
 * opens is ready. Idempotent and fire-and-forget.
 */
export function preloadCodeDiff(): void {
  loadView().catch((error: unknown) => {
    console.warn('[code-diff] preload failed', error);
  });
}

/** Placeholder bars, as wide as lines of code tend to be. */
const WIDTHS = ['w-3/5', 'w-2/5', 'w-4/5', 'w-1/2', 'w-3/4', 'w-1/3'];

/** The rows a diff shows while it loads: as tall as its lines (20 px), as
 *  many as the newer text has lines, up to twelve. */
function LoadingRows({ lines, label }: { lines: number; label: string }) {
  return (
    <div aria-busy="true" data-code-diff-loading="">
      <div aria-hidden="true" className="flex flex-col">
        {Array.from({ length: lines }, (_, index) => (
          <span key={index} className="flex h-5 items-center pl-[7.5rem]">
            <span
              className={cn(
                SKELETON_PULSE,
                'h-2.5 rounded-sm',
                WIDTHS[index % WIDTHS.length],
              )}
            />
          </span>
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** What a failed load leaves: the words and a way to try again. */
function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useT('codeDiff');
  const { t: tCommon } = useT('common');
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">{t('loadFailed')}</span>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        {tCommon('actions.tryAgain')}
      </Button>
    </div>
  );
}

/** How many placeholder rows the loading diff shows. */
function placeholderLines(after: string): number {
  let lines = 1;
  for (let index = 0; index < after.length && lines < 12; index++)
    if (after.charCodeAt(index) === 10) lines++;
  return Math.min(lines, 12);
}

const CodeDiffBase = forwardRef<CodeDiffHandle, CodeDiffProps>(
  function CodeDiff(props, ref) {
    const { t } = useT('codeDiff');
    return (
      <div data-code-diff="" className={cn('min-w-0', props.className)}>
        <ErrorBoundaryBase
          onError={(error) => {
            viewFailed = true;
            console.warn('[code-diff] the diff did not load', error);
          }}
          onReset={retryView}
          fallback={({ reset }) => <LoadFailed onRetry={reset} />}
        >
          <Suspense
            fallback={
              <LoadingRows
                lines={placeholderLines(props.after)}
                label={t('loading')}
              />
            }
          >
            <CodeDiffView {...props} className={undefined} ref={ref} />
          </Suspense>
        </ErrorBoundaryBase>
      </div>
    );
  },
);

/**
 * Two versions of a text compared line by line: a sign and a tint on each
 * changed line, the changed words inside it in a stronger tint, unchanged
 * runs folded, a header a reader steps to on each change (Previous / Next,
 * or `[` and `]`), side by side from 64rem, and Copy patch.
 */
export const CodeDiff: ForwardRefExoticComponent<
  CodeDiffProps & RefAttributes<CodeDiffHandle>
> = CodeDiffBase;
