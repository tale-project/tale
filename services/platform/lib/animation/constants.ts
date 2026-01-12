/**
 * Animation duration tokens in milliseconds
 */
export const DURATION = {
  instant: 0,
  micro: 100,
  short: 150,
  standard: 200,
  medium: 300,
  long: 400,
  slow: 500,
} as const;

/**
 * Easing functions for Framer Motion
 */
export const EASING = {
  default: [0.25, 0.1, 0.25, 1] as const,
  in: [0.42, 0, 1, 1] as const,
  out: [0, 0, 0.58, 1] as const,
  inOut: [0.42, 0, 0.58, 1] as const,
  spring: [0.175, 0.885, 0.32, 1.275] as const,
};

/**
 * Spring configuration presets for Framer Motion
 */
export const SPRING = {
  snappy: { type: 'spring' as const, stiffness: 400, damping: 30 },
  gentle: { type: 'spring' as const, stiffness: 200, damping: 25 },
  bouncy: { type: 'spring' as const, stiffness: 300, damping: 15 },
  quick: { type: 'spring' as const, stiffness: 500, damping: 35 },
};

/**
 * Standard transition presets
 */
export const TRANSITION = {
  micro: { duration: DURATION.micro / 1000, ease: EASING.default },
  short: { duration: DURATION.short / 1000, ease: EASING.default },
  standard: { duration: DURATION.standard / 1000, ease: EASING.out },
  medium: { duration: DURATION.medium / 1000, ease: EASING.out },
  long: { duration: DURATION.long / 1000, ease: EASING.out },
};
