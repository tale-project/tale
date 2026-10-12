import type { ReactNode } from 'react';

import type { CodeLanguage } from '../../../lib/code-roles';

/** `unified`: one column, a change's removed lines above the lines added
 *  in their place. `split`: the two texts side by side. */
export type CodeDiffLayout = 'unified' | 'split';

export interface CodeDiffProps {
  before: string;
  after: string;
  /** What the texts hold, highlighted as the code editor does. */
  language: CodeLanguage;
  /** The texts may hold `{{ js }}` templates (JSON, YAML, Markdown, text). */
  templates?: boolean;
  /** The two sides' names ("v4", "v5"): the hunk headers, the screen
   *  reader's column names and a copied patch's file headers. */
  beforeLabel: string;
  afterLabel: string;
  /** @default 'unified' — `split` shows from a 64rem wide container;
   *  narrower, the unified layout does. */
  layout?: CodeDiffLayout;
  /** Controls the layout: the toolbar's switch reports the reader's pick. */
  onLayoutChange?: (layout: CodeDiffLayout) => void;
  /** Unchanged lines kept round each change. @default 3 */
  context?: number;
  /** Marks the words that changed in a changed line. @default true */
  wordDiff?: boolean;
  /** @default true */
  lineNumbers?: boolean;
  /** Previous and next change, where the reader is, the layout switch
   *  and Copy patch. @default true */
  toolbar?: boolean;
  /** Bounds the diff to a scroll region of this height (a CSS length);
   *  without it the page scrolls. */
  maxHeight?: string;
  /** Instead of "No differences" when the texts are the same. */
  emptyMessage?: ReactNode;
  'aria-label': string;
  className?: string;
}

/** Moves the reader through the changes: each focuses a hunk's header,
 *  brings it to the middle of the view and says where the reader is. */
export interface CodeDiffHandle {
  nextChange(): void;
  previousChange(): void;
  /** The hunk at `index`, from 0. */
  focusChange(index: number): void;
}
