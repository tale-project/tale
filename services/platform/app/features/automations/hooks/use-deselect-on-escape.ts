'use client';

import { useEffect } from 'react';

/** Marks a canvas node button so focus can return there after the inspector closes. */
export const AUTOMATION_NODE_ATTR = 'data-automation-node';

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return target.closest('[contenteditable="true"]') !== null;
}

export function focusAutomationNode(nodeId: string): void {
  document
    .querySelector<HTMLElement>(
      `[${AUTOMATION_NODE_ATTR}="${CSS.escape(nodeId)}"]`,
    )
    ?.focus();
}

/**
 * Escape collapses the node inspector — the keyboard half of click-again —
 * except while typing, or while a dialog owns the key.
 */
export function useDeselectOnEscape(
  enabled: boolean,
  onDeselect: (() => void) | undefined,
): void {
  useEffect(() => {
    if (!enabled || onDeselect === undefined) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (event.defaultPrevented) return;
      if (isTypingTarget(event.target)) return;
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"]')
      ) {
        return;
      }
      event.preventDefault();
      onDeselect();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, onDeselect]);
}
