import { cn } from '@tale/ui/cn';
import { Link, useNavigate } from '@tanstack/react-router';
import { TriangleAlert } from 'lucide-react';
import { memo } from 'react';

import type { Session } from '@/lib/api/schemas';

import { rowMarker } from '../hooks/use-row-focus-rescue';
import { useSecondLine, type SecondLineTone } from '../hooks/use-second-line';
import { shownStatus } from '../lib/status';
import { WARNING_TEXT_CLASS } from '../lib/warning-tone';
import { SessionActionsMenu } from './session-actions-menu';
import { SessionStartStop } from './session-start-stop';
import { SessionStatus, useStatusLabel } from './session-status';

// The row anatomy of the Home rows (`ROW_LINK_CLASS` in the platform's
// `home-rows.tsx`), with room kept on the right for the two buttons where they
// are always there (a phone, a touch screen).
const LINK_CLASS =
  'focus-visible:ring-ring relative z-10 flex w-full min-w-0 items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset max-md:pr-20 pointer-coarse:pr-20';

/**
 * The row's two buttons. Beside the page, where a pointer can hover, they wait
 * for the row to be hovered or focused, or their menu to be open, and let
 * clicks through until then: a stray tap must not stop a session. On a touch
 * screen they are always there, with room kept for them in the row
 * (`LINK_CLASS`). They sit on a quiet backing, as the Home rows' actions do
 * (`home-rows.tsx`), so they never print over the end of the name or of the
 * line under it.
 */
const ACTIONS_CLASS = cn(
  'bg-background/85 absolute top-1/2 right-1.5 z-20 flex -translate-y-1/2 items-center gap-0.5 rounded-md backdrop-blur-sm',
  'motion-reduce:transition-none md:pointer-fine:pointer-events-none md:pointer-fine:opacity-0 md:pointer-fine:transition-opacity md:pointer-fine:duration-150',
  'md:group-hover:pointer-events-auto md:group-hover:opacity-100',
  'md:group-has-[:focus-visible]:pointer-events-auto md:group-has-[:focus-visible]:opacity-100',
  'md:has-[[data-state=open]]:pointer-events-auto md:has-[[data-state=open]]:opacity-100',
);

/** Warnings and failures need more than the muted text colour: on the open row too. */
function lineTone(tone: SecondLineTone, active: boolean): string {
  if (tone === 'warning') return WARNING_TEXT_CLASS;
  if (tone === 'error') return 'text-destructive';
  return active ? 'text-foreground' : 'text-muted-foreground';
}

interface SessionRowProps {
  session: Session;
  /** The session whose page is open: its link is the current page. */
  active: boolean;
  /** The row just joined the list: it drops into place. */
  entering?: boolean;
}

/**
 * One session in the list: a real link to its page with the state as a dot, its
 * name and a second line (where it exits, what it failed with, or its state),
 * and at the end the buttons that start or stop it and open its menu.
 */
export const SessionRow = memo(function SessionRow({
  session,
  active,
  entering = false,
}: SessionRowProps) {
  const navigate = useNavigate();
  const shown = shownStatus(session);
  const state = useStatusLabel()(shown);
  const line = useSecondLine(session);

  return (
    <li
      {...rowMarker(session.id)}
      className={cn(
        'group relative rounded-lg',
        entering && 'animate-row-enter motion-reduce:animate-none',
      )}
    >
      <Link
        to="/sessions/$sessionId"
        params={{ sessionId: String(session.id) }}
        aria-current={active ? 'page' : undefined}
        data-indicator-key={String(session.id)}
        className={cn(
          LINK_CLASS,
          active ? 'text-foreground font-medium' : 'hover:bg-muted/60',
        )}
      >
        <span className="flex h-5 shrink-0 items-center">
          <SessionStatus status={shown} dotOnly />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          {/* A long name truncates in the narrow panel; hovering shows it whole. */}
          <span
            className="text-foreground truncate text-[13px] leading-5"
            title={session.name}
          >
            {session.name}
          </span>
          {/* The dot is only a colour; the link's name says the state once,
              after the session's name: the line below does when that is all it
              says, else this word (heard, not seen) does. */}
          {line.text !== state && <span className="sr-only">{state}</span>}
          {/* One line, cut with an ellipsis however long the cause is: the
              whole of it is the title, and the session's page says it too. */}
          <span
            title={line.text}
            className={cn(
              'flex min-w-0 items-center gap-1 text-xs leading-4 font-normal',
              lineTone(line.tone, active),
            )}
          >
            {line.tone === 'warning' && (
              <TriangleAlert aria-hidden className="size-3 shrink-0" />
            )}
            <span className="min-w-0 truncate">{line.text}</span>
          </span>
        </span>
      </Link>
      <div className={ACTIONS_CLASS}>
        <SessionStartStop session={session} />
        <SessionActionsMenu
          session={session}
          onDeleted={() => {
            // The page of a deleted session is gone with it.
            if (active) void navigate({ to: '/sessions' });
          }}
        />
      </div>
    </li>
  );
});
