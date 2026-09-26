/**
 * A run asked for a skill its scope cannot reach — the bundle does not exist
 * or is not shared with the run's project/team. Configuration, not a fault:
 * nothing about a retry changes it, so the task host settles the run under
 * its own failure code and the auto-retry stays off (the same posture as an
 * agent whose model is gone). Lives in its own module so the run host can
 * recognize it without importing the agent host it mocks under test.
 */
export class SkillUnavailableError extends Error {
  readonly slug: string;

  constructor(slug: string) {
    super(
      `the skill "${slug}" is not available to this run — it does not exist or is not shared with the run's scope`,
    );
    this.name = 'SkillUnavailableError';
    this.slug = slug;
  }
}

export function isSkillUnavailableError(
  error: unknown,
): error is SkillUnavailableError {
  return error instanceof SkillUnavailableError;
}
