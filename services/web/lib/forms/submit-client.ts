import type { SubmitRequest } from './schemas';

type SubmitResult =
  | { ok: true }
  | { ok: false; status: number; error: string; code?: string };

export async function submitForm(
  request: SubmitRequest,
): Promise<SubmitResult> {
  try {
    const response = await fetch('/api/forms/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (response.ok) return { ok: true };

    const error = await response.text().catch(() => 'Submission failed');
    // The endpoint answers JSON (`{ ok, error }`); `error` doubles as a
    // machine code (e.g. `not_configured`) the UI maps to a precise message.
    let code: string | undefined;
    try {
      const parsed: unknown = JSON.parse(error);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'error' in parsed &&
        typeof parsed.error === 'string'
      ) {
        code = parsed.error;
      }
    } catch (cause) {
      // Non-JSON body (proxy error page, plain-text 502) — status alone
      // decides the message.
      console.warn('[forms] non-JSON error body', cause);
    }
    return { ok: false, status: response.status, error, code };
  } catch (cause) {
    console.error('[forms] submit failed', cause);
    return { ok: false, status: 0, error: 'Network error' };
  }
}
