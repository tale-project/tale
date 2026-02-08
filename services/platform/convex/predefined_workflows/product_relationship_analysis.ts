/**
 * Product Relationship Analysis Workflow
 *
 * This workflow analyzes product relationships based on customer subscription data:
 * 1. Find one unprocessed product using workflow_processing_records
 * 2. Extract all shop_variant_id from the product's metadata.circuly.variants
 * 3. Find all customers whose subscriptions contain any of those shop_variant_ids
 * 4. Extract all product_ids from those customers' subscriptions
 * 5. Find all products whose metadata.circuly.variants contain any of those product_ids
 * 6. Use AI to analyze relationships between the original product and related products
 * 7. Update all products with relationship metadata (bidirectional for Complementary, Substitute, Bundle)
 *
 * Product relationship types:
 * - Complementary: Products that work well together (e.g., phone + phone case) [BIDIRECTIONAL]
 * - Substitute: Alternative products serving similar needs (e.g., different brands of same product type) [BIDIRECTIONAL]
 * - Bundle: Products typically sold together as a package [BIDIRECTIONAL]
 * - Upgrade: Products representing different tiers/versions [UNIDIRECTIONAL: lower → higher]
 *
 * Bidirectional relationships are automatically created in both directions:
 * - If Product A has a Complementary relationship with Product B,
 *   then Product B will also have a Complementary relationship with Product A
 * - Products with no meaningful relationship are not stored in the metadata
 */

const productRelationshipAnalysisWorkflow = {
  workflowConfig: {
    name: 'Product Relationship Analysis',
    description:
      'Analyze product relationships based on customer subscription patterns using AI',
    version: '2.0.0',
    workflowType: 'predefined',
    config: {
      timeout: 1800000, // 30 minutes for full analysis
      retryPolicy: { maxRetries: 2, backoffMs: 5000 },
      variables: {
        organizationId: 'org_demo',
        workflowId: 'product-relationship-analysis',
        backoffHours: 168, // Process each product once per week (7 days * 24 hours)
        analysisVersion: '2.0',
      },
    },
  },
  stepsConfig: [
    // Step 1: Trigger - Manual or Scheduled
    {
      stepSlug: 'start',
      name: 'start',
      stepType: 'start',
      order: 1,
      config: {},
      nextSteps: { success: 'find_unprocessed_product' },
    },

    // Step 2: Find One Unprocessed Product
    {
      stepSlug: 'find_unprocessed_product',
      name: 'Find One Unprocessed Product',
      stepType: 'action',
      order: 2,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'find_unprocessed',
          tableName: 'products',
          backoffHours: '{{backoffHours}}',
        },
      },
      nextSteps: {
        success: 'check_has_product',
      },
    },

    // Step 3: Check if Product Found
    {
      stepSlug: 'check_has_product',
      name: 'Check if Product Found',
      stepType: 'condition',
      order: 3,
      config: {
        expression: 'steps.find_unprocessed_product.output.data != null',
        description: 'Check if we found an unprocessed product',
      },
      nextSteps: {
        true: 'extract_product_data',
        false: 'noop',
      },
    },

    // Step 4: Extract Product Data and Shop Variant IDs
    {
      stepSlug: 'extract_product_data',
      name: 'Extract Product Data and Shop Variant IDs',
      stepType: 'action',
      order: 4,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'sourceProduct',
              value:
                '{{steps.find_unprocessed_product.output.data}}',
            },
            {
              name: 'sourceProductId',
              value:
                '{{steps.find_unprocessed_product.output.data._id}}',
            },
            {
              name: 'sourceProductName',
              value:
                '{{steps.find_unprocessed_product.output.data.name}}',
            },
            {
              name: 'shopVariantIds',
              value: `{{steps.find_unprocessed_product.output.data.metadata.circuly.variants|map('shop_variant_id')|unique}}`,
            },
            {
              name: 'analysisTimestamp',
              value: '{{now}}',
            },
          ],
        },
      },
      nextSteps: {
        success: 'filter_customers_by_subscriptions',
      },
    },

    // Step 5: Filter Customers with Matching Subscriptions
    {
      stepSlug: 'filter_customers_by_subscriptions',
      name: 'Filter Customers with Matching Subscriptions',
      stepType: 'action',
      order: 5,
      config: {
        type: 'customer',
        parameters: {
          operation: 'filter',
          // The {{shopVariantIds}} will be replaced with the actual array value by replaceVariables
          // Use ternary to ensure boolean return: if conditions met, check overlap; otherwise false
          expression: `(metadata && metadata.subscriptions && metadata.subscriptions.data) ? metadata.subscriptions.data|map('product_id')|hasOverlap({{shopVariantIds}}) : false`,
        },
      },
      nextSteps: {
        success: 'check_has_customers',
      },
    },

    // Step 6: Check if Customers Found
    {
      stepSlug: 'check_has_customers',
      name: 'Check if Customers Found',
      stepType: 'condition',
      order: 6,
      config: {
        expression:
          'steps.filter_customers_by_subscriptions.output.data|length > 0',
        description:
          'Check if we found any customers with matching subscriptions',
      },
      nextSteps: {
        true: 'extract_customer_product_ids',
        false: 'record_processed',
      },
    },

    // Step 7: Extract All Product IDs from Customer Subscriptions
    {
      stepSlug: 'extract_customer_product_ids',
      name: 'Extract All Product IDs from Customer Subscriptions',
      stepType: 'action',
      order: 7,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'customerProductIds',
              value: `{{steps.filter_customers_by_subscriptions.output.data|map('metadata.subscriptions.data')|flatten|map('product_id')|unique}}`,
            },
          ],
        },
      },
      nextSteps: {
        success: 'filter_related_products',
      },
    },

    // Step 8: Filter Products with Overlapping Variant IDs
    {
      stepSlug: 'filter_related_products',
      name: 'Filter Products with Overlapping Variant IDs',
      stepType: 'action',
      order: 8,
      config: {
        type: 'product',
        parameters: {
          operation: 'filter',
          // The {{customerProductIds}} will be replaced with the actual array value by replaceVariables
          // Use ternary to ensure boolean return: if conditions met, check overlap; otherwise false
          expression: `(metadata && metadata.circuly && metadata.circuly.variants) ? metadata.circuly.variants|map('shop_variant_id')|hasOverlap({{customerProductIds}}) : false`,
        },
      },
      nextSteps: {
        success: 'prepare_ai_analysis',
      },
    },

    // Step 9: Prepare AI Analysis Prompt
    {
      stepSlug: 'prepare_ai_analysis',
      name: 'Prepare AI Analysis Prompt',
      stepType: 'action',
      order: 9,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'allProducts',
              value: `{{[sourceProduct]|concat(steps.filter_related_products.output.data)}}`,
            },
            {
              name: 'productList',
              value: `{{allProducts|formatList("Product ID: {_id}\nName: {name}\nCategory: {category}\nPrice: €{price}/month\nDescription: {description}\nShop Variant IDs: {metadata.circuly.variants|map('shop_variant_id')|join(', ')}", "\n\n---\n\n")}}`,
            },
            {
              name: 'aiPrompt',
              value: `TASK: Analyze the relationships between products based on customer subscription patterns.

SOURCE PRODUCT (the product we're analyzing):
Product ID: {{sourceProductId}}
Name: {{sourceProductName}}

RELATED PRODUCTS (products that customers subscribe to alongside the source product):

{{productList}}

---

CONTEXT: These products are related because customers who subscribe to the source product also subscribe to these related products. We want to understand the nature of these relationships.

INSTRUCTIONS:
1. Analyze the relationship between the SOURCE PRODUCT and EACH related product
2. Classify relationships as:
   - Complementary: Products that work well together (e.g., stroller + car seat)
   - Substitute: Alternative products serving similar needs (e.g., different stroller models)
   - Bundle: Products typically sold together as a package
   - Upgrade: Products representing different tiers/versions (e.g., basic vs premium)
3. ONLY include products that have a meaningful relationship (Complementary, Substitute, Bundle, or Upgrade)
4. DO NOT include products with "None" relationship type - simply omit them from the results

5. Return results in JSON format:
{
  "relationships": [
    {
      "source_product_id": "SOURCE_PRODUCT_ID",
      "target_product_id": "RELATED_PRODUCT_ID",
      "relationship_type": "Complementary|Substitute|Bundle|Upgrade",
      "confidence": 0.8,
      "reasoning": "Brief explanation of why these products are related"
    }
  ]
}

IMPORTANT:
- Use the exact Product ID values from the list above (they start with "j" or "k"). These are Convex document IDs.
- Only create relationships between the SOURCE PRODUCT ({{sourceProductId}}) and the related products.
- Do NOT create relationships between related products themselves.
- source_product_id should always be {{sourceProductId}}
- target_product_id should be the ID of each related product

BIDIRECTIONAL RELATIONSHIPS:
- For Complementary, Substitute, and Bundle relationships, you MUST create BOTH directions:
  * One relationship from SOURCE to TARGET
  * One relationship from TARGET to SOURCE (with source and target swapped)
- For Upgrade relationships, only create ONE direction (from lower tier to higher tier)
- For None relationships, DO NOT create any relationship entry at all (skip it entirely)
- Example for Complementary relationship between Product A and Product B:
  [
    {
      "source_product_id": "A",
      "target_product_id": "B",
      "relationship_type": "Complementary",
      "confidence": 0.8,
      "reasoning": "Product A works well with Product B"
    },
    {
      "source_product_id": "B",
      "target_product_id": "A",
      "relationship_type": "Complementary",
      "confidence": 0.8,
      "reasoning": "Product B works well with Product A"
    }
  ]`,
            },
          ],
        },
      },
      nextSteps: {
        success: 'analyze_product_relationships',
      },
    },

    // Step 10: AI Product Relationship Analysis
    {
      stepSlug: 'analyze_product_relationships',
      name: 'AI Analyze Product Relationships',
      stepType: 'llm',
      order: 10,
      config: {
        name: 'Product Relationship Analyzer',
        userPrompt: '{{aiPrompt}}',
        systemPrompt:
          'You are an expert product analyst specializing in subscription-based product relationships. Analyze product relationships based on actual customer subscription patterns. Always return valid JSON format as specified. Focus on practical business relationships that would be useful for recommendations and cross-selling. CRITICAL: For Complementary, Substitute, and Bundle relationships, you MUST create bidirectional relationships (both A→B and B→A). For Upgrade relationships, only create unidirectional relationships (lower→higher tier). DO NOT include products with no meaningful relationship - simply omit them from the results.',
        outputFormat: 'json',
        outputSchema: {
          type: 'object',
          properties: {
            relationships: {
              type: 'array',
              description:
                'List of product relationships (empty array if no meaningful relationships)',
              items: {
                type: 'object',
                properties: {
                  source_product_id: {
                    type: 'string',
                    description: 'Convex ID of the source product',
                  },
                  target_product_id: {
                    type: 'string',
                    description: 'Convex ID of the target product',
                  },
                  relationship_type: {
                    type: 'string',
                    enum: ['Complementary', 'Substitute', 'Bundle', 'Upgrade'],
                    description: 'Type of relationship between products',
                  },
                  confidence: {
                    type: 'number',
                    minimum: 0,
                    maximum: 1,
                    description: 'Confidence score for the relationship',
                  },
                  reasoning: {
                    type: 'string',
                    description:
                      'Brief explanation of why these products are related',
                  },
                },
                required: [
                  'source_product_id',
                  'target_product_id',
                  'relationship_type',
                  'confidence',
                  'reasoning',
                ],
                additionalProperties: false,
              },
            },
          },
          required: ['relationships'],
          additionalProperties: false,
        },
      },
      nextSteps: {
        success: 'check_has_relationships',
      },
    },

    // Step 11: Check if Relationships Found
    {
      stepSlug: 'check_has_relationships',
      name: 'Check if Relationships Found',
      stepType: 'condition',
      order: 11,
      config: {
        expression:
          'steps.analyze_product_relationships.output.data.relationships|length > 0',
        description: 'Check if AI found any relationships',
      },
      nextSteps: {
        true: 'loop_relationships',
        false: 'record_processed',
      },
    },

    // Step 12: Loop Through Relationships
    {
      stepSlug: 'loop_relationships',
      name: 'Loop Through Relationships',
      stepType: 'loop',
      order: 12,
      config: {
        items:
          '{{steps.analyze_product_relationships.output.data.relationships}}',
        itemVariable: 'item',
      },
      nextSteps: {
        loop: 'query_product_for_update',
        done: 'record_processed',
      },
    },

    // Step 13: Query Product to Get Current Metadata
    {
      stepSlug: 'query_product_for_update',
      name: 'Query Product for Update',
      stepType: 'action',
      order: 13,
      config: {
        type: 'product',
        parameters: {
          operation: 'get_by_id',
          productId: '{{loop.item.source_product_id}}',
        },
      },
      nextSteps: {
        success: 'check_relationship_exists',
      },
    },

    // Step 14: Check if Relationship Already Exists
    {
      stepSlug: 'check_relationship_exists',
      name: 'Check if Relationship Already Exists',
      stepType: 'condition',
      order: 14,
      config: {
        expression: `(steps.query_product_for_update.output.data && steps.query_product_for_update.output.data.metadata && steps.query_product_for_update.output.data.metadata.relationships) ? (steps.query_product_for_update.output.data.metadata.relationships|find('productId', loop.item.target_product_id) != null) : false`,
        description:
          'Check if relationship with target product already exists in metadata',
      },
      nextSteps: {
        true: 'loop_relationships',
        false: 'prepare_updated_relationships',
      },
    },

    // Step 15: Prepare Updated Relationships Array
    {
      stepSlug: 'prepare_updated_relationships',
      name: 'Prepare Updated Relationships Array',
      stepType: 'action',
      order: 15,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'existingRelationships',
              value: `{{(steps.query_product_for_update.output.data && steps.query_product_for_update.output.data.metadata && steps.query_product_for_update.output.data.metadata.relationships) ? steps.query_product_for_update.output.data.metadata.relationships : []}}`,
            },
            {
              name: 'newRelationship',
              value: {
                productId: '{{loop.item.target_product_id}}',
                productName:
                  '{{allProducts|find("_id", loop.item.target_product_id).name}}',
                relationship_type: '{{loop.item.relationship_type}}',
                confidence: '{{loop.item.confidence}}',
                reasoning: '{{loop.item.reasoning}}',
              },
            },
            {
              name: 'updatedRelationships',
              value: `{{existingRelationships|concat([newRelationship])}}`,
            },
          ],
        },
      },
      nextSteps: {
        success: 'update_product_metadata',
      },
    },

    // Step 16: Update Product Metadata with New Relationship
    {
      stepSlug: 'update_product_metadata',
      name: 'Update Product Metadata',
      stepType: 'action',
      order: 16,
      config: {
        type: 'product',
        parameters: {
          operation: 'update',
          productId: '{{loop.item.source_product_id}}',
          updates: {
            metadata: {
              relationships: '{{updatedRelationships}}',
            },
          },
        },
      },
      nextSteps: {
        success: 'loop_relationships',
      },
    },

    // Step 17: Record Product as Processed
    {
      stepSlug: 'record_processed',
      name: 'Record Product as Processed',
      stepType: 'action',
      order: 17,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'record_processed',
          tableName: 'products',
          recordId: '{{sourceProductId}}',
          metadata: {
            relationshipsFound:
              '{{steps.analyze_product_relationships.output.data.relationships|length}}',
            analyzedAt: '{{analysisTimestamp}}',
          },
        },
      },
      nextSteps: {
        success: 'noop',
      },
    },
  ],
};

export default productRelationshipAnalysisWorkflow;
