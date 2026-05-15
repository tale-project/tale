/**
 * MAC address detection — colon/hyphen-separated and Cisco dotted formats.
 *
 * Formats matched:
 *   - `XX:XX:XX:XX:XX:XX` or `XX-XX-XX-XX-XX-XX` (IEEE 802)
 *   - `XXXX.XXXX.XXXX` (Cisco IOS)
 *
 * False-positive design choice:
 *   All-zeros (`00:00:00:00:00:00`) and broadcast (`FF:FF:FF:FF:FF:FF`)
 *   are technically valid MAC addresses but commonly appear in logs and
 *   configuration defaults as placeholders, not as PII. We intentionally
 *   do NOT filter them out — masking them is the conservative choice.
 *   A non-PII placeholder being masked is harmless, whereas skipping a
 *   real device identifier would be a privacy leak.
 */
import type { PiiPattern, PiiPatternFactory } from '../core/types';

const PATTERN: PiiPattern = {
  name: 'macAddress',
  regex:
    /\b(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}\b|\b(?:[0-9a-fA-F]{4}\.){2}[0-9a-fA-F]{4}\b/g,
  replacement: '[MAC_ADDRESS]',
};

export const macAddressFactory: PiiPatternFactory = () => [PATTERN];
