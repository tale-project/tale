/**
 * An attachment the task lists is no longer in the object store: the store
 * answered 404 when the sandbox daemon fetched its bytes while staging the
 * run's inputs. The bytes left outside the task — a deleted file row, a
 * purge, a cleanup outside Tale — so a retry meets the same absence, and a
 * run that quietly worked without the person's input would deliver the
 * wrong thing. The task host settles the run under its own failure code,
 * named after the files, and the auto-retry stays off; whoever can change
 * the task removes the attachment or uploads it again. Lives in its own
 * module so the start classifier can recognize it without importing the run
 * host.
 */
export class TaskInputMissingError extends Error {
  /** The attachments as the task shows them to the person. */
  readonly fileNames: readonly string[];

  constructor(fileNames: readonly string[]) {
    super(describeMissingTaskInputs(fileNames));
    this.name = 'TaskInputMissingError';
    this.fileNames = [...fileNames];
  }
}

/** The run reason: the files by name, and the one move that helps. */
export function describeMissingTaskInputs(
  fileNames: readonly string[],
): string {
  const quoted = fileNames.map((name) => `"${name}"`);
  if (quoted.length <= 1) {
    return `the attachment ${quoted[0] ?? '""'} is no longer in storage — remove it from the task or upload it again`;
  }
  const listed = `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1) ?? ''}`;
  return `the attachments ${listed} are no longer in storage — remove them from the task or upload them again`;
}

export function isTaskInputMissingError(
  error: unknown,
): error is TaskInputMissingError {
  return error instanceof TaskInputMissingError;
}
