import * as ToastPrimitives from '@radix-ui/react-toast';
import { Button } from '@tale/ui/button';
import { toast } from '@tale/ui/use-toast';

/** Long enough to read the name and reach Open before it fades. */
const TASK_CREATED_TOAST_MS = 10_000;

/**
 * The one notice a created task gets: what was created, and an **Open**
 * action that takes the reader to it. The board's create dialog, its
 * "Create another" loop and the chat hand-over all announce with it, so a
 * new task is always one click away whichever way it was made.
 */
export function toastTaskCreated({
  title,
  openLabel,
  openAltText,
  onOpen,
}: {
  title: string;
  openLabel: string;
  /** What a screen reader announces for the action (Radix requires it). */
  openAltText: string;
  onOpen: () => void;
}) {
  toast({
    title,
    variant: 'success',
    duration: TASK_CREATED_TOAST_MS,
    action: (
      <ToastPrimitives.Action altText={openAltText} asChild onClick={onOpen}>
        <Button type="button" variant="secondary" size="sm">
          {openLabel}
        </Button>
      </ToastPrimitives.Action>
    ),
  });
}
