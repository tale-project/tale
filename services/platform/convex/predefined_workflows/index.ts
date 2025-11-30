// Individual Workflows

import shopifySyncProducts from './shopify_sync_products';
import shopifySyncCustomers from './shopify_sync_customers';
import circulySyncCustomers from './circuly_sync_customers';
import circulySyncProducts from './circuly_sync_products';
import circulySyncSubscriptions from './circuly_sync_subscriptions';
import emailSyncImap from './email_sync_imap';
import emailSyncSentImap from './email_sync_sent_imap';
import loopiProductRecommendation from './loopi_product_recommendation';
import productRecommendationEmail from './product_recommendation_email';
import generalProductRecommendation from './general_product_recommendation';
import generalCustomerStatusAssessment from './general_customer_status_assessment';
import documentRagSync from './document_rag_sync';
import productRagSync from './product_rag_sync';
import customerRagSync from './customer_rag_sync';
import conversationAutoReply from './conversation_auto_reply';
import loopiCustomerStatusAssessment from './loopi_customer_status_assessment';
import productRelationshipAnalysis from './product_relationship_analysis';
import onedriveSync from './onedrive_sync';
import websiteScan from './website_scan';
import workflowRagSync from './workflow_rag_sync';
import websitePagesRagSync from './website_pages_rag_sync';

// Dynamic Orchestration Examples
// (examples directory removed)

export {
  shopifySyncProducts,
  shopifySyncCustomers,
  circulySyncCustomers,
  circulySyncProducts,
  circulySyncSubscriptions,
  emailSyncImap,
  emailSyncSentImap,
  loopiProductRecommendation,
  productRecommendationEmail,
  documentRagSync,
  productRagSync,
  customerRagSync,
  conversationAutoReply,
  loopiCustomerStatusAssessment,
  productRelationshipAnalysis,
  onedriveSync,
  websiteScan,
  workflowRagSync,
  websitePagesRagSync,
};

export const workflows = {
  circulySyncCustomers,
  circulySyncProducts,
  circulySyncSubscriptions,
  emailSyncImap,
  emailSyncSentImap,
  shopifySyncProducts,
  shopifySyncCustomers,

  loopiProductRecommendation,
  productRecommendationEmail,
  generalProductRecommendation,
  generalCustomerStatusAssessment,

  documentRagSync,
  productRagSync,
  customerRagSync,
  onedriveSync,
  websiteScan,
  workflowRagSync,
  websitePagesRagSync,
  conversationAutoReply,
  loopiCustomerStatusAssessment,
  productRelationshipAnalysis,
} as const;
