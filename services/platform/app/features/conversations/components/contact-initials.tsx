import { Avatar } from '@tale/ui/avatar';

/** A contact's initials in the tint their name hashes to — the same person
 * reads in the same colour in the Home list, the conversation header and a
 * task's discussion. Decorative: the name travels as text beside it. */
export function ContactInitials({
  label,
  size = 'sm',
}: {
  label: string;
  /** 20px (`sm`) or 32px (`lg`). */
  size?: 'sm' | 'lg';
}) {
  return <Avatar name={label} size={size === 'lg' ? 'lg' : 'xs'} />;
}
