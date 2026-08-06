import { getString, isRecord } from '../../../lib/utils/type-utils';

/**
 * Derive the contact address from conversation metadata (root email snapshot).
 */
export function contactEmailFromConversationMetadata(
  metadata: unknown,
  direction: 'inbound' | 'outbound' = 'inbound',
): string | undefined {
  if (!isRecord(metadata)) return undefined;

  const fromRaw = metadata.from;
  const toRaw = metadata.to;
  const fromList = Array.isArray(fromRaw) ? fromRaw : undefined;
  const toList = Array.isArray(toRaw) ? toRaw : undefined;
  const fromFirst = fromList?.[0];
  const toFirst = toList?.[0];

  const fromAddress = isRecord(fromFirst)
    ? getString(fromFirst, 'address')?.toLowerCase()
    : undefined;
  const toAddress = isRecord(toFirst)
    ? getString(toFirst, 'address')?.toLowerCase()
    : undefined;

  return direction === 'outbound' ? toAddress : fromAddress;
}
