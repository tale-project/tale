// Temporary stub for missing Typeform integration. Replace with real implementation.
export async function updateFormFields({
  formId,
  fields: _fields,
}: {
  formId: string;
  fields: Array<unknown>;
}) {
  console.warn('[stub] updateFormFields called for formId:', formId);
  return { statusCode: 200 } as const;
}
