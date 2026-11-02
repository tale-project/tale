import { Facet, type Extension } from '@codemirror/state';
import { tooltips, type EditorView, type TooltipView } from '@codemirror/view';
import type { ReactNode } from 'react';

/**
 * Tooltip bodies the editor draws with React (a problem's detail and its
 * fix buttons, a type with its description) inside the DOM CodeMirror
 * positions. CodeMirror creates the element; the view component renders the
 * React node into it through a portal, so the node keeps the app's context
 * (language, theme).
 */
export interface TooltipPortals {
  set: (dom: HTMLElement, node: ReactNode) => void;
  remove: (dom: HTMLElement) => void;
  subscribe: (listener: () => void) => () => void;
  snapshot: () => ReadonlyMap<HTMLElement, ReactNode>;
}

export function createTooltipPortals(): TooltipPortals {
  let current = new Map<HTMLElement, ReactNode>();
  const listeners = new Set<() => void>();
  const publish = (next: Map<HTMLElement, ReactNode>) => {
    current = next;
    for (const listener of listeners) listener();
  };
  return {
    set: (dom, node) => {
      publish(new Map(current).set(dom, node));
    },
    remove: (dom) => {
      if (!current.has(dom)) return;
      const next = new Map(current);
      next.delete(dom);
      publish(next);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => current,
  };
}

export const tooltipPortals = Facet.define<
  TooltipPortals,
  TooltipPortals | null
>({
  combine: (values) => values[0] ?? null,
});

/** A tooltip whose body is a React node. */
export function reactTooltip(
  view: EditorView,
  node: ReactNode,
  className: string,
): TooltipView {
  const dom = document.createElement('div');
  dom.className = className;
  const portals = view.state.facet(tooltipPortals);
  portals?.set(dom, node);
  return {
    dom,
    destroy() {
      portals?.remove(dom);
    },
  };
}

/**
 * Tooltips are fixed-positioned, so an inspector that clips its overflow
 * cannot cut them off, and they never run below the dialog or sheet the
 * editor sits in: a completion list flips up rather than run under its
 * bottom edge. (They may rise above a short sheet: confined to it, a list
 * in a sheet of a few lines would have no room at all.)
 */
export const tooltipPlacement: Extension = tooltips({
  position: 'fixed',
  tooltipSpace: (view) => {
    const viewport = {
      top: 0,
      left: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    };
    const dialog = view.dom.closest('[role="dialog"]');
    if (dialog === null) return viewport;
    const box = dialog.getBoundingClientRect();
    return {
      top: viewport.top,
      left: Math.max(viewport.left, box.left),
      right: Math.min(viewport.right, box.right),
      bottom: Math.min(viewport.bottom, box.bottom),
    };
  },
});
