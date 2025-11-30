// Temporary stub for missing Typeform integration. Replace with real implementation.
export async function autoTranslateForm({
  formId,
  language,
}: {
  formId: string;
  language: string;
}) {
  console.warn('[stub] autoTranslateForm called for formId:', formId, 'lang:', language);
  return { statusCode: 200 } as const;
}

