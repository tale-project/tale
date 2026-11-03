import { LoaderCircle, type LucideIcon } from 'lucide-react';

/** A spinner that stands still for a person who asks for less motion. */
export const SPIN_CLASS = 'animate-spin motion-reduce:animate-none';

/**
 * The icon of an icon button while its work is under way: a spinner takes the
 * icon's place, and the button stays where it is (it keeps the keyboard, which
 * `isLoading` would take by disabling it).
 */
export function pendingIcon(pending: boolean, icon: LucideIcon) {
  return {
    icon: pending ? LoaderCircle : icon,
    iconClassName: pending ? SPIN_CLASS : undefined,
  };
}
