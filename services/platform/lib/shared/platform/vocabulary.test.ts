import { describe, expect, it } from 'vitest';

import { FIELD_TYPES, isFieldType } from './field_types';
import { PART_STATES, SLA_ACTIONS, isPartState } from './part_state';
import {
  ARTIFACT_DISPLAYS,
  COLLECTION_LAYOUTS,
  RENDER_KINDS,
  RENDER_KIND_META,
  REVIEW_CARDINALITIES,
  REVIEW_MODES,
  STREAM_ENTRY_KINDS,
  isRenderKind,
} from './render_kinds';
import { STRUCTURAL_ROLES, isStructuralRole } from './roles';
import { STEP_MODES, isStepMode } from './step_modes';

const noDuplicates = (arr: readonly string[]) =>
  new Set(arr).size === arr.length;

describe('platform render-kinds vocabulary', () => {
  it('is the expected frozen set of 10 kinds', () => {
    expect([...RENDER_KINDS]).toEqual([
      'status',
      'ingest',
      'transform',
      'validation',
      'reconciliation',
      'diff',
      'collection',
      'artifact',
      'stream',
      'review',
    ]);
  });

  it('has no duplicate kinds', () => {
    expect(noDuplicates(RENDER_KINDS)).toBe(true);
  });

  it('declares metadata for exactly every kind, with a matching labelKeyPrefix', () => {
    expect(Object.keys(RENDER_KIND_META).sort()).toEqual(
      [...RENDER_KINDS].sort(),
    );
    for (const kind of RENDER_KINDS) {
      expect(RENDER_KIND_META[kind].labelKeyPrefix).toBe(
        `platform.render.${kind}`,
      );
    }
  });

  it('guards membership', () => {
    expect(isRenderKind('review')).toBe(true);
    expect(isRenderKind('not_a_kind')).toBe(false);
  });

  it('keeps composition params as closed, non-empty, duplicate-free sets', () => {
    for (const params of [
      ARTIFACT_DISPLAYS,
      COLLECTION_LAYOUTS,
      STREAM_ENTRY_KINDS,
      REVIEW_MODES,
      REVIEW_CARDINALITIES,
    ]) {
      expect(params.length).toBeGreaterThan(0);
      expect(noDuplicates(params)).toBe(true);
    }
  });
});

describe('platform state / mode / field / role vocabularies', () => {
  it('freezes the lifecycle state axis (incl. waiting + empty)', () => {
    expect([...PART_STATES]).toEqual([
      'upcoming',
      'loading',
      'running',
      'output_available',
      'output_error',
      'waiting_human',
      'waiting_external',
      'empty',
    ]);
    expect(isPartState('waiting_external')).toBe(true);
    expect(isPartState('nope')).toBe(false);
  });

  it('declares the deferred SLA annotation tokens', () => {
    expect([...SLA_ACTIONS]).toEqual([
      'timeout',
      'escalate',
      'delegate',
      'reminder',
    ]);
  });

  it('freezes step modes', () => {
    expect([...STEP_MODES]).toEqual([
      'automated',
      'review_gate',
      'human_input',
      'terminal',
    ]);
    expect(isStepMode('review_gate')).toBe(true);
    expect(isStepMode('nope')).toBe(false);
  });

  it('freezes field types', () => {
    expect(FIELD_TYPES).toContain('currency');
    expect(noDuplicates(FIELD_TYPES)).toBe(true);
    expect(isFieldType('currency')).toBe(true);
    expect(isFieldType('nope')).toBe(false);
  });

  it('freezes structural role tokens', () => {
    expect([...STRUCTURAL_ROLES]).toEqual(['manager', 'report', 'self']);
    expect(isStructuralRole('manager')).toBe(true);
    expect(isStructuralRole('some-agent-slug')).toBe(false);
  });
});
