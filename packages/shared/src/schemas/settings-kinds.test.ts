import { describe, expect, test } from 'vitest';
import { z } from 'zod';

import {
  platformResourceSchema,
  type PlatformResource,
} from '../config/platform-resources';
import {
  isSettingsKind,
  isSettingsPointer,
  SETTINGS_AREAS,
  SETTINGS_EFFECTS,
  SETTINGS_KINDS,
  SETTINGS_KINDS_NOT_OVER_MCP,
  settingsKindDescriptor,
  type SettingsKindDescriptor,
} from './settings-kinds';

/** The descriptors as any reader sees them, not as their literal types. */
const DESCRIPTORS: readonly SettingsKindDescriptor[] = SETTINGS_KINDS;

/** Every kind the CLI's resource union takes, as a compile-time list: a kind
 * added to the union without a line here fails the type check. */
const DECLARABLE: Record<PlatformResource['kind'], true> = {
  'project-instructions': true,
  'agent-instructions': true,
  'agent-tools': true,
  'task-instructions': true,
  'automation-definition': true,
  'automation-deployment': true,
  'automation-schedule': true,
  governance: true,
  branding: true,
  deployment: true,
  'knowledge-embedding': true,
  provider: true,
  'provider-credential': true,
};

/** The same set read from the schema at run time: every `kind` constant of
 * the union, however deep its members nest. */
function parsedKinds(): string[] {
  const kinds: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    const kind: unknown = Reflect.get(
      Reflect.get(Reflect.get(node, 'properties') ?? {}, 'kind') ?? {},
      'const',
    );
    if (typeof kind === 'string') kinds.push(kind);
    for (const key of ['anyOf', 'oneOf']) {
      const members: unknown = Reflect.get(node, key);
      if (Array.isArray(members)) members.forEach(visit);
    }
  };
  visit(
    z.toJSONSchema(platformResourceSchema, {
      io: 'input',
      unrepresentable: 'any',
    }),
  );
  return kinds;
}

describe('the settings kinds', () => {
  test('the CLI declares exactly the kinds marked cli, taken over MCP or not', () => {
    const marked = [
      ...SETTINGS_KINDS.filter((descriptor) => descriptor.cli),
      ...SETTINGS_KINDS_NOT_OVER_MCP.filter((entry) => entry.cli),
    ]
      .map((entry) => entry.kind)
      .sort();
    expect(parsedKinds().sort()).toEqual(marked);
    expect(Object.keys(DECLARABLE).sort()).toEqual(marked);
  });

  test('a kind the MCP tools do not take says why, and is not also taken', () => {
    const taken = new Set<string>(SETTINGS_KINDS.map((entry) => entry.kind));
    for (const entry of SETTINGS_KINDS_NOT_OVER_MCP) {
      expect(taken.has(entry.kind), entry.kind).toBe(false);
      expect(entry.reason, entry.kind).toMatch(/^\S.*\.$/);
    }
  });

  test('each kind is described once, with an order of its own', () => {
    const kinds = SETTINGS_KINDS.map((entry) => entry.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    const orders = SETTINGS_KINDS.map((entry) => entry.order);
    expect(new Set(orders).size).toBe(orders.length);
    // The list reads in the order changes apply.
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  test('what a resource refers to applies before it', () => {
    const order = (kind: Parameters<typeof settingsKindDescriptor>[0]) =>
      settingsKindDescriptor(kind).order;
    // A credential names its provider; a model policy and the embedding
    // name a provider and are served through its credential.
    expect(order('provider')).toBeLessThan(order('provider-credential'));
    expect(order('provider-credential')).toBeLessThan(order('governance'));
    expect(order('provider-credential')).toBeLessThan(
      order('knowledge-embedding'),
    );
  });

  test('each kind names pages of Settings, real operations and pointers below its config', () => {
    const areas = new Set<string>(SETTINGS_AREAS);
    expect(areas.size).toBe(SETTINGS_AREAS.length);
    for (const descriptor of DESCRIPTORS) {
      for (const area of descriptor.areas) {
        expect(areas.has(area), `${descriptor.kind}: ${area}`).toBe(true);
      }
      expect(descriptor.ops.length, descriptor.kind).toBeGreaterThan(0);
      for (const act of descriptor.acts) {
        expect(act, descriptor.kind).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      }
      for (const pointer of descriptor.secretPaths) {
        expect(
          isSettingsPointer(pointer),
          `${descriptor.kind}: ${pointer}`,
        ).toBe(true);
      }
      expect(descriptor.description, descriptor.kind).toMatch(/^\S.*\.$/);
    }
  });

  test('a secret path is an RFC 6901 pointer below the config, * for any member', () => {
    // `/` names the member whose key is the empty string, as RFC 6901 reads it.
    for (const pointer of [
      '/secret',
      '/endpoint/headers/*',
      '/a~1b',
      '/a~0',
      '/0',
      '/',
    ])
      expect(isSettingsPointer(pointer), pointer).toBe(true);
    // The whole config, a bare name and a broken escape are not.
    for (const pointer of ['', 'secret', 'a/b', '/a~2', '/a~'])
      expect(isSettingsPointer(pointer), pointer).toBe(false);
  });

  test('every effect raises a change to high or critical', () => {
    for (const [effect, risk] of Object.entries(SETTINGS_EFFECTS)) {
      expect(['high', 'critical'], effect).toContain(risk);
      expect(effect).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    }
  });

  test('names a kind only when the MCP tools take it', () => {
    expect(isSettingsKind('governance')).toBe(true);
    expect(isSettingsKind('automation-definition')).toBe(false);
    expect(isSettingsKind('file')).toBe(false);
    expect(settingsKindDescriptor('branding').scope).toBe('organization');
  });
});
