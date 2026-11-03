import {
  CreditCard,
  KeyRound,
  StickyNote,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import type { SecretKind } from '@/lib/api/schemas';

/** The mark of each kind of secret, in the first column of the list and in the dialogs. */
export const KIND_ICONS: Record<SecretKind, LucideIcon> = {
  personal: UserRound,
  credentials: KeyRound,
  card: CreditCard,
  note: StickyNote,
};

/** The kind a new secret starts as when no kind is filtered: the most common one. */
export const DEFAULT_KIND: SecretKind = 'credentials';
