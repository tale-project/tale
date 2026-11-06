'use client';

import {
  Ban,
  Braces,
  Brackets,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  CircleX,
  CodeXml,
  Hash,
  Info,
  KeyRound,
  LogIn,
  Pi,
  SquareFunction,
  ToggleLeft,
  TriangleAlert,
  Type,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

/**
 * The Lucide icons the editor draws inside DOM that CodeMirror owns (gutter
 * marks, completion rows), where React cannot render: one hidden sprite of
 * `<symbol>`s in the document, referenced with `<use href="#…">`. Every
 * editor on the page shares the first mounted sprite; the next takes over
 * when it unmounts.
 */
const ICONS = {
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'circle-x': CircleX,
  'triangle-alert': TriangleAlert,
  info: Info,
  workflow: Workflow,
  'log-in': LogIn,
  'square-function': SquareFunction,
  'key-round': KeyRound,
  pi: Pi,
  'code-xml': CodeXml,
  type: Type,
  hash: Hash,
  'toggle-left': ToggleLeft,
  braces: Braces,
  brackets: Brackets,
  ban: Ban,
  'circle-dashed': CircleDashed,
} satisfies Record<string, LucideIcon>;

export type EditorIconName = keyof typeof ICONS;

const ID_PREFIX = 'tale-code-editor-icon-';

/**
 * An icon element for CodeMirror DOM: `size-3.5` by default, decorative,
 * coloured by `currentColor`, in an inline-flex box.
 */
export function editorIcon(
  name: EditorIconName,
  className = 'size-3.5',
): HTMLSpanElement {
  const ns = 'http://www.w3.org/2000/svg';
  const box = document.createElement('span');
  box.className = 'inline-flex shrink-0 items-center justify-center';
  box.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `#${ID_PREFIX}${name}`);
  svg.appendChild(use);
  box.appendChild(svg);
  return box;
}

const claims: symbol[] = [];
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function owner(): symbol | null {
  return claims[0] ?? null;
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Renders the sprite once per document, from whichever editor came first. */
export function EditorIconSprite() {
  const [me] = useState(() => Symbol('code-editor-sprite'));
  const current = useSyncExternalStore(subscribe, owner, () => null);
  useEffect(() => {
    claims.push(me);
    notify();
    return () => {
      const index = claims.indexOf(me);
      if (index !== -1) claims.splice(index, 1);
      notify();
    };
  }, [me]);
  if (current !== me) return null;
  return createPortal(
    <svg
      aria-hidden="true"
      focusable="false"
      data-code-editor-sprite=""
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
    >
      {Object.entries(ICONS).map(([name, Icon]) => (
        <symbol key={name} id={`${ID_PREFIX}${name}`} viewBox="0 0 24 24">
          <Icon width={24} height={24} />
        </symbol>
      ))}
    </svg>,
    document.body,
  );
}
