import type { Rule } from '../model';
import { layout } from './layout';
import { references } from './references';
import { runs } from './runs';
import { suites } from './suites';

/** Every rule, in the order a reader meets the tree. */
export const RULES: { name: string; rule: Rule }[] = [
  { name: 'layout', rule: layout },
  { name: 'suites', rule: suites },
  { name: 'runs', rule: runs },
  { name: 'references', rule: references },
];
