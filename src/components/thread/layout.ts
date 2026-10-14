/**
 * The geometry every conversation shares — a chat, a task's discussion, a
 * customer conversation — so the three read as one design and their loading
 * placeholders sit exactly where the real rows land.
 *
 * Layout answers to the column, not the window: the `@lg:` / `@md:`
 * variants query the nearest `@container`, which the host puts on the
 * scroller that holds the column. Without one, the narrow values apply.
 */

/**
 * The centred reading column. A chat adds its own `py-6`; a task keeps its
 * own vertical rhythm.
 */
export const THREAD_COLUMN_CLASS =
  'mx-auto flex w-full max-w-3xl flex-col px-4 @lg:px-6';

/**
 * The entries of a thread: a message gap of 24px. A continuation (same
 * author, minutes later) closes up to 8px on its own.
 */
export const THREAD_LIST_CLASS = 'flex flex-col gap-6';

/** Width and alignment of the viewer's own message. */
export const THREAD_OWN_BUBBLE_WIDTH_CLASS =
  'ml-auto max-w-[85%] @md:max-w-[75%]';

/** The surface of the viewer's own message. */
export const THREAD_OWN_BUBBLE_SURFACE_CLASS =
  'bg-muted text-foreground rounded-2xl px-4 py-2.5 text-sm leading-6 break-words';

/** The viewer's own message: a right-aligned muted bubble. */
export const THREAD_OWN_BUBBLE_CLASS = `${THREAD_OWN_BUBBLE_WIDTH_CLASS} ${THREAD_OWN_BUBBLE_SURFACE_CLASS}`;

/** The composer pinned at the foot of every conversation. */
export const THREAD_COMPOSER_FRAME_CLASS =
  'border-border sm:border-muted-foreground/50 bg-background relative w-full rounded-xl border px-3 pt-3 shadow-[0_-6px_16px_-8px_rgb(0_0_0/0.15)] sm:rounded-2xl sm:px-5 sm:pt-4 dark:shadow-[0_-6px_16px_-8px_rgb(0_0_0/0.5)]';

/** The composer's field: two lines on a short viewport (a phone held
 * sideways, a laptop at 200 %), where 100px of empty field left the thread
 * above it no room at all. */
export const THREAD_COMPOSER_FIELD_CLASS =
  'min-h-[72px] sm:min-h-[100px] short-viewport:min-h-12';
