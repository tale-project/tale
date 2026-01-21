const generalProductRecommendationWorkflow = {
  workflowConfig: {
    name: 'General Product Recommendation',
    description:
      'Generate AI-powered product recommendations for customers using their full customer record and product relationships',
    workflowType: 'predefined',
    version: '1.0.0',
    config: {
      timeout: 300000,
      retryPolicy: { maxRetries: 2, backoffMs: 3000 },
      variables: {
        organizationId: 'org_demo',
        workflowId: 'general-product-recommendation',
        backoffHours: 168,
      },
    },
  },
  stepsConfig: [
    {
      stepSlug: 'start',
      name: 'Start',
      stepType: 'trigger',
      order: 1,
      config: {
        type: 'manual',
      },
      nextSteps: { success: 'find_unprocessed_customer' },
    },
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
      nextSteps: { success: 'check_has_customer' },
    },
    {
      stepSlug: 'check_has_customer',
      name: 'Check if Customer Found',
      stepType: 'condition',
      order: 3,
      config: {
        expression: 'steps.find_unprocessed_customer.output.data != null',
        description: 'Check if we found an unprocessed customer',
      },
      nextSteps: { true: 'extract_customer_data', false: 'noop' },
    },
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
          ],
        },
      },
      nextSteps: { success: 'compose_prompts' },
    },
    {
      stepSlug: 'compose_prompts',
      name: 'Compose LLM Prompts',
      stepType: 'action',
      order: 5,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'llmSystemPrompt',
              value: `You are a general product recommendation engine for this business.

You receive the full customer record (all fields and metadata) and should propose products that are relevant, valuable, and timely for this customer.

You can call tools to look up products and product details. Prefer using existing product relationship metadata when available, but you may also browse the catalog.

CRITICAL BUSINESS RULE:
- You must ONLY recommend products that are currently active and have available stock strictly greater than 0.
- Never recommend products that are inactive, archived, or have stock less than or equal to 0.
- Use tools as needed to verify that a product is active and in stock before including it in the recommendations.

If tools are available, call them as needed to look up products or search the knowledge base.`,
            },
            {
              name: 'llmUserPrompt',
              value: `Customer record (full JSON):
	            {{currentCustomer}}
	            
	            	    Task: Recommend up to 5 products that this customer is most likely to benefit from next.

	            	    You must ONLY recommend products that are active and have stock greater than 0 (strictly positive). Do not recommend any products that are inactive, archived, or out of stock.

	            	    Use any available product relationship metadata (for example on products they are linked to) when relevant, and you may also browse the product catalog and RAG knowledge base.`,
            },
          ],
        },
      },
      nextSteps: { success: 'generate_recommendations' },
    },
    {
      stepSlug: 'generate_recommendations',
      name: 'Generate AI Product Recommendations',
      stepType: 'llm',
      order: 6,
      config: {
        name: 'Product Recommendation Generator',
        outputFormat: 'json',
        outputSchema: {
          type: 'object',
          description: 'AI-generated product recommendations for a customer',
          properties: {
            recommendations: {
              type: 'array',
              description: 'List of recommended products (up to 5)',
              items: {
                type: 'object',
                properties: {
                  productId: {
                    type: 'string',
                    description: 'The unique product identifier from the database',
                  },
                  productName: {
                    type: 'string',
                    description: 'Name of the product',
                  },
                  price: {
                    type: 'number',
                    description: 'Product price',
                  },
                  imageUrl: {
                    type: 'string',
                    description: 'URL of the product image',
                  },
                  reason: {
                    type: 'string',
                    description: 'Why this product is recommended for the customer',
                  },
                  confidence: {
                    type: 'number',
                    description: 'Confidence score for this recommendation (0-1)',
                  },
                },
                required: ['productId', 'productName', 'reason', 'confidence'],
              },
            },
            summary: {
              type: 'string',
              description: 'Short summary of the overall recommendation strategy',
            },
          },
          required: ['recommendations', 'summary'],
        },
        tools: ['product_read'],
        systemPrompt: '{{llmSystemPrompt}}',
        userPrompt: '{{llmUserPrompt}}',
      },
      nextSteps: { success: 'hydrate_recommendations' },
    },
    {
      stepSlug: 'hydrate_recommendations',
      name: 'Hydrate Recommendation Data',
      stepType: 'action',
      order: 7,
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
      nextSteps: { success: 'check_has_recommendations' },
    },
    {
      stepSlug: 'check_has_recommendations',
      name: 'Check Has Recommendations',
      stepType: 'condition',
      order: 8,
      config: {
        expression:
          'steps.hydrate_recommendations.output.data|length > 0',
        description:
          'Check if AI generated any recommendations for this customer',
      },
      nextSteps: { true: 'create_approval', false: 'record_processed' },
    },
    {
      stepSlug: 'create_approval',
      name: 'Create Approval for Product Recommendations',
      stepType: 'action',
      order: 9,
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
      nextSteps: { success: 'record_processed' },
    },
    {
      stepSlug: 'record_processed',
      name: 'Record Customer as Processed',
      stepType: 'action',
      order: 10,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'record_processed',
          tableName: 'customers',
          recordId: '{{currentCustomerId}}',
          metadata: {
            recommendationsGenerated:
              '{{steps.hydrate_recommendations.output.data|length}}',
            processedAt: '{{now}}',
            customerStatus: '{{currentCustomerStatus}}',
          },
        },
      },
      nextSteps: { success: 'noop' },
    },
  ],
};

export default generalProductRecommendationWorkflow;
