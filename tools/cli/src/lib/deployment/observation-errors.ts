import { z } from 'zod';

import { CliError } from '../../utils/fail';

const phases = {
  input: 'private input',
  host: 'host source and input custody',
  retained: 'retained deployment custody',
  containers: 'container inventory',
  application: 'application database observation',
  knowledge: 'knowledge database observation',
  database: 'database inventory verification',
  images: 'image inventory',
  filesystems: 'filesystem inventory',
  tooling: 'native tooling custody',
  native: 'native command verification',
  stability: 'host stability verification',
  nativeInput: 'native input and executable custody',
  nativeRetained: 'retained native inventory',
  nativeArtifacts: 'retained native artifact verification',
  nativeAuthentication: 'existing native authentication',
  nativeVerification: 'native configuration verification',
  nativeStability: 'native stability verification',
} as const;
type ObservationPhase = keyof typeof phases;
export type SetObservationPhase = (phase: ObservationPhase) => void;

/** A phase is authored source metadata, never an exception message or value. */
export class ObservationPhaseError extends CliError {
  constructor(readonly phase: ObservationPhase) {
    super({
      summary: `Deployment observation refused during ${phases[phase]}. No deployment was performed.`,
      code: 3,
    });
  }
}

export async function observationPhases<T>(
  initial: ObservationPhase,
  work: (setPhase: SetObservationPhase) => Promise<T>,
): Promise<T> {
  let phase = initial;
  try {
    return await work((next) => {
      phase = next;
    });
  } catch (error) {
    if (
      error instanceof ObservationCleanupError ||
      error instanceof ObservationPhaseError
    )
      throw error;
    throw new ObservationPhaseError(phase);
  }
}

const OBSERVATION_SESSION_CLEANUP_FAILURE =
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

/** Only exact authored native refusals may cross the nested CLI boundary. */
export function nativeObservationFailure(raw: unknown): CliError | undefined {
  const parsed = z
    .strictObject({
      ok: z.literal(false),
      command: z.literal('tale'),
      error: z.strictObject({
        summary: z.string().max(200),
        code: z.literal(3),
      }),
    })
    .safeParse(raw);
  if (!parsed.success) return undefined;
  if (parsed.data.error.summary === OBSERVATION_SESSION_CLEANUP_FAILURE)
    return new ObservationCleanupError('session');
  for (const phase of Object.keys(phases) as ObservationPhase[]) {
    const failure = new ObservationPhaseError(phase);
    if (failure.info.summary === parsed.data.error.summary) return failure;
  }
  return undefined;
}
