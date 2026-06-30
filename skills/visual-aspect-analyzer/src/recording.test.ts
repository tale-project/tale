import { describe, expect, test } from 'bun:test';

import { loadRecording, validateRecording, type JsonValue } from './recording';

const rectJson = { top: 0, right: 10, bottom: 10, left: 0 };

const sampleJson: JsonValue = {
  t: 0,
  frame: 0,
  segment: 0,
  rectScreen: rectJson,
  rectPage: rectJson,
  opacity: 1,
  visible: true,
  inViewport: true,
  occluded: false,
  paints: true,
  pixelNoise: null,
};

const elementJson: JsonValue = {
  key: 'va-1',
  testid: 'va-1',
  selector: '#x',
  kind: 'tracked',
  ancestorKeys: [],
  samples: [sampleJson],
};

const validJson: JsonValue = {
  pixelThreshold: 1,
  frameBudgetMs: 16,
  segments: [{ index: 0, url: 'https://e.test/', from: 0, to: 10 }],
  elements: [elementJson],
  layoutShifts: [],
};

describe('validateRecording', () => {
  test('accepts a well-formed recording', () => {
    const recording = validateRecording(validJson);
    expect(recording.elements.length).toBe(1);
    expect(recording.elements[0]?.samples[0]?.opacity).toBe(1);
  });

  test('parses an optional layoutProbe when present', () => {
    const withProbe: JsonValue = {
      ...validJson,
      elements: [
        { ...elementJson, layoutProbe: { affects: true, movedKeys: ['c'] } },
      ],
    };
    expect(validateRecording(withProbe).elements[0]?.layoutProbe?.affects).toBe(
      true,
    );
  });

  test('leaves layoutProbe undefined when absent', () => {
    expect(
      validateRecording(validJson).elements[0]?.layoutProbe,
    ).toBeUndefined();
  });

  test('accepts an optional colorKey when present', () => {
    const coloured: JsonValue = {
      ...validJson,
      elements: [
        { ...elementJson, samples: [{ ...sampleJson, colorKey: 42 }] },
      ],
    };
    expect(validateRecording(coloured).elements[0]?.samples[0]?.colorKey).toBe(
      42,
    );
  });

  test('accepts a numeric pixelNoise', () => {
    const noisy: JsonValue = {
      ...validJson,
      elements: [
        { ...elementJson, samples: [{ ...sampleJson, pixelNoise: 0.3 }] },
      ],
    };
    expect(validateRecording(noisy).elements[0]?.samples[0]?.pixelNoise).toBe(
      0.3,
    );
  });

  test('throws when the root is not an object', () => {
    expect(() => validateRecording([])).toThrow(/\$: expected object/);
  });

  test('throws with the failing path for a wrong scalar type', () => {
    const bad: JsonValue = { ...validJson, pixelThreshold: 'nope' };
    expect(() => validateRecording(bad)).toThrow(/\$\.pixelThreshold/);
  });

  test('throws on an unknown element kind', () => {
    const bad: JsonValue = {
      ...validJson,
      elements: [{ ...elementJson, kind: 'ghost' }],
    };
    expect(() => validateRecording(bad)).toThrow(/kind/);
  });

  test('throws on a non-number pixelNoise', () => {
    const bad: JsonValue = {
      ...validJson,
      elements: [
        { ...elementJson, samples: [{ ...sampleJson, pixelNoise: 'x' }] },
      ],
    };
    expect(() => validateRecording(bad)).toThrow(/pixelNoise/);
  });

  test('rejects a non-finite number (Infinity)', () => {
    const bad: JsonValue = { ...validJson, frameBudgetMs: Infinity };
    expect(() => validateRecording(bad)).toThrow(
      /frameBudgetMs: expected finite number/,
    );
  });

  test('rejects a negative frame index', () => {
    const bad: JsonValue = {
      ...validJson,
      elements: [{ ...elementJson, samples: [{ ...sampleJson, frame: -1 }] }],
    };
    expect(() => validateRecording(bad)).toThrow(
      /frame: expected non-negative integer/,
    );
  });

  test('rejects a fractional frame index', () => {
    const bad: JsonValue = {
      ...validJson,
      elements: [{ ...elementJson, samples: [{ ...sampleJson, frame: 1.5 }] }],
    };
    expect(() => validateRecording(bad)).toThrow(
      /frame: expected non-negative integer/,
    );
  });

  test('parses an element with a non-empty ancestor chain', () => {
    const withAncestors: JsonValue = {
      ...validJson,
      elements: [
        {
          key: 'va-2',
          testid: 'va-2',
          selector: '#y',
          kind: 'tracked',
          ancestorKeys: ['va-1', 'cand-1'],
          samples: [sampleJson],
        },
      ],
    };
    const el = validateRecording(withAncestors).elements[0];
    expect(el?.ancestorKeys).toEqual(['va-1', 'cand-1']);
  });

  test('parses a layout shift with attributed sources', () => {
    const withSources: JsonValue = {
      ...validJson,
      layoutShifts: [
        {
          t: 5,
          segment: 0,
          value: 0.2,
          hadRecentInput: false,
          sources: [
            {
              key: 'va-1',
              previousRect: rectJson,
              currentRect: { top: 5, right: 15, bottom: 15, left: 5 },
            },
            { key: null, previousRect: rectJson, currentRect: rectJson },
          ],
        },
      ],
    };
    const sources =
      validateRecording(withSources).layoutShifts[0]?.sources ?? [];
    expect(sources.length).toBe(2);
    expect(sources[0]?.key).toBe('va-1'); // a resolved attribution
    expect(sources[1]?.key).toBeNull(); // an unattributed source
    expect(sources[0]?.currentRect.top).toBe(5);
  });

  test('rejects a negative segment index on a layout shift', () => {
    const bad: JsonValue = {
      ...validJson,
      layoutShifts: [
        { t: 0, segment: -2, value: 0.1, hadRecentInput: false, sources: [] },
      ],
    };
    expect(() => validateRecording(bad)).toThrow(
      /segment: expected non-negative integer/,
    );
  });

  test('parses an optional whole-page audit block', () => {
    const withAudit: JsonValue = {
      ...validJson,
      audit: { wholePage: true, discovered: 7, capped: true },
    };
    expect(validateRecording(withAudit).audit).toEqual({
      wholePage: true,
      discovered: 7,
      capped: true,
    });
  });

  test('a selector-mode recording carries no audit block', () => {
    expect(validateRecording(validJson).audit).toBeUndefined();
  });

  test('rejects a malformed audit (non-integer discovered)', () => {
    const bad: JsonValue = {
      ...validJson,
      audit: { wholePage: true, discovered: -1, capped: false },
    };
    expect(() => validateRecording(bad)).toThrow(
      /audit\.discovered: expected non-negative integer/,
    );
  });
});

describe('loadRecording', () => {
  test('parses and validates JSON text', () => {
    const recording = loadRecording(JSON.stringify(validJson));
    expect(recording.frameBudgetMs).toBe(16);
  });

  test('propagates a JSON syntax error', () => {
    expect(() => loadRecording('{not json')).toThrow();
  });
});
