import { StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  EditorView,
  hoverTooltip,
  keymap,
  showTooltip,
  type Tooltip,
} from '@codemirror/view';
import type { ReactNode } from 'react';

import type { CodeLanguage } from '../../../../lib/code-roles';
import { hoverContext } from '../member-path';
import type { CodeEditorProviders, CodeHoverInfo } from '../providers';
import { escapeClosables } from './keyboard';
import { reactTooltip } from './tooltips';

/**
 * The type of what is under the pointer, from the host's hover provider:
 * after 200 ms on a name, or on Mod-K Mod-I at the cursor, which also reads
 * the type aloud. Escape closes it.
 */

export interface HoverConfig {
  language: CodeLanguage;
  providers: () => CodeEditorProviders | undefined;
  render: (info: CodeHoverInfo) => ReactNode;
  announce: (info: CodeHoverInfo) => string;
}

const TOOLTIP_CLASS =
  'cm-tale-tooltip motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-[var(--duration-short)]';

async function infoAt(
  view: EditorView,
  config: HoverConfig,
  pos: number,
  side: -1 | 1,
  signal: AbortSignal,
): Promise<{ info: CodeHoverInfo; from: number; to: number } | null> {
  const provider = config.providers()?.hover;
  if (provider === undefined) return null;
  const context = hoverContext(view.state, pos, side);
  if (context === null) return null;
  const info = await provider({
    text: view.state.doc.toString(),
    pos,
    language: config.language,
    region: context.region,
    path: context.path,
    word: context.word,
    from: context.from,
    to: context.to,
    signal,
  });
  return info === null ? null : { info, from: context.from, to: context.to };
}

function tooltip(
  config: HoverConfig,
  info: CodeHoverInfo,
  from: number,
  to: number,
): Tooltip {
  return {
    pos: from,
    end: to,
    above: true,
    create: (view) => reactTooltip(view, config.render(info), TOOLTIP_CLASS),
  };
}

const showType = StateEffect.define<Tooltip | null>();

const typeTooltip = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    let next = tr.docChanged || tr.selection ? null : value;
    for (const effect of tr.effects) {
      if (effect.is(showType)) next = effect.value;
    }
    return next;
  },
  provide: (field) => showTooltip.from(field),
});

export function hoverExtension(config: HoverConfig): Extension {
  return [
    hoverTooltip(
      async (view, pos, side) => {
        const controller = new AbortController();
        const found = await infoAt(view, config, pos, side, controller.signal);
        return found === null
          ? null
          : tooltip(config, found.info, found.from, found.to);
      },
      { hoverTime: 200 },
    ),
    typeTooltip,
    escapeClosables.of({
      isOpen: (view) => view.state.field(typeTooltip) !== null,
      close: (view) => {
        view.dispatch({ effects: showType.of(null) });
        return true;
      },
    }),
    keymap.of([
      {
        key: 'Mod-k Mod-i',
        run: (view) => {
          const head = view.state.selection.main.head;
          const controller = new AbortController();
          void infoAt(view, config, head, -1, controller.signal).then(
            (found) => {
              if (found === null || view.state.selection.main.head !== head) {
                return;
              }
              view.dispatch({
                effects: [
                  showType.of(
                    tooltip(config, found.info, found.from, found.to),
                  ),
                  EditorView.announce.of(config.announce(found.info)),
                ],
              });
            },
            (error: unknown) => {
              console.warn('[code-editor] the hover provider failed', error);
            },
          );
          return true;
        },
      },
    ]),
  ];
}
