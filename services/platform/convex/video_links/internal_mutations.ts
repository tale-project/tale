// Tight union so a backend caller emitting an unknown / snake_case code fails
// the Convex validator at write time, instead of silently propagating to the
// chip where it would fall through to the generic fallback. Keep in lockstep
// with YtDlpErrorReason (ytdlp.ts), UrlSafetyError.kind (url_safety.ts), and
// orchestrator-synthesized reasons in ingest_video_link.ts.
export type VideoLinkErrorReason =
  // YtDlpErrorReason
  | 'privateOrAgeGated'
  | 'unavailable'
  | 'geoblocked'
  | 'unsupported'
  | 'transient'
  | 'botDetection'
  | 'rateLimited'
  | 'forbidden'
  | 'liveStream'
  | 'premiere'
  | 'memberOnly'
  | 'jsRuntimeMissing'
  | 'binaryNotInstalled'
  | 'timeout'
  | 'outputValidationFailed'
  // UrlSafetyError.kind
  | 'invalidUrl'
  | 'unsupportedProtocol'
  | 'credentialedUrl'
  | 'ipLiteral'
  | 'playlist'
  | 'dnsResolutionFailed'
  | 'privateIpResolved'
  // Orchestrator-synthesized
  | 'videoTooLong'
  | 'whisperFailed';
export type UpdateJobResult = 'ok' | 'cas_miss' | 'not_found';
