import { Card } from '@tale/ui/card';
import { cn } from '@tale/ui/cn';
import { Text } from '@tale/ui/text';
import { useToast } from '@tale/ui/use-toast';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

import { useT } from '@/lib/i18n/client';
import { MAX_TEXT } from '@/lib/live-view';

import { useAddressShortcut } from '../hooks/use-address-shortcut';
import { useElementSize } from '../hooks/use-element-size';
import type { LiveView } from '../hooks/use-live-view';
import { usePictureCanvas } from '../hooks/use-picture-canvas';
import { useRemoteKeyboard } from '../hooks/use-remote-keyboard';
import { useRemotePointer } from '../hooks/use-remote-pointer';
import { fitView } from '../lib/fit-view';
import { SelectList } from './select-list';

/** How long the hint about the way out stays on the screen (milliseconds). */
export const KEYBOARD_HINT_MS = 6000;

interface LiveScreenProps {
  live: LiveView;
  /** The hidden text field that has the keyboard while the page has it. */
  sinkRef: RefObject<HTMLTextAreaElement | null>;
  /** Gives the page the keyboard. */
  focusPage: () => void;
  /** ⌘L / Ctrl+L: the way out of the page. */
  focusAddress: () => void;
  /** Said over the picture while it cannot be used. */
  notice?: ReactNode;
}

/**
 * The browser of the session as a picture, and the mouse and keyboard that go
 * back to it. The picture is drawn on a canvas, scaled down to fit the room and
 * never enlarged: the window of the browser stays the size its fingerprint says,
 * so a page cannot tell. The keyboard goes through a hidden text field: it is
 * what makes composed text (dead keys, input methods) work.
 *
 * The picture is the one stop of the page on the tab key; it hands the keyboard
 * on to the text field. A page that has the keyboard gets every key, so ⌘L /
 * Ctrl+L is the way out, to the address bar: it is said to a screen reader on
 * the picture and on the field, and shown on the screen to somebody who came
 * in with the tab key.
 */
export function LiveScreen({
  live,
  sinkRef,
  focusPage,
  focusAddress,
  notice,
}: LiveScreenProps) {
  const { t } = useT('viewer');
  const { toast } = useToast();
  const shortcut = useAddressShortcut();
  const hintId = useId();
  const { ref: screenRef, size: room } = useElementSize<HTMLDivElement>();
  const pictureRef = useRef<HTMLDivElement>(null);
  const { canvasRef, drawn } = usePictureCanvas(live.onFrame);
  const placement = live.view === null ? null : fitView(live.view, room);
  const usable = live.state === 'live';
  // The way out is on the screen from the moment the keyboard came in with a key.
  const [hinting, setHinting] = useState(false);

  useEffect(() => {
    if (!hinting) return undefined;
    const timer = setTimeout(() => setHinting(false), KEYBOARD_HINT_MS);
    return () => clearTimeout(timer);
  }, [hinting]);

  useRemotePointer({
    targetRef: pictureRef,
    view: live.view,
    send: live.send,
    focusPage,
    usable,
  });
  const keyboard = useRemoteKeyboard({
    send: live.send,
    heldKeys: live.heldKeys,
    onAddress: focusAddress,
    onPasteCut: () =>
      toast({
        variant: 'warning',
        title: t('notice.pasteCutTitle'),
        description: t('notice.pasteCut', { max: MAX_TEXT }),
      }),
  });

  return (
    <div className="group/screen bg-muted relative min-h-0 flex-1 overflow-hidden">
      {/* The picture is laid out in a frame a margin inside the screen. The
          ring that says the page has the keyboard lies in that margin, so it
          is whole on all four sides, whatever the shape of the picture, and
          never covers a pixel of the page. */}
      <div ref={screenRef} className="absolute inset-1">
        {/* The picture is an application of its own: it takes every key. That
            is what the role says, the lint rules do not know it is a widget. */}
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a widget that takes the keyboard */}
        <div
          ref={pictureRef}
          role="application"
          aria-label={t('stage.canvas')}
          aria-describedby={hintId}
          aria-disabled={!usable || undefined}
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the one stop of the tab key in the picture
          tabIndex={0}
          hidden={placement === null || !drawn}
          onFocus={(event) => {
            // Asked before the keyboard moves on: the ring is the browser's own word for "came in with a key".
            const byKey = event.currentTarget.matches(':focus-visible');
            focusPage();
            if (byKey) setHinting(true);
          }}
          style={
            placement === null
              ? undefined
              : {
                  left: placement.left,
                  top: placement.top,
                  width: placement.width,
                  height: placement.height,
                }
          }
          className={cn(
            'ring-border absolute cursor-default ring-1 outline-none select-none',
            !usable && 'pointer-events-none',
          )}
        >
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="block size-full touch-none"
          />
        </div>
        <span id={hintId} className="sr-only">
          {t('stage.canvasHint', { shortcut: shortcut.name })}
        </span>
        <textarea
          ref={sinkRef}
          tabIndex={-1}
          aria-label={t('stage.keyboard')}
          aria-describedby={hintId}
          aria-keyshortcuts={shortcut.keys}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          {...keyboard}
          onKeyDown={(event) => {
            setHinting(false);
            keyboard.onKeyDown(event);
          }}
          onBlur={() => {
            setHinting(false);
            keyboard.onBlur();
          }}
          className="pointer-events-none absolute top-0 left-0 size-px resize-none overflow-hidden border-0 p-0 text-base opacity-0"
        />
        {live.selectMenu !== null &&
          live.view !== null &&
          placement !== null && (
            <SelectList
              key={live.selectMenu.token}
              menu={live.selectMenu}
              view={live.view}
              placement={placement}
              screen={room}
              onPick={live.pickOption}
              returnFocus={focusPage}
            />
          )}
      </div>
      {/* The keyboard is in the page while the picture, its hidden text field
          or the list of a select has it: the ring says so. It is an outline,
          so that it survives forced colours. */}
      <div
        aria-hidden="true"
        className="group-focus-within/screen:outline-ring pointer-events-none absolute inset-0 group-focus-within/screen:outline-2 group-focus-within/screen:-outline-offset-2 group-focus-within/screen:outline-solid"
      />
      {notice}
      {/* At the foot of the screen: said once to a screen reader as well, and gone with the first key. */}
      <div
        role="status"
        className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-3"
      >
        {hinting && (
          <Card padding="sm" shadow="md" className="max-w-md">
            <Text variant="body-sm">
              {t('stage.keyboardHint', { shortcut: shortcut.name })}
            </Text>
          </Card>
        )}
      </div>
    </div>
  );
}
