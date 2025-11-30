import { MESSAGE_USAGE } from './convex-enums';
import type { MessageUsage } from './convex-enums';

// Email type definitions with display names
export const EMAIL_TYPES = Object.freeze({
  all: { value: 'all', label: 'All' },
  productRecommendation: {
    value: MESSAGE_USAGE.ProductRecommendation,
    label: 'Product Recommendation',
  },
  churnSurvey: {
    value: MESSAGE_USAGE.ChurnSurvey,
    label: 'Churn Survey',
  },
  potentialCustomerProductRecommendation: {
    value: MESSAGE_USAGE.PotentialCustomerProductRecommendation,
    label: 'Potential Customer Product Recommendation',
  },
});

// Helper to get all email type options for selects
export const EMAIL_TYPE_OPTIONS = Object.values(EMAIL_TYPES);

// Helper to check if a value is a valid MessageUsage enum (used for Email.usage field)
export const isValidEmailUsage = (value: string): value is MessageUsage => {
  return Object.values(MESSAGE_USAGE).includes(value as MessageUsage);
};
