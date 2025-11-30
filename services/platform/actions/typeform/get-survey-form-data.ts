// Temporary stub for missing Typeform integration. Replace with real implementation.
export async function getSurveyFormData({ businessId }: { businessId: string }) {
  console.warn('[stub] getSurveyFormData called for businessId:', businessId);
  return {
    statusCode: 200,
    data: {
      churnSurvey: {
        business_id: businessId,
        typeform_id: 'stub-form-id',
        created_at: new Date().toISOString(),
        display_url: 'https://www.typeform.com',
      },
      formData: {
        title: 'Churn Survey Form',
        fields: [],
        welcome_screens: [],
        thankyou_screens: [],
      },
      translationStatus: {
        languages: [{ code: 'en', status: 'translated' }],
      },
    },
  } as const;
}

