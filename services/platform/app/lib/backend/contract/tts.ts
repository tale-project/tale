/**
 * `tts` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../tts.ts` are what
 * actually serve them.
 */

export interface TtsContract {
  'tts/queries:getMessageChunks': {
    kind: 'query';
    args: { threadId: string; messageId: string };
    returns: Array<{
      chunkId: string;
      index: number;
      status: 'failed' | 'pending' | 'ready';
      voice?: string;
      format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
      error?:
        | 'NO_PROVIDER'
        | 'UNKNOWN_MODEL'
        | 'UNKNOWN_PROVIDER'
        | 'UNKNOWN_VOICE'
        | 'HOST_POLICY'
        | 'RATE_LIMITED'
        | 'CONTENTION'
        | 'BUDGET_EXCEEDED'
        | 'MESSAGE_CHAR_LIMIT'
        | 'TIMEOUT'
        | 'PROVIDER_AUTH'
        | 'PROVIDER_BAD_REQUEST'
        | 'PROVIDER_PAYLOAD_TOO_LARGE'
        | 'PROVIDER_4XX'
        | 'PROVIDER_5XX'
        | 'PROVIDER_INVALID_RESPONSE'
        | 'PROVIDER_ERROR'
        | 'WATCHDOG_TIMEOUT';
      text: string;
      createdAt: number;
    }>;
  };
  'tts/queries:getMessageVoiceUsage': {
    kind: 'query';
    args: { threadId: string; messageId: string };
    returns: null | {
      totalCharacters: number;
      totalCostCents: number;
      chunkCount: number;
      breakdown: Array<{
        provider: string;
        model: string;
        voice?: string;
        characters: number;
        costCents: number;
        chunkCount: number;
      }>;
    };
  };
  'tts/queries:getVoiceModeEffective': {
    kind: 'query';
    args: { threadId?: string; organizationId: string };
    returns:
      | { enabled: boolean; userDefault: boolean; source: 'org_policy' }
      | { enabled: boolean; userDefault: boolean; source: 'thread' }
      | {
          enabled: boolean;
          userDefault: boolean;
          source: 'preferences' | 'default';
        };
  };
  'tts/synthesize:synthesizeChunk': {
    kind: 'action';
    args: {
      index: number;
      text: string;
      organizationId: string;
      threadId: string;
      messageId: string;
      locale: string;
    };
    returns:
      | { status: 'in-flight'; errorCode?: undefined; retryAfterMs?: undefined }
      | {
          status: 'failed';
          errorCode:
            | 'NO_PROVIDER'
            | 'UNKNOWN_MODEL'
            | 'UNKNOWN_PROVIDER'
            | 'UNKNOWN_VOICE'
            | 'HOST_POLICY'
            | 'RATE_LIMITED'
            | 'CONTENTION'
            | 'BUDGET_EXCEEDED'
            | 'MESSAGE_CHAR_LIMIT'
            | 'TIMEOUT'
            | 'PROVIDER_AUTH'
            | 'PROVIDER_BAD_REQUEST'
            | 'PROVIDER_PAYLOAD_TOO_LARGE'
            | 'PROVIDER_4XX'
            | 'PROVIDER_5XX'
            | 'PROVIDER_INVALID_RESPONSE'
            | 'PROVIDER_ERROR'
            | 'WATCHDOG_TIMEOUT';
          retryAfterMs: undefined | number;
        }
      | { status: 'failed'; errorCode: string }
      | { status: 'ready'; errorCode?: undefined };
  };
}
