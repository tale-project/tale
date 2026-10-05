/** A cold image pull must not hold the control API or session adoption behind
 * a registry transfer. Only creation waits; existing compute keeps serving. */
export class ImageWarmup {
  private inFlight: Promise<void> | null = null;

  constructor(private readonly warm: () => Promise<void>) {}

  pending(): boolean {
    return this.inFlight !== null;
  }

  start(): Promise<void> {
    this.inFlight ??= Promise.resolve()
      .then(this.warm)
      .catch((error: unknown) => {
        // Warming is best effort. The backend's normal create reports an
        // unavailable image after this attempt, as it did before warmup.
        console.warn('[sandbox] runtime image warmup failed:', error);
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
