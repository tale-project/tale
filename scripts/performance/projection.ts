import assert from 'node:assert/strict';

import {
  HarnessProjection,
  HARNESS_TEXT_MAX_CHARS,
} from '../../services/platform/lib/harnesses/projection.ts';
import type { Workload } from './workloads.ts';

const TEXT_CHARS = 256 * 1024;
const SNAPSHOT_CHARS = 4096;
const BLOCK_CHARS = 4000;
// Include escaped JSON characters, multibyte text, surrogate pairs and lone
// surrogates. Single-code-unit fragments also split otherwise valid pairs.
const pattern = 'ab"\\\n\té界😀a\ud800b\udfff';
const payload = pattern
  .repeat(Math.ceil(TEXT_CHARS / pattern.length))
  .slice(0, TEXT_CHARS);

function expectedTail(end: number, maxChars: number): string {
  return end <= maxChars
    ? payload.slice(0, end)
    : `…${payload.slice(end - maxChars + 1, end)}`;
}

/** Projection only: no model, protocol parser, database or transport. */
export function prepareProjectionWorkload(id: string): Workload {
  const fragmentChars = id === 'platform.projection-fragmented' ? 1 : 4096;
  return {
    operations: TEXT_CHARS / fragmentChars,
    unit: 'deltas',
    description: `Project 256 Ki UTF-16 code units in ${fragmentChars}-unit deltas, verify display tails every 4096 units, preserve earlier snapshots and verify the complete terminal answer`,
    run() {
      const projection = new HarnessProjection();
      projection.accept({
        type: 'tool-use',
        toolUseId: 'projection-probe',
        toolName: 'read',
        input: { path: 'synthetic.txt' },
      });
      let firstSnapshot: ReturnType<HarnessProjection['timeline']> | undefined;
      let firstSnapshotJson = '';
      for (let offset = 0; offset < TEXT_CHARS; offset += fragmentChars) {
        const end = offset + fragmentChars;
        projection.accept({
          type: 'text-delta',
          text: payload.slice(offset, end),
        });
        if (end % SNAPSHOT_CHARS !== 0) continue;
        assert.equal(
          projection.text,
          expectedTail(end, HARNESS_TEXT_MAX_CHARS),
        );
        const timeline = projection.timeline();
        assert.equal(timeline.length, 2);
        assert.equal(timeline[1]?.text, expectedTail(end, BLOCK_CHARS));
        if (firstSnapshot === undefined) {
          firstSnapshot = timeline;
          firstSnapshotJson = JSON.stringify(timeline);
        }
      }
      projection.accept({
        type: 'tool-result',
        toolUseId: 'projection-probe',
        output: 'done',
      });
      assert.equal(projection.timeline()[0]?.state, 'output-available');
      assert.equal(projection.timeline()[0]?.output, 'done');
      assert.equal(JSON.stringify(firstSnapshot), firstSnapshotJson);
      assert.equal(projection.answer, payload);
      assert.equal(projection.revision, TEXT_CHARS / fragmentChars + 2);
    },
    details: () => ({
      textChars: TEXT_CHARS,
      fragmentChars,
      snapshotEveryChars: SNAPSHOT_CHARS,
      snapshotsPerSample: TEXT_CHARS / SNAPSHOT_CHARS,
      scope:
        'Display projection and complete answer accumulation; excludes complete agent-run latency',
    }),
  };
}
