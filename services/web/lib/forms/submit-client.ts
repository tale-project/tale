import type { SubmitRequest } from './schemas';

type SubmitResult = { ok: true } | { ok: false; status: number; error: string };

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
    return { ok: false, status: response.status, error };
  } catch (cause) {
    console.error('[forms] submit failed', cause);
    return { ok: false, status: 0, error: 'Network error' };
  }
}
