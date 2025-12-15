/**
 * Product Recommendation Email Workflow
 *
 * This workflow processes approved product recommendation approvals and generates
 * personalized email content for customers. It processes one approval at a time.
 *
 * High-level flow:
 * 1) Find one approved 'product_recommendation' approval
 * 2) Extract approval data and recommended products
 * 3) Sort products by confidence and select top 3
 * 4) Use AI to generate a product recommendation email with images
 * 5) Create a conversation without conversation message
 * 6) Create an approval with the "conversation" as the resource_type
 * 7) Record the original approval as processed
 *
 * Features:
 * - Processes one approval per execution (efficient and scalable)
 * - Uses workflow_processing_records for tracking processed approvals
 * - Automatically selects top 3 products by confidence score
 * - AI-powered email generation (GPT-4o) with product images
 * - Creates conversation for email tracking
 * - Creates new approval for email review before sending
 * - Records original product recommendation approval as processed
 *
 * Product Structure:
 * Each recommended product contains:
 * - productId: unique identifier
 * - productName: name of the product
 * - imageUrl: product image URL
 * - relationshipType: relationship to customer (e.g., "Complementary")
 * - reasoning: why this product is recommended
 * - confidence: confidence score (0-1)
 *
 * Workflow Type: Predefined
 * - Developer-defined workflow
 * - Users provide credentials and configuration
 * - Can be scheduled or triggered manually
 */

export const productRecommendationEmailWorkflow = {
  workflowConfig: {
    name: 'Product Recommendation Email',
    description:
      'Generate personalized product recommendation emails from pending approvals',
    workflowType: 'predefined',
    version: '1.0.0',
    config: {
      timeout: 300000, // 5 minutes total timeout
      retryPolicy: { maxRetries: 2, backoffMs: 3000 },
      variables: {
        organizationId: 'org_demo',
        workflowId: 'product-recommendation-email',
        backoffHours: 24, // Process each approval once per day
      },
    },
  },
  stepsConfig: [
    // Step 1: Trigger - Manual or Scheduled
    {
      stepSlug: 'start',
      name: 'start',
      stepType: 'trigger',
      order: 1,
      config: {
        type: 'manual',
        // For scheduled email generation, uncomment below:
        // schedule: '0 10 * * *', // Every day at 10 AM
        // timezone: 'UTC',
      },
      nextSteps: { success: 'find_approved_approval' },
    },

    // Step 2: Find One Approved Product Recommendation Approval
    {
      stepSlug: 'find_approved_approval',
      name: 'Find Approved Product Recommendation Approval',
      stepType: 'action',
      order: 2,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'find_product_recommendation_by_status',
          backoffHours: '{{backoffHours}}',
          status: 'approved',
        },
      },
      nextSteps: {
        success: 'check_has_approval',
      },
    },

    // Step 3: Check if Approval Found
    {
      stepSlug: 'check_has_approval',
      name: 'Check if Approval Found',
      stepType: 'condition',
      order: 3,
      config: {
        expression: 'steps.find_approved_approval.output.data != null',
        description: 'Check if we found an approved approval',
      },
      nextSteps: {
        true: 'extract_approval_data',
        false: 'noop',
      },
    },

    // Step 4: Extract Approval Data
    {
      stepSlug: 'extract_approval_data',
      name: 'Extract Approval Data',
      stepType: 'action',
      order: 4,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'currentApproval',
              value:
                '{{steps.find_approved_approval.output.data}}',
            },
            {
              name: 'currentApprovalId',
              value:
                '{{steps.find_approved_approval.output.data._id}}',
            },
            {
              name: 'customerId',
              value:
                '{{steps.find_approved_approval.output.data.metadata.customerId}}',
            },
            {
              name: 'customerName',
              value:
                '{{steps.find_approved_approval.output.data.metadata.customerName}}',
            },
            {
              name: 'customerEmail',
              value:
                '{{steps.find_approved_approval.output.data.metadata.customerEmail}}',
            },
            {
              name: 'recommendedProducts',
              value:
                '{{steps.find_approved_approval.output.data.metadata.recommendedProducts}}',
            },
          ],
        },
      },
      nextSteps: {
        success: 'select_top_products',
      },
    },

    // Step 5: Select Top 3 Products by Confidence
    {
      stepSlug: 'select_top_products',
      name: 'Select Top 3 Products by Confidence',
      stepType: 'action',
      order: 5,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'topProducts',
              value:
                '{{recommendedProducts|sort("confidence", "desc")|slice(0, 3)}}',
            },
          ],
        },
      },
      nextSteps: {
        success: 'generate_email',
      },
    },

    // Step 6: Generate Product Recommendation Email with AI
    {
      stepSlug: 'generate_email',
      name: 'Generate Product Recommendation Email',
      stepType: 'llm',
      order: 6,
      config: {
        name: 'Email Generator',
        temperature: 0.7,
        maxTokens: 2000,
        maxSteps: 1,
        outputFormat: 'json',
        tools: ['customer_search', 'rag_search'],
        systemPrompt: `You are an expert email copywriter who crafts narrative, story-driven product recommendation emails.
Your task is to write a short, human story that explains why these products are a great fit for the customer — not a robotic list.

You have access to tools and should use them when helpful:
- Use the "customer_search" tool to load the full customer record from the customers table (including locale, status, purchase metrics such as totalSpent, orderCount, firstPurchaseAt, lastPurchaseAt, tags, and metadata) using the provided customerId or email.
- Use the "rag_search" tool to look up any additional knowledge base context (for example, brand guidelines or product documentation) if needed.

When possible, call "customer_search" before drafting the email so you can adapt tone, language, and references to the customer’s locale and purchase history (for example, frequent buyer vs. new customer, high lifetime value, recently purchased, etc.).

Guidelines:
- Use a warm, conversational tone
- Weave recommendations into 2–4 short paragraphs; do NOT use bullet points or numbered lists in the main body
- Focus the story around the most relevant product; mention others naturally as supporting options if helpful
- Ground the narrative in the provided reasoning and relationshipType for each product, plus any relevant customer history
- Emphasize benefits and outcomes, not specs
- Include one clear call-to-action near the end
- Format the email body in Markdown (paragraphs, bold/italic, links). Avoid tables.
- Optional: include at most one inline image for the primary product using Markdown image syntax; do not present multiple images as a list or gallery

Return JSON format:
{
  "subject": "Email subject line",
  "body": "Full email body in Markdown format",
  "preview": "Email preview text (first line)"
}`,
        userPrompt: `Generate a narrative, story-style product recommendation email for:

Customer Name: {{customerName}}
Customer Email: {{customerEmail}}
Customer Id: {{customerId}} (Convex customers table id)

Use the following products (JSON) as context — do NOT paste this JSON into the email body:
{{topProducts}}

Before writing the email, if helpful, call the "customer_search" tool with the customerId or email to retrieve the full customer record (including locale, purchase metrics, tags, and metadata). Use this data to:
- Adapt the tone and language to the customer’s locale when possible
- Reference their relationship with the brand (for example, long-time customer, high-value buyer, recently inactive, etc.) when it makes the story stronger

Requirements:
- Do not list products like "Product 1/2/3" and do not use bullet points
- Write a cohesive story that naturally introduces the most relevant product and, if useful, references the others
- Do not include product IDs, field names, or raw JSON in the body
- If you include an image, use a single inline image for the primary product (the first item), placed near its description
- End with a friendly, single call-to-action

Return only the JSON object with "subject", "body", and "preview".`,
      },
      nextSteps: {
        success: 'create_conversation',
      },
    },

    // Step 7: Create Conversation (without message)
    {
      stepSlug: 'create_conversation',
      name: 'Create Conversation',
      stepType: 'action',
      order: 7,
      config: {
        type: 'conversation',
        parameters: {
          operation: 'create',
          customerId: '{{customerId}}',
          subject: '{{steps.generate_email.output.data.subject}}',
          status: 'open',
          priority: 'medium',
          type: 'product_recommendation',
          channel: 'email',
          direction: 'outbound',
          metadata: {
            emailSubject: '{{steps.generate_email.output.data.subject}}',
            emailBody: '{{steps.generate_email.output.data.body}}',
            emailPreview: '{{steps.generate_email.output.data.preview}}',
            customerEmail: '{{customerEmail}}',
            recommendedProducts: '{{topProducts}}',
            originalApprovalId: '{{currentApprovalId}}',
          },
        },
      },
      nextSteps: {
        success: 'create_email_approval',
      },
    },

    // Step 8: Create Approval for Email Review
    {
      stepSlug: 'create_email_approval',
      name: 'Create Email Approval',
      stepType: 'action',
      order: 8,
      config: {
        type: 'approval',
        parameters: {
          operation: 'create_approval',
          resourceType: 'conversations',
          resourceId:
            '{{steps.create_conversation.output.data._id}}',
          priority: 'medium',
          description:
            'Review and approve product recommendation email before sending',
          metadata: {
            customerId: '{{customerId}}',
            customerName: '{{customerName}}',
            customerEmail: '{{customerEmail}}',
            emailBody: '{{steps.generate_email.output.data.body}}',
            recommendedProducts: '{{topProducts}}',
            originalApprovalId: '{{currentApprovalId}}',
          },
        },
      },
      nextSteps: {
        success: 'record_processed',
      },
    },

    // Step 9: Record Approval as Processed
    {
      stepSlug: 'record_processed',
      name: 'Record Approval as Processed',
      stepType: 'action',
      order: 9,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'record_processed',
          tableName: 'approvals',
          recordId: '{{currentApprovalId}}',
          recordCreationTime: '{{currentApproval._creationTime}}',
          metadata: {
            emailGenerated: true,
            conversationId:
              '{{steps.create_conversation.output.data._id}}',
            emailApprovalId:
              '{{steps.create_email_approval.output.data._id}}',
            processedAt: '{{now}}',
          },
        },
      },
      nextSteps: {
        success: 'noop',
      },
    },
  ],
};

export default productRecommendationEmailWorkflow;
