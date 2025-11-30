// Temporary stub for missing Typeform integration. Replace with real implementation.
export async function updateFormTranslation({
  formId,
  language,
  translation: _translation,
}: {
  formId: string;
  language: string;
  translation: unknown;
}) {
  console.warn('[stub] updateFormTranslation called', { formId, language });
  return { statusCode: 200 } as const;
}
