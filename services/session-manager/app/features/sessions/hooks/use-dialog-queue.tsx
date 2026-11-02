import { Fragment, useCallback, useRef, useState, type ReactNode } from 'react';

interface Entry {
  id: number;
  dialog: ReactNode;
}

/**
 * Dialogs that answer. `show` queues one and resolves with what the person
 * decided; only the first of the queue is on screen, and the next comes once it
 * was answered. `current` is what to render.
 *
 * `build` makes the dialog from the function that answers for it. Each dialog
 * is a new element of its own (it has a key), so the next one never inherits
 * what the one before it held.
 */
export function useDialogQueue() {
  const [queue, setQueue] = useState<readonly Entry[]>([]);
  const lastId = useRef(0);

  const show = useCallback(
    <Answer,>(
      build: (answer: (value: Answer) => void) => ReactNode,
    ): Promise<Answer> =>
      new Promise<Answer>((resolve) => {
        lastId.current += 1;
        const id = lastId.current;
        const answer = (value: Answer) => {
          setQueue((current) => current.filter((entry) => entry.id !== id));
          resolve(value);
        };
        setQueue((current) => [...current, { id, dialog: build(answer) }]);
      }),
    [],
  );

  const first = queue[0];
  return {
    show,
    current:
      first === undefined ? null : (
        <Fragment key={first.id}>{first.dialog}</Fragment>
      ),
  };
}
