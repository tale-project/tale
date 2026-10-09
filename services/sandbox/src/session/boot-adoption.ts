/**
 * The spawner's boot adoption, as its routes see it. The listener opens
 * before the spawner re-adopts the sessions a previous process left running
 * and loads the device hub's placements, so a restart reads to the platform
 * as a short "not now" rather than a refused connection. Until both are
 * done, a call that reads or changes session state could miss a session
 * that exists and answer 404, which the platform takes for "gone"; while
 * adoption is pending the router answers those calls 503
 * `session_unavailable` instead, an answer the platform waits out.
 */
export class BootAdoption {
  private running = false;

  /** Adoption is about to run: hold the calls that depend on it. */
  begin(): void {
    this.running = true;
  }

  /** Adoption ran, whether or not it reached every session: the periodic
   * sweep re-adopts what a boot pass missed. */
  end(): void {
    this.running = false;
  }

  pending(): boolean {
    return this.running;
  }
}
