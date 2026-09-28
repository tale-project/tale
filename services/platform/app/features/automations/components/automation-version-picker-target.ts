import { createContext } from 'react';

// The editor owns version-switch confirmation, but its selector belongs only
// in the shell tab strip. Never fall back into the canvas while attaching it.
export const AutomationVersionPickerTarget = createContext<HTMLElement | null>(
  null,
);
