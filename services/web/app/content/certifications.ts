/**
 * Verified provider certification and product licence chips in the
 * compliance section. Labels state the scope of each claim.
 */
export const CERTIFICATION_KEYS = ['iso27001', 'mit', 'openSource'] as const;

export type CertificationKey = (typeof CERTIFICATION_KEYS)[number];
