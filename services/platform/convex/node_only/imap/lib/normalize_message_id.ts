'use node';

export default function normalizeMessageId(id: string): string {
  return id.replace(/^<|>$/g, '').trim();
}
