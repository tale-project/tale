'use client';

// Shared file-tree vocabulary for the workspace panes: the external-agent
// "Workspace files" explorer and the canvas file tree render the same row
// primitive (WAI-ARIA treeitem, depth indentation, mono filename), the same
// per-extension icons, and the same keyboard navigation, so the two trees
// cannot drift apart visually or behaviourally.

import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
} from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

/** Per-extension file icon (falls back to the generic file glyph). */
export function iconForPath(name: string): typeof File {
  const lower = name.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.mdx')) return FileText;
  if (lower.endsWith('.json') || lower.endsWith('.jsonc')) return FileJson;
  if (
    lower.endsWith('.py') ||
    lower.endsWith('.js') ||
    lower.endsWith('.cjs') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.sh') ||
    lower.endsWith('.bash') ||
    lower.endsWith('.zsh') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.yml') ||
    lower.endsWith('.toml')
  ) {
    return FileCode;
  }
  if (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.svg') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.ico') ||
    lower.endsWith('.bmp') ||
    lower.endsWith('.avif')
  ) {
    return FileImage;
  }
  if (
    lower.endsWith('.csv') ||
    lower.endsWith('.xlsx') ||
    lower.endsWith('.tsv')
  ) {
    return FileSpreadsheet;
  }
  if (
    lower.endsWith('.zip') ||
    lower.endsWith('.tar') ||
    lower.endsWith('.gz') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.7z') ||
    lower.endsWith('.rar')
  ) {
    return FileArchive;
  }
  return File;
}

export interface TreeRowButtonProps {
  isActive: boolean;
  depth: number;
  onClick: () => void;
  title: string;
  ariaLabel: string;
  ariaExpanded?: boolean;
  /** Roving-tabindex override: pass when the ACTIVE row cannot carry the tab
   *  stop (e.g. nothing is selected yet — some row must still let Tab enter
   *  the tree). Defaults to `isActive`. */
  tabbable?: boolean;
  /** Visibly and semantically disabled (aria-disabled, muted, inert click) —
   *  for panels that must freeze the tree while a mutation is in flight. */
  disabled?: boolean;
  dataDirPath?: string;
  dataParentPath?: string | null;
  children: ReactNode;
}

/** One tree row (directory or file): WAI-ARIA treeitem with roving tabindex,
 *  depth-indented, `bg-muted` when active. */
export function TreeRowButton({
  isActive,
  depth,
  onClick,
  title,
  ariaLabel,
  ariaExpanded,
  tabbable,
  disabled,
  dataDirPath,
  dataParentPath,
  children,
}: TreeRowButtonProps) {
  const state = isActive
    ? 'bg-muted text-foreground'
    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground';
  return (
    <button
      type="button"
      role="treeitem"
      aria-selected={isActive}
      aria-level={depth + 1}
      // aria-disabled (not the disabled attribute): the row stays focusable
      // so keyboard users can still traverse the tree while it is frozen.
      aria-disabled={disabled === true || undefined}
      tabIndex={(tabbable ?? isActive) ? 0 : -1}
      onClick={disabled === true ? undefined : onClick}
      title={title}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      data-dir-path={dataDirPath}
      data-parent-path={dataParentPath ?? undefined}
      style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs',
        state,
        'focus-visible:ring-ring focus-visible:ring-1 focus-visible:outline-none',
        disabled === true && 'cursor-not-allowed opacity-50',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Shared tree keyboard navigation: Up/Down/Home/End move focus across the
 * rendered treeitems; Right expands (or steps into) a directory; Left
 * collapses, or moves focus to the parent directory row.
 */
export function treeNavigationKeyDown(
  event: KeyboardEvent<HTMLUListElement>,
  tree: HTMLUListElement | null,
  expanded: ReadonlySet<string>,
  toggleDir: (path: string) => void,
): void {
  const { key } = event;
  if (
    ![
      'ArrowDown',
      'ArrowUp',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
    ].includes(key)
  ) {
    return;
  }
  const items = tree?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]');
  if (!items || items.length === 0) return;
  event.preventDefault();

  const current = document.activeElement;
  let idx = -1;
  items.forEach((el, i) => {
    if (el === current) idx = i;
  });

  if (key === 'ArrowDown') {
    const next = idx === -1 ? 0 : Math.min(idx + 1, items.length - 1);
    items[next]?.focus();
    return;
  }
  if (key === 'ArrowUp') {
    const next = idx === -1 ? items.length - 1 : Math.max(idx - 1, 0);
    items[next]?.focus();
    return;
  }
  if (key === 'Home') {
    items[0]?.focus();
    return;
  }
  if (key === 'End') {
    items[items.length - 1]?.focus();
    return;
  }
  if (idx === -1) return;
  const el = items[idx];
  const dirPath = el.dataset.dirPath;
  const parentPath = el.dataset.parentPath;
  if (key === 'ArrowRight' && dirPath !== undefined) {
    if (!expanded.has(dirPath)) {
      toggleDir(dirPath);
    } else {
      items[Math.min(idx + 1, items.length - 1)]?.focus();
    }
    return;
  }
  if (key === 'ArrowLeft') {
    if (dirPath !== undefined && expanded.has(dirPath)) {
      toggleDir(dirPath);
      return;
    }
    if (parentPath) {
      const parent = tree?.querySelector<HTMLButtonElement>(
        `[data-dir-path="${CSS.escape(parentPath)}"]`,
      );
      parent?.focus();
    }
  }
}
