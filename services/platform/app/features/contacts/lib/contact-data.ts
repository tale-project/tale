import type { Doc } from '@/convex/_generated/dataModel';
import type { ContactInfo } from '@/convex/conversations/types';

/**
 * A contact as rendered in the app: either a full directory row
 * (`Doc<'contacts'>`) or the lightweight `ContactInfo` embedded in a
 * conversation. The two share name/email/source/locale; the richer
 * phone/address/tags/notes fields live only on the directory row.
 */
export type ContactData = Doc<'contacts'> | ContactInfo;

export function isContactDoc(contact: ContactData): contact is Doc<'contacts'> {
  return '_creationTime' in contact;
}
