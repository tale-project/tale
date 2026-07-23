/**
 * In-memory workflow store — the StoreAdapter for tests and the selftest.
 * Versions are immutable and monotonically numbered per name; `deploy` marks
 * the one version triggers would run. Async interface over sync internals so
 * consumers exercise the exact contract a database-backed store serves.
 */

import { cloneData } from '../core/execute/scope';
import type { StoreAdapter } from '../core/slots';
import type { Workflow } from '../core/types';

export interface MemoryStore extends StoreAdapter {
  save(name: string, workflow: Workflow): { version: number };
  deploy(name: string, version: number): void;
}

export function memoryStore(): MemoryStore {
  const versions = new Map<string, Workflow[]>();
  const deployed = new Map<string, number>();

  return {
    save(name, workflow) {
      const list = versions.get(name) ?? [];
      list.push(cloneData(workflow));
      versions.set(name, list);
      return { version: list.length };
    },
    deploy(name, version) {
      const list = versions.get(name);
      if (!list || version < 1 || version > list.length) {
        throw new Error(`cannot deploy unknown version ${name}@${version}`);
      }
      deployed.set(name, version);
    },
    async list() {
      return [...versions.entries()].map(([name, list]) => ({
        name,
        latest: list.length,
      }));
    },
    async get(name, version) {
      const list = versions.get(name);
      if (!list || list.length === 0) return null;
      const v = version ?? list.length;
      const workflow = list[v - 1];
      if (!workflow) return null;
      return { meta: { version: v }, workflow: cloneData(workflow) };
    },
    async deployedVersion(name) {
      return deployed.get(name) ?? null;
    },
  };
}
