import { cn } from '@tale/ui/cn';
import { Heading } from '@tale/ui/heading';
import { Popover } from '@tale/ui/popover';
import { PropertyChip } from '@tale/ui/property-chip';
import { Globe, TriangleAlert } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { outOfSync } from '@/app/features/sessions/lib/status';
import {
  WARNING_CHIP_CLASS,
  WARNING_ICON_CLASS,
} from '@/app/features/sessions/lib/warning-tone';
import type { Session } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { exitOf } from '../lib/exit-of';
import { RestartSessionDialog } from './restart-session-dialog';
import { SessionDetails } from './session-details';

/**
 * Where the session appears to be: the IP its proxy exits through, with its
 * country, as the one chip of its network identity. It opens the details of
 * the session (its time zone, location and language, the IP they were taken
 * from, whether they still fit it, and what to do when they do not): the same
 * list the page of a stopped session shows, reachable here in every state and
 * at every width (a narrow header keeps the chip as a glyph and leaves the
 * words to assistive technology).
 *
 * When the proxy exits through another IP than the one the place is for, the
 * chip carries a warning triangle and the tint of a warning, and says so to a
 * screen reader: colour is never all there is to it.
 */
export function IdentityChip({ session }: { session: Session }) {
  const { t } = useT('viewer');
  const headingId = useId();
  const descriptionId = useId();
  const chip = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Asked from inside the details, answered outside them: the popover closes
  // before the dialog opens, and a question held by its content would go with it.
  const [restarting, setRestarting] = useState(false);
  const exit = exitOf(session);
  if (exit === null) return null;
  const warn = outOfSync(session);

  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="bottom"
        align="start"
        contentClassName="w-80 max-w-[calc(100vw-1rem)]"
        aria-labelledby={headingId}
        // The dialog takes the keyboard, not the first button inside it: that
        // one would open its tooltip at once, and the tooltip would take the
        // first Escape. The first Tab goes to the first button.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (event.target instanceof HTMLElement) {
            event.target.focus({ preventScroll: true });
          }
        }}
        trigger={
          <PropertyChip
            ref={chip}
            icon={
              warn ? (
                <TriangleAlert className={WARNING_ICON_CLASS} />
              ) : (
                <Globe />
              )
            }
            aria-describedby={warn ? descriptionId : undefined}
            // A chip in the line of context under the title, not a control of
            // a form: as tall as the line, and a glyph where the header is narrow.
            className={cn(
              'h-5 gap-0 px-2 @xl/thread-header:gap-1.5',
              warn && WARNING_CHIP_CLASS,
            )}
          >
            <span className="sr-only @xl/thread-header:not-sr-only">
              {exit.line}
            </span>
          </PropertyChip>
        }
      >
        <div className="flex flex-col gap-3">
          <Heading level={2} size="sm" id={headingId}>
            {t('details.title')}
          </Heading>
          <SessionDetails
            session={session}
            actions={{
              onRestart: () => {
                setOpen(false);
                setRestarting(true);
              },
            }}
          />
        </div>
      </Popover>
      {warn && (
        <span id={descriptionId} className="sr-only">
          {t('chip.outOfSync')}
        </span>
      )}
      <RestartSessionDialog
        session={session}
        open={restarting}
        onOpenChange={setRestarting}
        restoreFocusRef={chip}
      />
    </>
  );
}
