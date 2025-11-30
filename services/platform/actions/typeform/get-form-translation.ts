// Temporary stub for missing Typeform integration. Replace with real implementation.
export async function getFormTranslation({
  formId,
  language,
}: {
  formId: string;
  language: string;
}) {
  console.warn('[stub] getFormTranslation called for formId:', formId, 'lang:', language);
  return {
    statusCode: 200,
    data: {
      fields: [],
      welcome_screens: [],
      thankyou_screens: [],
    },
  } as const;
}

