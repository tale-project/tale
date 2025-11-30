/* tslint:disable */

/**
 * This file contains Convex-compatible enums for the application.
 */

export const USER_ROLE = {
  Disabled: 'Disabled',
  Member: 'Member',
  Editor: 'Editor',
  Developer: 'Developer',
  Admin: 'Admin',
} as const;

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

export const BUSINESS_STATUS = {
  idle: 'idle',
  processing: 'processing',
} as const;

export type BusinessStatus =
  (typeof BUSINESS_STATUS)[keyof typeof BUSINESS_STATUS];

export const CHURN_REASON = {
  NoLongerNeeded: 'NoLongerNeeded',
  Cost: 'Cost',
  ProductIssues: 'ProductIssues',
  ServiceIssues: 'ServiceIssues',
  FoundAnother: 'FoundAnother',
  Other: 'Other',
  Unknown: 'Unknown',
} as const;

export type ChurnReason = (typeof CHURN_REASON)[keyof typeof CHURN_REASON];

export const CONVERSATION_MESSAGE_STATUS = {
  pending: 'pending',
  processing: 'processing',
  sent: 'sent',
  pending_regeneration: 'pending_regeneration',
  approved: 'approved',
  sent_failed: 'sent_failed',
  spam: 'spam',
  received: 'received',
} as const;

export type ConversationMessageStatus =
  (typeof CONVERSATION_MESSAGE_STATUS)[keyof typeof CONVERSATION_MESSAGE_STATUS];

export const CONVERSATION_PRIORITY = {
  low: 'low',
  medium: 'medium',
  high: 'high',
} as const;

export type ConversationPriority =
  (typeof CONVERSATION_PRIORITY)[keyof typeof CONVERSATION_PRIORITY];

export const CONVERSATION_STATUS = {
  pending: 'pending',
  resolved: 'resolved',
  spam: 'spam',
  archived: 'archived',
} as const;

export type ConversationStatus =
  (typeof CONVERSATION_STATUS)[keyof typeof CONVERSATION_STATUS];

export const CUSTOMER_STATUS = {
  active: 'active',
  churned: 'churned',
  potential: 'potential',
} as const;

export type CustomerStatus =
  (typeof CUSTOMER_STATUS)[keyof typeof CUSTOMER_STATUS];

export const CUSTOMER_SOURCE = {
  manual_import: 'manual_import',
  file_upload: 'file_upload',
  circuly: 'circuly',
} as const;

export type CustomerSource =
  (typeof CUSTOMER_SOURCE)[keyof typeof CUSTOMER_SOURCE];

export const EMAIL_APPROVAL_STATUS = {
  Pending: 'Pending',
  Approved: 'Approved',
  Rejected: 'Rejected',
} as const;

export type EmailApprovalStatus =
  (typeof EMAIL_APPROVAL_STATUS)[keyof typeof EMAIL_APPROVAL_STATUS];

export const EMAIL_PROVIDER_TYPE = {
  resend: 'resend',
  smtp: 'smtp',
  imap: 'imap',
} as const;

export type EmailProviderType =
  (typeof EMAIL_PROVIDER_TYPE)[keyof typeof EMAIL_PROVIDER_TYPE];

export const EMAIL_STATUS = {
  Pending: 'Pending',
  InProgress: 'InProgress',
  Cancelled: 'Cancelled',
  Failed: 'Failed',
  Sent: 'Sent',
  AwaitingApproval: 'AwaitingApproval',
} as const;

export type EmailStatus = (typeof EMAIL_STATUS)[keyof typeof EMAIL_STATUS];

export const EMAIL_USAGE = {
  ProductRecommendation: 'ProductRecommendation',
  ChurnSurvey: 'ChurnSurvey',
} as const;

export type EmailUsage = (typeof EMAIL_USAGE)[keyof typeof EMAIL_USAGE];

export const EMAIL_VENDOR_TYPE = {
  gmail: 'gmail',
  outlook: 'outlook',
  generic: 'generic',
} as const;

export type EmailVendorType =
  (typeof EMAIL_VENDOR_TYPE)[keyof typeof EMAIL_VENDOR_TYPE];

export const FULFILLMENT_STATUS = {
  fulfilled: 'fulfilled',
  null: 'null',
  partial: 'partial',
  restocked: 'restocked',
} as const;

export type FulfillmentStatus =
  (typeof FULFILLMENT_STATUS)[keyof typeof FULFILLMENT_STATUS];

export const LANGUAGE = {
  en: 'en',
  de: 'de',
  fr: 'fr',
} as const;

export type Language = (typeof LANGUAGE)[keyof typeof LANGUAGE];

export const MESSAGE_CHANNEL = {
  Email: 'Email',
} as const;

export type MessageChannel =
  (typeof MESSAGE_CHANNEL)[keyof typeof MESSAGE_CHANNEL];

export const MESSAGE_USAGE = {
  ProductRecommendation: 'ProductRecommendation',
  ChurnSurvey: 'ChurnSurvey',
  PotentialCustomerProductRecommendation:
    'PotentialCustomerProductRecommendation',
} as const;

export type MessageUsage = (typeof MESSAGE_USAGE)[keyof typeof MESSAGE_USAGE];

export const ORDER_STATUS = {
  pending: 'pending',
  authorized: 'authorized',
  partially_paid: 'partially_paid',
  paid: 'paid',
  partially_refunded: 'partially_refunded',
  refunded: 'refunded',
  voided: 'voided',
  cancelled: 'cancelled',
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const PRODUCT_TYPE = {
  item: 'item',
  service: 'service',
} as const;

export type ProductType = (typeof PRODUCT_TYPE)[keyof typeof PRODUCT_TYPE];

export const RECOMMENDATION_REVIEW_STATUS = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
} as const;

export type RecommendationReviewStatus =
  (typeof RECOMMENDATION_REVIEW_STATUS)[keyof typeof RECOMMENDATION_REVIEW_STATUS];

export const SUBSCRIPTION_STATUS = {
  Active: 'Active',
  Cancelled: 'Cancelled',
  Other: 'Other',
} as const;

export type SubscriptionStatus =
  (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

export const TASK_PRIORITY = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  urgent: 'urgent',
} as const;

export type TaskPriority = (typeof TASK_PRIORITY)[keyof typeof TASK_PRIORITY];

export const TASK_RESULT_ENTITY_TYPE = {
  ProductRecommendation: 'ProductRecommendation',
  Email: 'Email',
  Conversation: 'Conversation',
  ConversationMessage: 'ConversationMessage',
  Customer: 'Customer',
  Subscription: 'Subscription',
  ChurnSurvey: 'ChurnSurvey',
  MessageTemplate: 'MessageTemplate',
  BusinessStatistics: 'BusinessStatistics',
} as const;

export type TaskResultEntityType =
  (typeof TASK_RESULT_ENTITY_TYPE)[keyof typeof TASK_RESULT_ENTITY_TYPE];

export const TASK_STATUS = {
  pending: 'pending',
  processing: 'processing',
  pending_review: 'pending_review',
  approved: 'approved',
  rejected: 'rejected',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

export const TASK_TYPE = {
  'product-recommendation-review': 'product-recommendation-review',
  'email-review': 'email-review',
  'conversation-review': 'conversation-review',
  'generate-product-recommendation': 'generate-product-recommendation',
  'generate-recommendation-email': 'generate-recommendation-email',
  'generate-conversation': 'generate-conversation',
  'send-email': 'send-email',
  'send-conversation': 'send-conversation',
  'bulk-generate-recommendations': 'bulk-generate-recommendations',
  'bulk-generate-emails': 'bulk-generate-emails',
  'bulk-send-emails': 'bulk-send-emails',
  'process-business-recommendations': 'process-business-recommendations',
  'sync-products': 'sync-products',
  'sync-subscriptions': 'sync-subscriptions',
  'update-business-statistics': 'update-business-statistics',
  'create-churn-survey': 'create-churn-survey',
} as const;

export type TaskType = (typeof TASK_TYPE)[keyof typeof TASK_TYPE];

// Product status types
export enum PRODUCT_STATUS {
  Active = 'active',
  Inactive = 'inactive',
  Draft = 'draft',
  Archived = 'archived',
}

export type ProductStatus = PRODUCT_STATUS;
