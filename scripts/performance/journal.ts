import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ExecJournal,
  JournalBudget,
} from '../../services/sandbox-runtime/daemon/src/exec-journal.ts';
import type { Workload } from './workloads.ts';

const RECORDS = 16_000;
const RECONNECTS = 20;
const SUFFIX = 10;
const payload = Buffer.alloc(384, 'x').toString('base64');

/** Real unlinked journal files, without a child process or transport fixture. */
export async function prepareJournalWorkload(
  id: string,
  fixtureRoot: string,
): Promise<Workload> {
  const directory = await mkdtemp(join(fixtureRoot, 'tale-journal-'));
  const budget = new JournalBudget();
  let retained: ExecJournal | undefined;
  let journalBytes = 0;
  const populate = async () => {
    let failure: string | undefined;
    const journal = new ExecJournal(
      budget,
      () => {},
      (reason) => {
        failure = reason;
      },
      undefined,
      directory,
    );
    retained = journal;
    journalBytes = 0;
    for (let seq = 1; seq <= RECORDS; seq++) {
      const line = `${JSON.stringify({ t: 'stdout', b64: payload, seq })}\n`;
      journalBytes += Buffer.byteLength(line);
      if (!journal.append(line)) await journal.drain();
      assert.equal(failure, undefined);
    }
    await journal.drain();
    assert.equal(failure, undefined);
    journal.finish();
    return journal;
  };
  const replaySuffix = async (journal: ExecJournal) => {
    let expectedSeq = RECORDS - SUFFIX + 1;
    const markers: string[] = [];
    await journal.replay((event) => {
      if (event.t === 'replay-start' || event.t === 'replay-complete') {
        markers.push(event.t);
        if (event.t === 'replay-complete') {
          assert.equal(event.throughSeq, RECORDS);
          assert.equal(expectedSeq, RECORDS + 1);
        }
        return;
      }
      assert.equal(event.t, 'stdout');
      if (event.t !== 'stdout') throw new Error('Unexpected journal event');
      assert.equal(event.seq, expectedSeq++);
      assert.equal(event.b64, payload);
    }, RECORDS - SUFFIX);
    assert.equal(expectedSeq, RECORDS + 1);
    assert.deepEqual(markers, ['replay-start', 'replay-complete']);
  };
  const reconnect = id === 'daemon.journal-reconnect';
  if (reconnect) await populate();
  return {
    operations: reconnect ? RECONNECTS : RECORDS,
    unit: reconnect ? 'reconnects' : 'records',
    description: reconnect
      ? '20 sequential reconnects at the last ten of 16,000 journal records; setup excluded, exact suffix and replay markers verified'
      : 'Write and drain 16,000 journal records with 512-character base64 payloads, respecting backpressure; verify the final ten records and close the file',
    async run() {
      if (reconnect) {
        assert.ok(retained);
        for (let i = 0; i < RECONNECTS; i++) await replaySuffix(retained);
      } else {
        const journal = await populate();
        try {
          await replaySuffix(journal);
        } finally {
          await journal.dispose();
          retained = undefined;
        }
      }
    },
    details: () => ({
      journalRecords: RECORDS,
      journalBytes,
      payloadBytes: 384,
      suffixRecords: SUFFIX,
      reconnectsPerSample: reconnect ? RECONNECTS : 1,
      scope: 'Host filesystem and Node journal only; no container or network',
    }),
    async cleanup() {
      await retained?.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
