// js-sha256 is used instead of crypto.subtle because subtle is unavailable in insecure (non-HTTPS) contexts.
import { sha256 } from 'js-sha256';

export async function calculateFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  return sha256(buffer);
}
