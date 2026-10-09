import { CliError } from '../../utils/fail';

export const OBSERVATION_SESSION_CLEANUP_FAILURE =
  'Observation authentication session cleanup could not be verified. No deployment was performed.';

/** Only these authored cleanup failures survive the private command boundary. */
export class ObservationCleanupError extends CliError {
  constructor(scope: 'session' | 'tooling') {
    super({
      summary:
        scope === 'session'
          ? OBSERVATION_SESSION_CLEANUP_FAILURE
          : 'Observation temporary tooling cleanup could not be verified. No deployment was performed.',
      code: 3,
    });
  }
}
