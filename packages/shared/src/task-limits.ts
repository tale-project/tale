/** Shared native task description cap, measured in UTF-16 code units. */
export const TASK_DESCRIPTION_MAX = 20_000;
/** Shared native task title cap, measured in UTF-16 code units. */
export const TASK_TITLE_MAX = 200;
/** How many labels one task carries at most. */
export const TASK_LABELS_MAX = 50;
/** How long one label name is at most, as the catalog stores it. */
export const TASK_LABEL_CHARS_MAX = 50;
/** The priorities a task can carry, highest first. */
export const TASK_PRIORITIES = ['p0', 'p1', 'p2', 'p3'] as const;
