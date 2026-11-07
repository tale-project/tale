import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { ContentArea } from '@tale/ui/content-area';
import { Heading } from '@tale/ui/heading';
import { Text } from '@tale/ui/text';
import { useFocusHandoff } from '@tale/ui/use-focus-handoff';
import { AppWindow } from 'lucide-react';

import { useSessionActions } from '@/app/features/sessions/hooks/use-session-actions';
import { settle } from '@/app/features/sessions/lib/settle';
import { pendingIcon } from '@/app/lib/pending-icon';
import type { Session } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { busyButton } from '../lib/busy-button';
import { OutOfSyncBar } from './out-of-sync-bar';
import { SecretsPopover } from './secrets-popover';
import { SessionDetails } from './session-details';

/**
 * The body of the page of a running session. Its browser is a window of its
 * own on this computer's screen, where the person uses it: the page brings
 * that window to the front, types a value of a secret into the field the
 * person clicked there, and has the details of the session. Over it, the bar
 * that says when the exit IP no longer fits the session.
 */
export function WindowCard({
  session,
  onFocusLost,
}: {
  session: Session;
  /**
   * Where the keyboard goes when the card goes (the session stopped) while
   * one of its buttons had it: the page's heading.
   */
  onFocusLost?: () => void;
}) {
  const { t } = useT('viewer');
  const handoff = useFocusHandoff<HTMLDivElement>(onFocusLost);
  const { show, type } = useSessionActions();

  const showWindow = () => show.mutate({ id: session.id });
  // The value goes into the field the person clicked in the window, which then
  // comes to the front, for them to go on there. A value that could not be
  // typed is told by the write itself, and the page stays where it is.
  const typeValue = (text: string) => {
    const typeThenShow = async () => {
      const typed = await settle(type.mutateAsync({ id: session.id, text }));
      if (typed.ok) showWindow();
    };
    void typeThenShow();
  };

  return (
    <div ref={handoff} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <OutOfSyncBar session={session} />
      <ContentArea className="min-h-0 flex-1 items-center overflow-auto">
        {/* `my-auto`, not a centred parent: a card taller than the room starts at the top and scrolls. */}
        <Card className="my-auto flex w-full max-w-md flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Heading level={2} size="sm">
              {t('window.title')}
            </Heading>
            <Text variant="muted">{t('window.description')}</Text>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              {...pendingIcon(show.isPending, AppWindow)}
              {...busyButton(show.isPending, showWindow)}
            >
              {t('window.show')}
            </Button>
            <SecretsPopover
              sessionId={session.id}
              sessionName={session.name}
              onType={typeValue}
            />
          </div>
          <div className="border-border flex flex-col gap-4 border-t pt-4">
            <Heading level={2} size="sm">
              {t('details.title')}
            </Heading>
            <SessionDetails session={session} />
          </div>
        </Card>
      </ContentArea>
    </div>
  );
}
