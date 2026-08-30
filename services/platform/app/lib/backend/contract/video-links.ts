/**
 * `video_links` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../video_links.ts` are what
 * actually serve them.
 */

export interface VideoLinksContract {
  'video_links/queries:listForThread': {
    kind: 'query';
    args: { organizationId: string; threadId: string };
    returns: Array<{
      jobId: string;
      sourceUrl: string;
      sourcePlatform: string;
      pastedToken: string;
      videoTitle?: string;
      videoUploader?: string;
      videoDurationSec?: number;
      transcriptSource?: string;
      captionLang?: string;
      displayStatus: string;
      progress?: string;
      errorReasonCode?: string;
      errorMessage?: string;
      attempts?: number;
      storageId?: string;
      fileSize?: number;
      lifecycleStatus?: string;
      messageBoundAt?: number;
      uploadedBy: string;
      createdAt: number;
    }>;
  };
  'video_links/queries:listForUserUnboundChat': {
    kind: 'query';
    args: { organizationId: string };
    returns: Array<{
      jobId: string;
      sourceUrl: string;
      sourcePlatform: string;
      pastedToken: string;
      videoTitle?: string;
      videoUploader?: string;
      videoDurationSec?: number;
      transcriptSource?: string;
      captionLang?: string;
      displayStatus: string;
      progress?: string;
      errorReasonCode?: string;
      errorMessage?: string;
      attempts?: number;
      storageId?: string;
      fileSize?: number;
      lifecycleStatus?: string;
      messageBoundAt?: number;
      uploadedBy: string;
      createdAt: number;
    }>;
  };
}
