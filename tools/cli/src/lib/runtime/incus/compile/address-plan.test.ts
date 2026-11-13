import { describe, expect, test } from 'bun:test';

import { addressPlan, SINGLETON_OFFSETS } from './address-plan';
import { RefusalError } from './refusals';

const network = (block: string) => ({
  subnet: '10.30.0.0/16',
  gateway: '10.30.0.1',
  block,
});
const ONE = { platform: 1, 'backend-api': 1, 'backend-worker': 1 };

function refusalOf(run: () => unknown): string | null {
  try {
    run();
  } catch (error) {
    if (error instanceof RefusalError) return error.refusal.id;
    throw error;
  }
  return null;
}

describe('the address plan (design 5.2)', () => {
  test('the singletons sit at their fixed offsets', () => {
    const plan = addressPlan(network('10.30.7.0/24'), 'workspace', ONE);
    expect(plan.singleton('names')).toBe('10.30.7.2');
    expect(plan.singleton('names-sessions')).toBe('10.30.7.3');
    expect(plan.singleton('proxy')).toBe('10.30.7.4');
    expect(plan.singleton('switch')).toBe('10.30.7.5');
    expect(plan.singleton('db')).toBe('10.30.7.6');
    expect(plan.singleton('bgutil-provider')).toBe('10.30.7.12');
    expect(new Set(Object.values(SINGLETON_OFFSETS)).size).toBe(
      Object.keys(SINGLETON_OFFSETS).length,
    );
    expect(plan.helpers()).toHaveLength(16);
    expect(plan.helpers()[0]).toBe('10.30.7.16');
    expect(plan.helpers().at(-1)).toBe('10.30.7.31');
  });

  test('blue and green hold 16 slots per role in their own ranges', () => {
    const plan = addressPlan(network('10.30.7.0/24'), 'workspace', ONE);
    expect(plan.slot('platform', 'blue', 1)).toBe('10.30.7.64');
    expect(plan.slot('platform', 'blue', 16)).toBe('10.30.7.79');
    expect(plan.slot('backend-api', 'blue', 1)).toBe('10.30.7.80');
    expect(plan.slot('backend-worker', 'blue', 16)).toBe('10.30.7.111');
    expect(plan.slot('platform', 'green', 1)).toBe('10.30.7.128');
    expect(plan.slot('backend-worker', 'green', 16)).toBe('10.30.7.175');
    expect(plan.slots('platform')).toHaveLength(32);
    expect(plan.colours).toEqual(['blue', 'green']);
  });

  test('a managed /25 holds blue alone, and every address stays inside it', () => {
    const plan = addressPlan(network('10.30.9.128/25'), 'managed', ONE);
    expect(plan.colours).toEqual(['blue']);
    expect(plan.singleton('proxy')).toBe('10.30.9.132');
    expect(plan.slots('backend-worker').at(-1)).toBe('10.30.9.239');
    expect(plan.slots('platform')).toHaveLength(16);
    expect(() => plan.slot('platform', 'green', 1)).toThrow();
  });

  test('the instance address takes the subnet prefix, not the block one', () => {
    expect(
      addressPlan(network('10.30.7.0/24'), 'workspace', ONE).subnetPrefix,
    ).toBe(16);
  });

  test('a block of the wrong size for the path is refused', () => {
    expect(
      refusalOf(() => addressPlan(network('10.30.7.0/25'), 'workspace', ONE)),
    ).toBe('address-block');
    expect(
      refusalOf(() => addressPlan(network('10.30.7.0/24'), 'managed', ONE)),
    ).toBe('address-block');
  });

  test('replica counts above the slots are refused before anything is made (R-14)', () => {
    expect(
      refusalOf(() =>
        addressPlan(network('10.30.7.0/24'), 'workspace', {
          ...ONE,
          'backend-api': 17,
        }),
      ),
    ).toBe('replicas');
    expect(
      refusalOf(() =>
        addressPlan(network('10.30.7.0/24'), 'workspace', {
          ...ONE,
          platform: 0,
        }),
      ),
    ).toBe('replicas');
    expect(
      refusalOf(() =>
        addressPlan(network('10.30.7.0/24'), 'workspace', {
          ...ONE,
          'backend-worker': 16,
        }),
      ),
    ).toBeNull();
  });
});
