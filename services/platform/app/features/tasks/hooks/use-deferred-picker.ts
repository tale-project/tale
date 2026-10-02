import { useState } from 'react';

/** The state attributes Radix's popover trigger gives a closed picker. */
const CLOSED_TRIGGER_PROPS = {
  'aria-haspopup': 'dialog',
  'aria-expanded': false,
  'data-state': 'closed',
} as const;

/**
 * An inline picker that mounts its list on first use and keeps it mounted.
 *
 * A board renders a priority and an assignee picker on every card, and a
 * closed picker's options, candidate reads and select used to cost a
 * 2,000-card board seconds (#4062). Until its first use the picker's trigger
 * stands alone, carrying `triggerProps` — the attributes the popover trigger
 * would give it — so it reads the same to assistive technology; its click
 * calls `engage`, which mounts the list already open. Once mounted, the
 * popover trigger owns those attributes (Radix lets a child's props win over
 * its own), so `triggerProps` is empty from then on. Closing returns focus to
 * the trigger the list mounted with.
 */
export function useDeferredPicker() {
  const [engaged, setEngaged] = useState(false);
  const [open, setOpen] = useState(false);
  return {
    /** True once the list has mounted. */
    engaged,
    open,
    setOpen,
    triggerProps: engaged ? {} : CLOSED_TRIGGER_PROPS,
    engage: () => {
      if (engaged) return;
      setEngaged(true);
      setOpen(true);
    },
  };
}
