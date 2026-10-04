import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ExecReplay,
  ReplayBudget,
} from '../../services/sandbox-runtime/daemon/src/exec-replay.ts';
import type { Workload } from './workloads.ts';

const RECORDS = 16_000;
const RECONNECTS = 20;
const SUFFIX = 10;
const APPEND_WINDOW_BYTES = 128 * 1024;
const payload = Buffer.alloc(384, 'x').toString('base64');

/** Real segmented replay files, without a child process or transport fixture. */
export async function prepareJournalWorkload(
  id: string,
  fixtureRoot: string,
): Promise<Workload> {
  const directory = await mkdtemp(join(fixtureRoot, 'tale-journal-'));
  const budget = new ReplayBudget();
  let retained: ExecReplay | undefined;
  let journalBytes = 0;
  const populate = async () => {
    const replay = new ExecReplay(undefined, budget, directory);
    retained = replay;
    journalBytes = 0;
    let pending: Promise<void>[] = [];
    let pendingBytes = 0;
    for (let seq = 1; seq <= RECORDS; seq++) {
      const line = `${JSON.stringify({ t: 'stdout', b64: payload, seq })}\n`;
      const bytes = Buffer.byteLength(line);
      // Concurrent append promises exercise vector batching, while this
      // caller's admitted bytes remain bounded independently of total output.
      if (pendingBytes + bytes > APPEND_WINDOW_BYTES) {
        await Promise.all(pending);
        pending = [];
        pendingBytes = 0;
      }
      journalBytes += bytes;
      pendingBytes += bytes;
      pending.push(replay.append(line, seq));
    }
    await Promise.all(pending);
    await replay.finish();
    return replay;
  };
  const replaySuffix = async (replay: ExecReplay) => {
    let expectedSeq = RECORDS - SUFFIX + 1;
    const cursor = await replay.replay(
      RECORDS - SUFFIX,
      RECORDS,
      (line) => {
        const event: unknown = JSON.parse(line);
        assert.deepEqual(event, {
          t: 'stdout',
          b64: payload,
          seq: expectedSeq++,
        });
        return Promise.resolve();
      },
      (from, to) => assert.fail(`Unexpected replay gap ${from}-${to}`),
    );
    assert.equal(cursor, RECORDS);
    assert.equal(expectedSeq, RECORDS + 1);
  };
  const reconnect = id === 'daemon.journal-reconnect';
  if (reconnect) await populate();
  return {
    operations: reconnect ? RECONNECTS : RECORDS,
    unit: reconnect ? 'reconnects' : 'records',
    description: reconnect
      ? '20 sequential suffix replays at the last ten of 16,000 records; setup excluded, exact sequences and payloads verified'
      : 'Write and drain 16,000 replay records with 512-character base64 payloads in 128 KiB admission windows; verify the final ten records and close the spool',
    async run() {
      if (reconnect) {
        assert.ok(retained);
        for (let i = 0; i < RECONNECTS; i++) await replaySuffix(retained);
      } else {
        const replay = await populate();
        try {
          await replaySuffix(replay);
        } finally {
          await replay.dispose();
          retained = undefined;
        }
      }
    },
    details: () => ({
      journalRecords: RECORDS,
      journalBytes,
      payloadBytes: 384,
      appendWindowBytes: APPEND_WINDOW_BYTES,
      suffixRecords: SUFFIX,
      reconnectsPerSample: reconnect ? RECONNECTS : 1,
      scope:
        'Host filesystem and Node replay spool only; no container or network',
    }),
    async cleanup() {
      await retained?.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
