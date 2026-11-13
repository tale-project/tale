// streams: nothing the switch does closes a stream it did not have to (design
// 5.3, 15.5, R-01, R3-02, R3-21). Through main's edge, as a visitor's browser
// holds them: a server-sent event stream opened on the new colour while a
// flip retires the old one stays open across the rest of that flip and
// across an in-place roll of the other role; a roll of the streams' own role
// ends only the streams of the replica it stops, one replica at a time, and
// each client's reconnect lands on a replica that serves. A 1 Hz /api/health
// poller through the edge sees no failure throughout. (No reload ever runs:
// the switch's upstream files are written once.)

import { describe, expect, setDefaultTimeout, test } from 'bun:test';

import { record, until } from '../harness';
import {
  attributedLoad,
  edgeOf,
  journalOf,
  loadWorkspace,
  openStream,
  runningRelease,
  stalls,
  taleKilled,
  viaEdge,
  visitor,
  watched,
  WITHDRAWAL_WINDOW_MS,
  workspaceDeployed,
  type Stream,
} from '../workspace';

setDefaultTimeout(2 * 60 * 60_000);
const w = loadWorkspace();
const STREAMS = 8;

const openOnes = (streams: readonly Stream[]) =>
  streams.filter(
    (stream) => stream.openedAt !== null && stream.endedAt === null,
  );

describe('streams', () => {
  test('streams survive a flip they are not retired by and a roll of another role; a roll ends one replica at a time', async () => {
    await workspaceDeployed(w);
    const who = await visitor(w, 'streams');
    const edge = edgeOf(w);
    const release = runningRelease(w);
    // An in-place roll replaces what changed: the rolls below move each role
    // to the other release.
    const other = release === 0 ? 1 : 0;
    const epoch = performance.now();
    const poller = attributedLoad(
      [{ name: 'health-1hz', ...viaEdge(w, '/api/health', edge) }],
      { intervalMs: 1_000, epoch },
    );
    const open = (label: string) =>
      Array.from({ length: STREAMS }, (_, index) =>
        openStream(w, who, `${label} ${index}`, epoch, edge),
      );

    // 1. A flip: streams on the old colour end at its retirement; streams
    // opened on the new colour once the old one is withdrawn stay open.
    const old = open('old colour');
    let fresh: Stream[] = [];
    let opened = false;
    const flip = await taleKilled(
      w,
      ['deploy', '--yes', '--skip-backup'],
      () => {
        if (opened) return null;
        const phase = journalOf(w)?.flip?.phase;
        if (phase === 'retiring') {
          opened = true;
          // Past the withdrawal window the switch sends nothing new to the old
          // colour: these land on the new one.
          setTimeout(() => {
            fresh = open('new colour');
          }, WITHDRAWAL_WINDOW_MS);
        }
        return null;
      },
      { release },
    );
    expect(flip.code).toBe(0);
    await until(
      'the new colour streams to open',
      () =>
        fresh.length === STREAMS &&
        fresh.every((stream) => stream.openedAt !== null),
      { timeoutMs: 60_000, intervalMs: 200 },
    );
    await Bun.sleep(5_000);
    const oldEnded = old.filter((stream) => stream.endedAt !== null).length;
    const freshAfterFlip = openOnes(fresh).length;
    const reconnects = old
      .filter((stream) => stream.endedAt !== null)
      .map((stream) =>
        openStream(w, who, `${stream.label} reconnect`, epoch, edge),
      );
    await until(
      'the reconnects to open',
      () =>
        reconnects.every(
          (stream) => stream.openedAt !== null || stream.endedAt !== null,
        ),
      { timeoutMs: 30_000, intervalMs: 200 },
    );

    // 2. An in-place roll of the platform: the backend's streams are not its
    // to end.
    const platformRoll = await watched(
      w,
      ['deploy', '--services', 'platform', '--yes', '--skip-backup'],
      epoch,
      { release: other },
    );
    expect(platformRoll.run.code).toBe(0);
    await Bun.sleep(3_000);
    const freshAfterPlatformRoll = openOnes(fresh).length;

    // 3. An in-place roll of the backend: one replica at a time, so when the
    // first stream ends the others' replica still holds theirs.
    const rolled = [
      ...fresh,
      ...reconnects.filter((stream) => stream.openedAt !== null),
    ];
    const before = openOnes(rolled).length;
    const backendRoll = await watched(
      w,
      ['deploy', '--services', 'backend-api', '--yes', '--skip-backup'],
      epoch,
      { release: other },
    );
    expect(backendRoll.run.code).toBe(0);
    await Bun.sleep(3_000);
    const ends = rolled
      .map((stream) => stream.endedAt)
      .filter((at): at is number => at !== null)
      .sort((left, right) => left - right);
    const first = ends[0] ?? Number.POSITIVE_INFINITY;
    const openAfterFirstEnd = rolled.filter(
      (stream) =>
        stream.openedAt !== null &&
        (stream.endedAt === null || stream.endedAt > first + 3_000),
    ).length;
    const again = rolled
      .filter((stream) => stream.endedAt !== null)
      .map((stream) =>
        openStream(w, who, `${stream.label} after the roll`, epoch, edge),
      );
    await until(
      'the reconnects after the roll to open',
      () =>
        again.every(
          (stream) => stream.openedAt !== null || stream.endedAt !== null,
        ),
      { timeoutMs: 30_000, intervalMs: 200 },
    );

    const health = await poller.stop();
    for (const stream of [...old, ...fresh, ...reconnects, ...again])
      stream.close();
    const failed = health.filter((answer) => !answer.ok);
    record(w.lab, 'streams', {
      flip: { oldEnded, fresh: STREAMS, freshOpenAfterFlip: freshAfterFlip },
      platformRoll: { freshOpen: freshAfterPlatformRoll },
      backendRoll: {
        streams: before,
        ended: ends.length,
        openWhenTheFirstEnded: openAfterFirstEnd,
        endsMs: ends.map(Math.round),
      },
      reconnects: {
        afterFlip: reconnects.filter((stream) => stream.openedAt !== null)
          .length,
        afterRoll: again.filter((stream) => stream.openedAt !== null).length,
      },
      healthPolls: health.length,
      stalls: stalls(health),
      failedPolls: failed,
    });

    expect(oldEnded).toBe(STREAMS);
    expect(freshAfterFlip).toBe(STREAMS);
    expect(reconnects.every((stream) => stream.openedAt !== null)).toBe(true);
    expect(freshAfterPlatformRoll).toBe(STREAMS);
    expect(before).toBeGreaterThan(1);
    expect(openAfterFirstEnd).toBeGreaterThan(0);
    expect(again.every((stream) => stream.openedAt !== null)).toBe(true);
    expect(stalls(health)).toEqual([]);
    expect(failed).toEqual([]);
  });
});
