/**
 * Trust chips shown on the homepage hero line and the compliance section.
 * Order is the product claim order — keep hero and badges in lockstep.
 */
export const CERTIFICATION_KEYS = [
  'iso27001',
  'soc2',
  'gdpr',
  'mit',
  'openSource',
] as const;

export type CertificationKey = (typeof CERTIFICATION_KEYS)[number];
