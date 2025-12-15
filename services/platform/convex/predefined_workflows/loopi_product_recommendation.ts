/**
 * Product Recommendation Workflow
 *
 * This workflow generates AI-powered product recommendations for active customers based on their
 * subscription history and product relationships. It processes one customer per execution
 * using the workflow_processing_records system for efficient incremental processing.
 *
 * High-level flow:
 * 1) Find one unprocessed customer using workflow_processing_records
 * 2) Check if customer status is 'active' (skip if not)
 * 3) Extract product_ids from customer's subscription data
 * 4) Filter products where shop_variant_id overlaps with customer's product_ids
 * 5) Generate AI recommendations based on customer's current products and relationships
 * 6) Create approval record with recommendations for review
 * 7) Record customer as processed
 *
 * Features:
 * - Only processes active customers
 * - Processes one customer per execution (efficient and scalable)
 * - Uses workflow_processing_records for tracking processed customers
 * - Configurable backoff period (default: 168 hours / 7 days)
 * - AI-powered recommendation generation (GPT-4o)
 * - Creates approval records for human review before sending recommendations
 * - Extracts product_ids from subscription metadata
 * - AI identifies customer's current products and recommends complementary/upgrade products
 *
 * Workflow Type: Predefined
 * - Developer-defined workflow
 * - Users provide credentials and configuration
 * - Can be scheduled or triggered manually
 */

export const loopiProductRecommendationWorkflow = {
  workflowConfig: {
    name: 'Product Recommendation',
    description:
      'Generate AI-powered product recommendations for active customers based on their subscription history and product relationships',
    workflowType: 'predefined', // Predefined workflow - developer-defined, user provides credentials
    version: '2.0.0',
    config: {
      timeout: 300000, // 5 minutes total timeout
      retryPolicy: { maxRetries: 2, backoffMs: 3000 },
      variables: {
        organizationId: 'org_demo',
        workflowId: 'product-recommendation',
        backoffHours: 168, // Process each customer once per week (7 days * 24 hours)
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
        type: 'manual', // Can be changed to 'schedule' for automated recommendations
        // For scheduled recommendations, uncomment below:
        // schedule: '0 9 * * 1', // Every Monday at 9 AM
        // timezone: 'UTC',
      },
      nextSteps: { success: 'find_unprocessed_customer' },
    },

    // Step 2: Find One Unprocessed Customer
    {
      stepSlug: 'find_unprocessed_customer',
      name: 'Find One Unprocessed Customer',
      stepType: 'action',
      order: 2,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'find_unprocessed',
          tableName: 'customers',
          backoffHours: '{{backoffHours}}',
        },
      },
      nextSteps: {
        success: 'check_has_customer',
      },
    },

    // Step 3: Check if Customer Found
    {
      stepSlug: 'check_has_customer',
      name: 'Check if Customer Found',
      stepType: 'condition',
      order: 3,
      config: {
        expression: 'steps.find_unprocessed_customer.output.data != null',
        description: 'Check if we found an unprocessed customer',
      },
      nextSteps: {
        true: 'extract_customer_data',
        false: 'noop',
      },
    },

    // Step 4: Extract Customer Data and Shop Variant IDs
    {
      stepSlug: 'extract_customer_data',
      name: 'Extract Customer Data',
      stepType: 'action',
      order: 4,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'currentCustomer',
              value:
                '{{steps.find_unprocessed_customer.output.data}}',
            },
            {
              name: 'currentCustomerId',
              value:
                '{{steps.find_unprocessed_customer.output.data._id}}',
            },
            {
              name: 'currentCustomerName',
              value:
                '{{steps.find_unprocessed_customer.output.data.name}}',
            },
            {
              name: 'currentCustomerEmail',
              value:
                '{{steps.find_unprocessed_customer.output.data.email}}',
            },
            {
              name: 'currentCustomerStatus',
              value:
                '{{steps.find_unprocessed_customer.output.data.status}}',
            },
            {
              name: 'customerProductIds',
              value:
                '{{steps.find_unprocessed_customer.output.data.metadata.subscriptions.data|map("product_id")|unique}}',
            },
            {
              name: 'customerProductCount',
              value: '{{customerProductIds|length}}',
            },
          ],
        },
      },
      nextSteps: {
        success: 'check_customer_active',
      },
    },

    // Step 5: Check if Customer is Active
    {
      stepSlug: 'check_customer_active',
      name: 'Check if Customer is Active',
      stepType: 'condition',
      order: 5,
      config: {
        expression: 'currentCustomerStatus == "active"',
        description: 'Only process active customers',
      },
      nextSteps: {
        true: 'check_has_subscriptions',
        false: 'record_processed', // Skip non-active customers
      },
    },

    // Step 6: Check if Customer Has Subscriptions
    {
      stepSlug: 'check_has_subscriptions',
      name: 'Check Has Subscriptions',
      stepType: 'condition',
      order: 6,
      config: {
        expression: 'customerProductCount > 0',
        description: 'Check if customer has any product subscriptions',
      },
      nextSteps: {
        true: 'filter_customer_products',
        false: 'record_processed', // Skip this customer, record as processed
      },
    },

    // Step 7: Filter Products by Customer's Shop Variant IDs
    {
      stepSlug: 'filter_customer_products',
      name: 'Filter Customer Products',
      stepType: 'action',
      order: 7,
      config: {
        type: 'product',
        parameters: {
          operation: 'filter',
          expression:
            'metadata.circuly.variants|map("shop_variant_id")|hasOverlap({{customerProductIds}})',
        },
      },
      nextSteps: {
        success: 'compose_prompts',
      },
    },

    // Step 8: Compose LLM Prompts (separate step)
    {
      stepSlug: 'compose_prompts',
      name: 'Compose LLM Prompts',
      stepType: 'action',
      order: 8,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'llmSystemPrompt',
              value: `You are an expert product recommendation engine for a subscription-based baby product rental service. Analyze the customer's current subscriptions and product relationships to recommend relevant products they might be interested in.

	⚠️ CRITICAL REQUIREMENT: You MUST provide EXACTLY 5 product recommendations. This is non-negotiable. If you don't have 5 recommendations from relationships, you MUST use the product_read tool with operation = 'list' to browse and find more products.

	You have access to one unified product tool:
	- 'product_read'
	  - Use operation = 'get_by_id' to look up product details by productId (supports 'fields' selection to return only needed fields)
	  - Use operation = 'list' to list all available products with pagination (MUST USE if relationships give < 5 products)

RECOMMENDATION STRATEGY:
1. PRIORITY 1: Use relationship metadata from customer's current products
   - Look for relationships with confidence > 0.5 (lowered threshold for more options)
   - Use product_get to get full details of related products
   - Prefer "Complementary", "Upgrade", and "Bundle" relationship types
   - CRITICAL: Verify stock > 0 before including any product

2. PRIORITY 2: MANDATORY - If relationship products are insufficient (< 5 recommendations)
   - You MUST immediately call list_products to browse all available products
   - Look for products in relevant categories based on customer's current products
   - Consider products that would naturally complement their subscriptions
   - CRITICAL: Only recommend products with stock > 0
   - Continue browsing with pagination until you have EXACTLY 5 total recommendations
   - DO NOT STOP until you have 5 recommendations

Focus on:
- Products with "Complementary" relationships to what they already have
- Products with "Upgrade" relationships as the baby grows
- Products in the "Bundle" category for convenience
- Consider the customer's subscription history and patterns
- Recommend products that would add value to their current subscriptions
- MANDATORY: You must provide EXACTLY 5 recommendations with stock > 0

Return recommendations in JSON format with clear reasoning.`,
            },
            {
              name: 'llmUserPrompt',
              value: `Customer: {{currentCustomerName}} ({{currentCustomerEmail}})
Customer ID: {{currentCustomerId}}
Customer Status: {{currentCustomerStatus}}

Customer's Current Products (these are the products they already have subscriptions for):
{{steps.filter_customer_products.output.data|formatList("Product ID: {_id}\nName: {name}\nCategory: {category}\nPrice: €{price}/month\nDescription: {description}\nImage URL: {imageUrl}\nStock: {stock}\nStatus: {status}\nRelationships: {metadata.relationships}", "\n\n---\n\n")}}

Task:
Generate EXACTLY 5 product recommendations for this customer. This is MANDATORY - you must provide 5 recommendations.

	⚠️ CRITICAL: You MUST use the 'product_read' tool with operation = 'list' if relationships don't give you 5 products. Do NOT return fewer than 5 recommendations. Do NOT say you need to browse more - actually call the product_read tool and browse until you have 5 recommendations.

STEP 1 - PRIORITY: Use Relationship Metadata (PREFERRED)
1. Examine the relationships metadata in each of the customer's current products
2. Identify relationships with confidence > 0.5 (lowered threshold) and types: "Complementary", "Upgrade", or "Bundle"
	3. Use the 'product_read' tool with operation = 'get_by_id' to look up each related product by its productId
4. CRITICAL: Verify the product has stock > 0 (reject if stock is 0 or undefined)
5. Add these to your recommendations list

STEP 2 - MANDATORY FALLBACK: Browse All Products
	If you have fewer than 5 recommendations from relationships, you MUST immediately:
	1. Call 'product_read' tool with these parameters:
	   - operation: 'list'
   - fields: ['_id', 'name', 'description', 'price', 'currency', 'status', 'category', 'imageUrl', 'stock']
   - numItems: 100 (to get a good selection)
2. Review the returned products and identify ones with stock > 0 that complement the customer's subscriptions
	3. For each suitable product, call 'product_read' with operation = 'get_by_id' to get full details
4. Add products to your recommendations list until you have EXACTLY 5 total
	5. If the first page doesn't have enough products with stock > 0:
	   - Call 'product_read' again with operation = 'list' and the cursor from pagination.cursor
   - Continue until you have 5 recommendations
6. DO NOT STOP until you have exactly 5 recommendations with stock > 0

EXAMPLE WORKFLOW:
- Found 1 product from relationships → Need 4 more
	- Call product_read with operation = 'list' (no cursor, numItems: 100)
- Review products, find 3 with stock > 0 that fit
- Call product_get for each of those 3 products
- Add to recommendations (now have 4 total)
	- Still need 1 more → Call product_read again with operation = 'list' and cursor from previous response
- Find 1 more product with stock > 0
- Call product_get for it
- Add to recommendations (now have 5 total) → DONE

IMPORTANT RULES:
- YOU MUST PROVIDE EXACTLY 5 RECOMMENDATIONS - this is non-negotiable
- EVERY recommended product MUST have stock > 0 (this is critical)
- Relationship-based recommendations should ALWAYS be prioritized over browsed products
	- Use product_read tool with operation = 'get_by_id' to get full details before including any product in recommendations
	- When calling product_read with operation = 'get_by_id', include fields: ['_id', 'name', 'description', 'price', 'currency', 'status', 'category', 'imageUrl', 'stock']
	- Mandatory finalization: For EACH final recommendation, call product_read with operation = 'get_by_id' for that productId with the fields above and use the returned values in your JSON output. Do not skip this step.
- Do not limit fields to only 'metadata' in the final call; ensure 'imageUrl' is included.
- Do NOT recommend products the customer already has
- Ensure all recommended products are active and have stock > 0
	- Extract the imageUrl field from the product data returned by product_read tool (operation = 'get_by_id')
- Provide clear reasoning for each recommendation
	- If you cannot find 5 products with stock > 0, keep browsing with product_read (operation = 'list') until you do

CONFIDENCE SCORING RULES:
Calculate a confidence score (0.0 to 1.0) for each recommendation based on:
1. Source Quality:
   - Relationship metadata with confidence > 0.8: Use original confidence score (0.8-1.0)
   - Relationship metadata with confidence 0.6-0.8: Use original confidence score (0.6-0.8)
   - Relationship metadata with confidence 0.5-0.6: Use original confidence score (0.5-0.6)
   - Browsed products (from list_products): Start at 0.5 and adjust based on relevance
2. Relevance Factors (adjust ±0.1 each):
   - Same category as customer's products: +0.1
   - Price range similar to customer's products: +0.05
   - Complementary relationship type: +0.1
   - Upgrade relationship type: +0.05
3. Final Score:
   - Cap at 1.0 maximum
   - Minimum 0.3 for any recommendation
   - Each recommendation should have a UNIQUE confidence score reflecting its individual strength
   - DO NOT assign the same confidence score to multiple products unless they truly have identical relevance

Return JSON format:
{
  "recommendations": [
    {
      "productId": "CONVEX_PRODUCT_ID (use the _id field from product data)",
      "productName": "Product Name (use the name field from product data)",
      "imageUrl": "Image URL (use the imageUrl field from product data)",
      "relationshipType": "Complementary|Upgrade|Bundle|Substitute",
      "reasoning": "Clear explanation of why this product is recommended for this customer",
      "confidence": 0.87
    },
    {
      "productId": "ANOTHER_PRODUCT_ID",
      "productName": "Another Product Name",
      "imageUrl": "Another Image URL",
      "relationshipType": "Upgrade",
      "reasoning": "Different reasoning for this product",
      "confidence": 0.75
    }
  ],
  "summary": "Brief summary of recommendation strategy and sources used"
}

IMPORTANT: Each recommendation must have a thoughtfully calculated confidence score that reflects:
- The strength of the relationship or relevance
- How well it matches the customer's needs
- The source of the recommendation (relationship metadata vs browsed)
DO NOT use the same confidence score for all recommendations.`,
            },
          ],
        },
      },
      nextSteps: {
        success: 'generate_recommendations',
      },
    },

    // Step 9: AI Product Recommendation Generation for Current Customer
    {
      stepSlug: 'generate_recommendations',
      name: 'Generate AI Product Recommendations',
      stepType: 'llm',
      order: 9,
      config: {
        name: 'Product Recommendation Generator',
        temperature: 0.3,
        maxTokens: 100000,
        maxSteps: 30, // Allow up to 30 tool calls to browse products and gather recommendations
        outputFormat: 'json',
        tools: ['product_read'], // Unified product tool for looking up products
        systemPrompt: '{{llmSystemPrompt}}',
        userPrompt: '{{llmUserPrompt}}',
      },
      nextSteps: {
        success: 'hydrate_recommendations',
      },
    },

    // Step 10: Hydrate recommendation images and product names (guarantee imageUrl and productName)
    {
      stepSlug: 'hydrate_recommendations',
      name: 'Hydrate Recommendation Data',
      stepType: 'action',
      order: 10,
      config: {
        type: 'product',
        parameters: {
          operation: 'hydrate_fields',
          items:
            '{{steps.generate_recommendations.output.data.recommendations}}',
          idField: 'productId',
          mappings: {
            imageUrl: 'imageUrl',
            productName: 'name',
          },
          preserveExisting: true,
        },
      },
      nextSteps: {
        success: 'check_has_recommendations',
      },
    },

    // Step 10: Check if Customer Has Recommendations
    {
      stepSlug: 'check_has_recommendations',
      name: 'Check Has Recommendations',
      stepType: 'condition',
      order: 11,
      config: {
        expression:
          'steps.hydrate_recommendations.output.data|length > 0',
        description:
          'Check if AI generated any recommendations for this customer',
      },
      nextSteps: {
        true: 'create_approval',
        false: 'record_processed', // Skip this customer, record as processed
      },
    },

    // Step 11: Create Approval for Product Recommendations
    {
      stepSlug: 'create_approval',
      name: 'Create Approval for Product Recommendations',
      stepType: 'action',
      order: 12,
      config: {
        type: 'approval',
        parameters: {
          operation: 'create_approval',
          resourceType: 'product_recommendation',
          resourceId: '{{currentCustomerId}}',
          priority: 'medium',
          description:
            'AI-generated product recommendations for {{currentCustomerName}}',
          metadata: {
            customerId: '{{currentCustomerId}}',
            customerName: '{{currentCustomerName}}',
            customerEmail: '{{currentCustomerEmail}}',
            recommendedProducts:
              '{{steps.hydrate_recommendations.output.data}}',
            summary: '{{steps.generate_recommendations.output.data.summary}}',
            generatedAt: '{{now}}',
            workflowId: '{{rootWfDefinitionId}}',
          },
        },
      },
      nextSteps: {
        success: 'record_processed',
      },
    },

    // Step 12: Record Customer as Processed
    {
      stepSlug: 'record_processed',
      name: 'Record Customer as Processed',
      stepType: 'action',
      order: 13,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'record_processed',
          tableName: 'customers',
          recordId: '{{currentCustomerId}}',
          recordCreationTime: '{{currentCustomer._creationTime}}',
          metadata: {
            recommendationsGenerated:
              '{{steps.hydrate_recommendations.output.data|length}}',
            processedAt: '{{now}}',
            customerStatus: '{{currentCustomerStatus}}',
          },
        },
      },
      nextSteps: {
        success: 'noop',
      },
    },
  ],
};

export default loopiProductRecommendationWorkflow;
