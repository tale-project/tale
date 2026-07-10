import { describe, expect, it } from 'vitest';

import { validateStepAnnotations } from './validate_step_annotations';

describe('validateStepAnnotations', () => {
  it('accepts a known render-kind + slug role with no errors', () => {
    const { errors, warnings } = validateStepAnnotations({
      ui: { render: 'review', params: { mode: 'gate', cardinality: 'one' } },
      role: 'coordinator',
    });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('errors on an unknown render-kind', () => {
    const { errors } = validateStepAnnotations({ ui: { render: 'bogus' } });
    expect(errors.some((e) => e.includes('render-kind'))).toBe(true);
  });

  it('errors when ui is present without render', () => {
    const { errors } = validateStepAnnotations({ ui: { stage: 'x' } });
    expect(errors.some((e) => e.includes('ui.render'))).toBe(true);
  });

  it('warns (not errors) on an unknown composition param value', () => {
    const { errors, warnings } = validateStepAnnotations({
      ui: { render: 'collection', params: { layout: 'spiral' } },
    });
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes('layout'))).toBe(true);
  });

  it('warns on an unknown surface value', () => {
    const { errors, warnings } = validateStepAnnotations({
      ui: { render: 'artifact', params: { surface: 'deliver' } },
    });
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes('surface'))).toBe(true);
  });

  it('accepts surface outcome without warnings', () => {
    const { errors, warnings } = validateStepAnnotations({
      ui: { render: 'artifact', params: { surface: 'outcome' } },
    });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('warns on an unknown field type', () => {
    const { warnings } = validateStepAnnotations({
      ui: {
        render: 'collection',
        params: { fields: [{ key: 'a', labelKey: 'k', type: 'made_up' }] },
      },
    });
    expect(warnings.some((w) => w.includes('type'))).toBe(true);
  });

  it('errors on a malformed role', () => {
    const { errors } = validateStepAnnotations({ role: 'Not A Slug!' });
    expect(errors.some((e) => e.includes('role'))).toBe(true);
  });

  it('is a no-op when neither ui nor role is present', () => {
    const { errors, warnings } = validateStepAnnotations({
      stepSlug: 's',
      stepType: 'action',
    });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
