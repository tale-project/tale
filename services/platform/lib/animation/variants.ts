import type { Variants } from 'framer-motion';
import { DURATION, EASING } from './constants';

/**
 * Fade animation variants
 */
export const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: DURATION.standard / 1000, ease: EASING.out },
  },
  exit: {
    opacity: 0,
    transition: { duration: DURATION.short / 1000, ease: EASING.in },
  },
};

/**
 * Scale + fade animation variants (for modals, popovers)
 */
export const scaleVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: DURATION.standard / 1000, ease: EASING.out },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: { duration: DURATION.short / 1000, ease: EASING.in },
  },
};

/**
 * Slide up animation variants (for toasts, alerts)
 */
export const slideUpVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.standard / 1000, ease: EASING.out },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: DURATION.short / 1000, ease: EASING.in },
  },
};

/**
 * Slide down animation variants (for dropdowns)
 */
export const slideDownVariants: Variants = {
  hidden: { opacity: 0, y: -8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.standard / 1000, ease: EASING.out },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: DURATION.short / 1000, ease: EASING.in },
  },
};

/**
 * Staggered children container (for lists)
 */
export const staggerContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      staggerChildren: 0.03,
      staggerDirection: -1,
    },
  },
};

/**
 * Staggered child item
 */
export const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.standard / 1000, ease: EASING.out },
  },
};

/**
 * Collapse/expand height animation
 */
export const collapseVariants: Variants = {
  collapsed: {
    height: 0,
    opacity: 0,
    transition: { duration: DURATION.standard / 1000, ease: EASING.inOut },
  },
  expanded: {
    height: 'auto',
    opacity: 1,
    transition: { duration: DURATION.standard / 1000, ease: EASING.out },
  },
};

/**
 * Button press animation
 */
export const pressVariants: Variants = {
  idle: { scale: 1 },
  pressed: {
    scale: 0.97,
    transition: { duration: 0.075, ease: EASING.out },
  },
};
