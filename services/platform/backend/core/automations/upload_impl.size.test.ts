// @vitest-environment node

/**
 * A staged automation package over the size limit is refused without being
 * read. The door a package is staged through takes files of up to 512 MiB,
 * and the limit used to be compared after the whole staged file was in
 * memory, three times over (tale-project/tale#4942). The host is told the
 * limit and reads no further; what it reports is the package's size where
 * the store declared one.
 */

import { MAX_AUTOMATION_BUNDLE_TOTAL_BYTES } from '@tale/shared/schemas/automation-pack';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';
import { uploadAutomationImpl, type UploadHost } from './upload_impl';

type Staged = Awaited<ReturnType<UploadHost['readStagedZip']>>;

function hostFor(staged: Staged) {
  const cleaned: string[] = [];
  const readStagedZip = vi.fn<UploadHost['readStagedZip']>(() =>
    Promise.resolve(staged),
  );
  const host: UploadHost = {
    orgSlug: 'acme',
    userId: 'user_dev',
    isOrgAdmin: false,
    storeSave: () => Promise.reject(new Error('nothing is saved')),
    bindProject: () => Promise.reject(new Error('nothing is bound')),
    verifyStagedZip: () => Promise.resolve(true),
    readStagedZip,
    cleanupStagedZip: (storageId) => {
      cleaned.push(storageId);
      return Promise.resolve();
    },
    getViewerContext: () => Promise.resolve({ teamIds: [], isOrgAdmin: false }),
    mayPublishOrgWide: () => Promise.resolve(false),
    withSkillWriterLocks: () =>
      Promise.reject(new Error('no skill is written')),
  };
  return { host, cleaned, readStagedZip };
}

async function refusal(run: Promise<unknown>): Promise<{
  code: string;
  message: string;
}> {
  try {
    await run;
  } catch (error) {
    if (error instanceof AppError) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- AppError data is untyped by design
      return error.data as { code: string; message: string };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('a staged automation package and the size limit', () => {
  it('tells the host the most a package may hold', async () => {
    const { host, readStagedZip } = hostFor(null);

    await refusal(uploadAutomationImpl(host, { storageId: 's3:x' }));

    expect(readStagedZip).toHaveBeenCalledWith(
      's3:x',
      MAX_AUTOMATION_BUNDLE_TOTAL_BYTES,
    );
  });

  it('refuses a package the store measured over the limit, with its size, and removes it', async () => {
    const { host, cleaned } = hostFor({ tooLarge: 536_870_912 });

    expect(
      await refusal(uploadAutomationImpl(host, { storageId: 's3:x' })),
    ).toMatchObject({
      code: 'PACK_TOO_LARGE',
      message: `The package is 536870912 bytes compressed (max ${MAX_AUTOMATION_BUNDLE_TOTAL_BYTES}).`,
    });
    expect(cleaned).toEqual(['s3:x']);
  });

  it('refuses one over the limit whose size the store did not declare', async () => {
    const { host } = hostFor({ tooLarge: null });

    expect(
      await refusal(uploadAutomationImpl(host, { storageId: 's3:x' })),
    ).toMatchObject({
      code: 'PACK_TOO_LARGE',
      message: `The package is larger than ${MAX_AUTOMATION_BUNDLE_TOTAL_BYTES} bytes compressed.`,
    });
  });

  it('still refuses bytes over the limit that a host handed over', async () => {
    const { host } = hostFor(
      new Uint8Array(MAX_AUTOMATION_BUNDLE_TOTAL_BYTES + 1),
    );

    expect(
      await refusal(uploadAutomationImpl(host, { storageId: 's3:x' })),
    ).toMatchObject({
      code: 'PACK_TOO_LARGE',
      message: `The package is ${MAX_AUTOMATION_BUNDLE_TOTAL_BYTES + 1} bytes compressed (max ${MAX_AUTOMATION_BUNDLE_TOTAL_BYTES}).`,
    });
  });
});
