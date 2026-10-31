/** Safe capability codes from the shared server transcription resolver. */
export function isTranscriptionUnavailableReason(
  reason: unknown,
): reason is string {
  return (
    typeof reason === 'string' &&
    [
      'NO_TRANSCRIPTION_MODEL',
      'TRANSCRIPTION_MODEL_UNAVAILABLE',
      'TRANSCRIPTION_MODEL_POLICY_INVALID',
      'TRANSCRIPTION_MODEL_POLICY_UNAVAILABLE',
      'TRANSCRIPTION_MODEL_RESOLUTION_FAILED',
      // The organization's EU/EEA processing rule refused the model.
      'MODEL_ENDPOINT_OUTSIDE_EU',
      'MODEL_ENDPOINT_POLICY_UNREADABLE',
    ].includes(reason)
  );
}

export function transcriptionUnavailableKey(reason?: string) {
  switch (reason) {
    case undefined:
    case 'NO_TRANSCRIPTION_MODEL':
      return 'transcription.noModel' as const;
    case 'TRANSCRIPTION_MODEL_UNAVAILABLE':
      return 'transcription.pinnedUnavailable' as const;
    case 'TRANSCRIPTION_MODEL_POLICY_INVALID':
      return 'transcription.policyInvalid' as const;
    case 'MODEL_ENDPOINT_OUTSIDE_EU':
      return 'transcription.outsideEu' as const;
    case 'MODEL_ENDPOINT_POLICY_UNREADABLE':
      return 'transcription.endpointPolicyUnreadable' as const;
    default:
      return 'transcription.temporarilyUnavailable' as const;
  }
}

export function transcriptionNeedsRetry(reason?: string): boolean {
  return (
    transcriptionUnavailableKey(reason) ===
    'transcription.temporarilyUnavailable'
  );
}
