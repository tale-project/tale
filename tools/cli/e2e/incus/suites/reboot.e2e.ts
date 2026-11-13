// reboot: the node goes down and comes back as a host shutdown takes it
// (design D-23, R3-05, 15.5): `incus admin shutdown` stops every instance one
// `boot.stop.priority` group at a time — the edge and the colours, then the
// middle tier, then data and resolvers — and the daemon's next start brings
// back what ran before (each instance's last state), highest
// `boot.autostart.priority` first. The workspace then serves through its edge
// again, every replica admitted, with no `tale` command in between.
//
// It stops the whole node, every project's instances included, so it runs
// only where the lab is the run's own: TALE_E2E_HOST_RESTART=1 (the CI
// workflow sets it on its fresh runner).

import { describe, expect, setDefaultTimeout, test } from 'bun:test';

import { incus, record, until } from '../harness';
import {
  liveRows,
  loadWorkspace,
  serving,
  statusOf,
  workspaceDeployed,
  workspaceInstances,
} from '../workspace';

setDefaultTimeout(60 * 60_000);
const w = loadWorkspace();
const allowed = process.env.TALE_E2E_HOST_RESTART === '1';

interface Event {
  instance: string;
  action: string;
  at: number;
}

/** Lifecycle events of the workspace's project while the daemon answers. */
function monitor(): { events: Event[]; stop(): void } {
  const [command, ...prefix] = w.lab.incus;
  const child = Bun.spawn(
    [
      command ?? 'incus',
      ...prefix,
      'monitor',
      '--project',
      w.name,
      '--type',
      'lifecycle',
      '--format',
      'json',
    ],
    { stdout: 'pipe', stderr: 'ignore' },
  );
  const events: Event[] = [];
  void (async () => {
    let buffer = '';
    for await (const chunk of child.stdout) {
      buffer += new TextDecoder().decode(chunk);
      let split = buffer.indexOf('\n');
      while (split >= 0) {
        const line = buffer.slice(0, split).trim();
        buffer = buffer.slice(split + 1);
        split = buffer.indexOf('\n');
        if (line === '') continue;
        try {
          const event = JSON.parse(line) as {
            timestamp: string;
            metadata?: { action?: string; source?: string };
          };
          const source = event.metadata?.source ?? '';
          const instance = /\/instances\/([^/?]+)/.exec(source)?.[1];
          if (instance !== undefined)
            events.push({
              instance,
              action: event.metadata?.action ?? '',
              at: Date.parse(event.timestamp),
            });
        } catch (error) {
          console.warn('reboot: a monitor line was no event:', error);
        }
      }
    }
  })();
  return { events, stop: () => child.kill() };
}

/** Whether `times` (instance -> ms) follow `priority` (instance -> number):
 * every instance of a higher group before any of a lower one. */
function inGroupOrder(
  times: Record<string, number>,
  priority: Record<string, number>,
  slackMs: number,
): string[] {
  const broken: string[] = [];
  const names = Object.keys(times);
  for (const high of names)
    for (const low of names) {
      const highPriority = priority[high] ?? 0;
      const lowPriority = priority[low] ?? 0;
      if (
        highPriority > lowPriority &&
        (times[high] ?? 0) > (times[low] ?? 0) + slackMs
      )
        broken.push(`${high} (${highPriority}) after ${low} (${lowPriority})`);
    }
  return broken;
}

describe('reboot', () => {
  test.skipIf(!allowed)(
    'a host shutdown stops the tiers in order, and the restart brings back the last state, highest priority first',
    async () => {
      await workspaceDeployed(w);
      const before = workspaceInstances(w);
      const running = before
        .filter((instance) => instance.status === 'Running')
        .map((i) => i.name)
        .sort();
      const stopped = before
        .filter((instance) => instance.status !== 'Running')
        .map((i) => i.name)
        .sort();
      const stopPriority = Object.fromEntries(
        before.map((instance) => [
          instance.name,
          Number(instance.config['boot.stop.priority'] ?? 0),
        ]),
      );
      const startPriority = Object.fromEntries(
        before.map((instance) => [
          instance.name,
          Number(instance.config['boot.autostart.priority'] ?? 0),
        ]),
      );

      const watch = monitor();
      await Bun.sleep(1_000);
      const shutdownStarted = Date.now();
      incus(w.lab, ['admin', 'shutdown', '--timeout', '600']);
      watch.stop();
      const shutdownMs = Date.now() - shutdownStarted;
      const stops = Object.fromEntries(
        watch.events
          .filter((event) => /instance-(shutdown|stopped)/.test(event.action))
          .map((event) => [event.instance, event.at]),
      );

      // The daemon starts again on the next call (its socket is activated).
      const restarted = Date.now();
      await until(
        'the Incus daemon to answer again',
        () =>
          incus(w.lab, ['list', '--project', w.name, '--format', 'csv'], {
            allowFailure: true,
          }).code === 0,
        { timeoutMs: 10 * 60_000, intervalMs: 3_000 },
      );
      await until(
        'the instances that ran to run again',
        () =>
          workspaceInstances(w)
            .filter((instance) => instance.status === 'Running')
            .map((instance) => instance.name)
            .sort()
            .join(',') === running.join(','),
        { timeoutMs: 15 * 60_000, intervalMs: 3_000 },
      );
      const after = JSON.parse(
        incus(w.lab, ['list', '--project', w.name, '--format', 'json']).stdout,
      ) as { name: string; status: string; last_used_at: string }[];
      const starts = Object.fromEntries(
        after
          .filter((instance) => running.includes(instance.name))
          .map((instance) => [
            instance.name,
            Date.parse(instance.last_used_at),
          ]),
      );
      await serving(w, 15 * 60_000);
      const status = statusOf(w);
      const switched = [
        ...liveRows(status, 'platform'),
        ...liveRows(status, 'backend-api'),
      ];

      const stopOrder = inGroupOrder(stops, stopPriority, 1_000);
      const startOrder = inGroupOrder(starts, startPriority, 1_000);
      record(w.lab, 'reboot', {
        shutdownMs,
        restartMs: Date.now() - restarted,
        running,
        stopped,
        stopsSeen: Object.keys(stops).length,
        stopOrder,
        startOrder,
        stillStopped: after
          .filter((instance) => stopped.includes(instance.name))
          .map((i) => `${i.name} ${i.status}`),
        admitted: switched.map((row) => `${row.service}: ${row.admission}`),
      });

      expect(stopOrder).toEqual([]);
      expect(startOrder).toEqual([]);
      expect(
        after
          .filter((instance) => stopped.includes(instance.name))
          .every((instance) => instance.status !== 'Running'),
      ).toBe(true);
      expect(switched.length).toBeGreaterThan(0);
      expect(switched.every((row) => row.admission === 'admitted')).toBe(true);
    },
  );
});
