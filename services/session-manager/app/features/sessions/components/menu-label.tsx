/**
 * What the menu item that holds a `MenuLabel` with a note takes, so that its
 * icon stays beside the title and not beside the middle of the two lines. The
 * library's action item has no line of its own for one.
 */
export const MENU_ITEM_WITH_NOTE = 'items-start [&>svg]:mt-0.5';

interface MenuLabelProps {
  title: string;
  /** What the action does, or why it cannot be done now. */
  note?: string;
}

/**
 * The label of a menu item with a line of explanation under it. The note is
 * part of the item's accessible name, so it reaches a screen reader too.
 */
export function MenuLabel({ title, note }: MenuLabelProps) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span>{title}</span>
      {note !== undefined && (
        <span className="text-muted-foreground text-xs leading-snug font-normal text-pretty">
          {note}
        </span>
      )}
    </span>
  );
}
