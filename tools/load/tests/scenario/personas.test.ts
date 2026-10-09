import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_PERSONA_WEIGHTS,
  PERSONA_NAMES,
} from '../../src/scenario/contract.ts';
import { PERSONAS } from '../../src/scenario/personas.ts';

describe('personas', () => {
  test('every persona of the contract has a journey mix', () => {
    for (const name of PERSONA_NAMES) {
      const persona = PERSONAS[name];
      expect(persona.name).toBe(name);
      expect(persona.journeys.length).toBeGreaterThan(0);
      expect(persona.idleFactor).toBeGreaterThan(0);
      for (const [journey, weight] of persona.journeys) {
        expect(weight).toBeGreaterThan(0);
        expect(journey.name).toMatch(/^[a-z]+\.[a-z-]+$/);
      }
    }
    expect(Object.keys(DEFAULT_PERSONA_WEIGHTS).sort()).toEqual(
      [...PERSONA_NAMES].sort(),
    );
  });

  test('journey names are unique within a persona', () => {
    for (const name of PERSONA_NAMES) {
      const names = PERSONAS[name].journeys.map(([journey]) => journey.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  test('each persona leans on what it is named for', () => {
    const share = (persona: (typeof PERSONA_NAMES)[number], prefix: string) => {
      const journeys = PERSONAS[persona].journeys;
      const total = journeys.reduce((sum, [, weight]) => sum + weight, 0);
      const matching = journeys
        .filter(([journey]) => journey.name.startsWith(prefix))
        .reduce((sum, [, weight]) => sum + weight, 0);
      return matching / total;
    };
    expect(share('chatter', 'chat.')).toBeGreaterThan(0.6);
    expect(share('task-worker', 'tasks.')).toBeGreaterThan(0.5);
    expect(share('knowledge', 'knowledge.')).toBeGreaterThan(0.5);
    expect(share('admin', 'admin.')).toBeGreaterThan(0.4);
    expect(share('api-client', 'rest.')).toBe(1);
    expect(share('fuzzer', 'fuzz.')).toBeGreaterThan(0.5);
    expect(share('browser', 'browse.')).toBeGreaterThan(0.5);
  });
});
