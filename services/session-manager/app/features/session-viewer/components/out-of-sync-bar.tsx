import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { Text } from '@tale/ui/text';
import { RotateCw } from 'lucide-react';
import { useState } from 'react';

import { outOfSync } from '@/app/features/sessions/lib/status';
import type { Session } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { RestartSessionDialog } from './restart-session-dialog';

/**
 * The bar is one line on a viewport too short to spare the lines
 * (`short-viewport:`: a phone held sideways, a window zoomed to 200 %): what
 * changed, with the sentence that says how after it where the line has room
 * for a useful part of it (cut with an ellipsis), and Restart session beside
 * it. What is left out of sight is read out, as the platform's banners do
 * (`embedding-setup-alert.tsx`): the hint always, the sentence where the line
 * is narrower than 30rem. Left to grow it was 182 px of a 390 px window.
 *
 * It is the same markup in both shapes (nothing is announced again when a
 * phone is turned), so the library's alert is bent to it by its classes: its
 * icon, text and button stand in a block, which here becomes a grid of the
 * text and the button with the icon centred on it, and the room the icon needs
 * is the alert's own left padding instead of the text's.
 */
const ONE_LINE_ALERT = cn(
  'short-viewport:grid short-viewport:grid-cols-[minmax(0,1fr)_auto] short-viewport:items-center short-viewport:gap-x-3',
  'short-viewport:py-1 short-viewport:pr-1 short-viewport:pl-10',
  'short-viewport:[&>svg]:top-1/2 short-viewport:[&>svg]:left-3 short-viewport:[&>svg]:-translate-y-1/2',
  'short-viewport:[&>svg~*]:pl-0 short-viewport:[&>svg+div]:translate-y-0',
);

/**
 * The bar over the card of a running session whose proxy now exits through
 * another IP than the one its time zone and location are for: it says so and offers
 * the restart that fits the session to the new IP again. The one prominent
 * warning of that state; the details of the session carry the same facts.
 *
 * The sentence that leads is the first line of the description, not an alert
 * `title`: the library renders that as a level-5 heading, which would come
 * right after the page's heading.
 */
export function OutOfSyncBar({ session }: { session: Session }) {
  const { t } = useT('viewer');
  const [confirming, setConfirming] = useState(false);
  const place = session.location;
  if (place === null || !outOfSync(session)) return null;
  const now = session.proxy?.exitIp ?? null;

  return (
    <div className="border-border short-viewport:px-3 short-viewport:py-1.5 shrink-0 border-b px-4 py-3">
      <Alert
        variant="warning"
        className={ONE_LINE_ALERT}
        description={
          // One block, so that the two sentences run on into one line, cut at
          // its end, where the bar is one line. The block is the container the
          // sentence asks how much room there is.
          <div className="short-viewport:truncate short-viewport:@container">
            <Text variant="label" className="short-viewport:inline">
              {t('place.warningTitle')}
            </Text>
            <Text
              variant="muted"
              className="short-viewport:ml-1.5 short-viewport:inline short-viewport:@max-[30rem]:sr-only"
            >
              {now === null
                ? t('place.warningUnknown', { reported: place.ip })
                : t('place.warning', { current: now, reported: place.ip })}
            </Text>
          </div>
        }
      >
        <div className="short-viewport:mt-0 mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Text variant="caption" className="short-viewport:sr-only min-w-0">
            {t('place.warningHint')}
          </Text>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            icon={RotateCw}
            onClick={() => setConfirming(true)}
          >
            {t('place.restart')}
          </Button>
        </div>
      </Alert>
      <RestartSessionDialog
        session={session}
        open={confirming}
        onOpenChange={setConfirming}
      />
    </div>
  );
}
