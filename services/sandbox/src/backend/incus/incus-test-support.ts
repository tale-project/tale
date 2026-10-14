// Helpers the Incus tests share. Not used by production code.

/** The error a promise rejects with; fails the test when it resolves or
 * rejects with something that is not an Error. */
export async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`rejected with a non-Error: ${String(error)}`, {
      cause: error,
    });
  }
  throw new Error('expected the promise to reject');
}
