import type { PiiPattern, PiiPatternFactory } from '../core/types';

const PATTERN: PiiPattern = {
  name: 'macAddress',
  regex:
    /\b(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}\b|\b(?:[0-9a-fA-F]{4}\.){2}[0-9a-fA-F]{4}\b/g,
  replacement: '[MAC_ADDRESS]',
};

export const macAddressFactory: PiiPatternFactory = () => [PATTERN];
