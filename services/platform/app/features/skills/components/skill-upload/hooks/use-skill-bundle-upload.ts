import { useCallback, useEffect, useRef } from 'react';

import { toId } from '@/convex/lib/type_cast_helpers';
import { fetchJson } from '@/lib/utils/type-utils';

import {
  useGenerateSkillUploadUrl,
  useRecordSkillUploadIntent,
  useUploadSkillBundle,
} from '../../../hooks/mutations';

export type BundleUploadOutcome =
  | { status: 'landed'; slug: string }
  | { status: 'needs_confirm'; slug: string }
  | { status: 'aborted' };

/**
 * The four-hop bundle upload as one testable callback: presign → POST the
 * zip to `_storage` → bind the blob to (org, user) → run the persist
 * action. The intent hop is load-bearing — the action refuses any
 * storageId without an intent row (`STORAGE_NOT_OWNED`).
 *
 * The in-flight POST aborts when the owner unmounts (dialog closed), so a
 * cancelled upload never strands a `_storage` write; `isMounted` guards the
 * state the caller derives from the outcome.
 */
export function useSkillBundleUpload(organizationId: string) {
  const { mutateAsync: generateUploadUrl } = useGenerateSkillUploadUrl();
  const { mutateAsync: recordIntent } = useRecordSkillUploadIntent();
  const { mutateAsync: uploadBundle } = useUploadSkillBundle(organizationId);

  const abortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const upload = useCallback(
    async (zipFile: File, force: boolean): Promise<BundleUploadOutcome> => {
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      const uploadUrl = await generateUploadUrl({ organizationId });
      let resp: Response;
      try {
        resp = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/zip' },
          body: zipFile,
          signal: controller.signal,
        });
      } catch (err) {
        if (isAbortError(err)) return { status: 'aborted' };
        throw err;
      }
      if (!resp.ok) {
        throw new Error(`Upload failed (HTTP ${resp.status})`);
      }
      const { storageId: rawStorageId } = await fetchJson<{
        storageId: string;
      }>(resp);
      const storageId = toId<'_storage'>(rawStorageId);

      // Bind the blob to (org, user) BEFORE invoking the action.
      await recordIntent({ organizationId, storageId });

      const result = await uploadBundle({
        organizationId,
        storageId,
        ...(force ? { force: true } : {}),
      });
      if (!result.ok) {
        return { status: 'needs_confirm', slug: result.slug };
      }
      return { status: 'landed', slug: result.slug };
    },
    [generateUploadUrl, recordIntent, uploadBundle, organizationId],
  );

  return { upload, abort, isMountedRef };
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}
