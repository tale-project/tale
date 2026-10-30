import { useCallback, useEffect, useRef } from 'react';

import { backendErrorFromResponse } from '@/app/lib/backend/adapters';
import { isAbortError } from '@/lib/utils/abort-error';
import { fetchJson } from '@/lib/utils/type-utils';

import {
  useGenerateSkillUploadUrl,
  useRecordSkillUploadIntent,
  useUploadSkillBundle,
} from '../../../hooks/mutations';
import type { SkillSharingValue } from '../../skill-visibility-field';

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
 *
 * `audience` is whom the preview says the skill is for; the server writes it
 * into the stored `SKILL.md`. A retired `private` one can only be the file's
 * own, so it is left to the file.
 */
export function useSkillBundleUpload(organizationId: string) {
  const { mutateAsync: generateUploadUrl } = useGenerateSkillUploadUrl();
  const { mutateAsync: recordIntent } = useRecordSkillUploadIntent();
  const { mutateAsync: uploadBundle } = useUploadSkillBundle();

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
    async (
      zipFile: File,
      force: boolean,
      audience: SkillSharingValue,
    ): Promise<BundleUploadOutcome> => {
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
        // The door's own refusal, so the pane's toast can say why.
        throw await backendErrorFromResponse(resp);
      }
      const { storageId: rawStorageId } = await fetchJson<{
        storageId: string;
      }>(resp);
      const storageId = rawStorageId;

      // Bind the blob to (org, user) BEFORE invoking the action.
      await recordIntent({ organizationId, storageId });

      const result = await uploadBundle({
        organizationId,
        storageId,
        ...(force ? { force: true } : {}),
        ...(audience.visibility === 'team'
          ? { visibility: 'team' as const, teams: [...audience.teams] }
          : audience.visibility === 'org'
            ? { visibility: 'org' as const }
            : {}),
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
