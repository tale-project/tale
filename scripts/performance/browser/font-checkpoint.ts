import assert from 'node:assert/strict';

import type { FontEvidence } from './font-evidence.ts';
import type { classifyFontEvidence } from './font-policy.ts';

export interface FontCheckpoint {
  fonts: FontEvidence | null;
  errors: string[];
  collectionError?: string;
  validationErrors?: string[];
  persistenceError?: string;
  classification?: ReturnType<typeof classifyFontEvidence>;
}

/** Collect only outside action/heap windows. Cache and persist the identity of
 * an invalid font before the original all-faces assertion can abort a row. */
export async function fontCheckpoint(io: {
  collect: () => Promise<FontEvidence>;
  errors: () => string[];
  retain: (evidence: FontCheckpoint) => void;
  persist: (evidence: FontCheckpoint) => Promise<void>;
  classify?: (
    evidence: FontEvidence,
  ) => ReturnType<typeof classifyFontEvidence>;
}) {
  const evidence: FontCheckpoint = { fonts: null, errors: [] };
  const failures: unknown[] = [];
  try {
    evidence.fonts = await io.collect();
  } catch (error) {
    evidence.collectionError = String(error);
    failures.push(error);
  }
  evidence.errors = [...io.errors()];
  // Build the original failure before secondary evidence/persistence failures.
  if (evidence.fonts) {
    try {
      if (io.classify) {
        evidence.classification = io.classify(evidence.fonts);
        assert(
          evidence.classification.valid,
          evidence.classification.failures.join('; '),
        );
      } else {
        assert.equal(
          evidence.fonts.faces.filter((face) => face.status === 'error').length,
          0,
          'A font failed to load',
        );
      }
    } catch (error) {
      failures.unshift(error);
    }
    if (!evidence.fonts.complete)
      failures.push(new Error('Font evidence collection is incomplete'));
  }
  evidence.validationErrors = failures.map((error) => String(error));
  io.retain(evidence);
  try {
    await io.persist(evidence);
  } catch (error) {
    evidence.persistenceError = String(error);
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      failures.map((error) => String(error)).join('; '),
    );
  return evidence;
}
