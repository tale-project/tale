/**
 * Conversation Auto-Reply Workflow
 *
 * This workflow automatically finds one open conversation, checks if it needs a reply,
 * generates an AI-powered reply in markdown format using the organization's tone of voice,
 * and creates an approval record.
 *
 * High-level flow:
 * 1) Query for one open conversation
 * 2) Query the organization's tone of voice
 * 3) Use LLM to check if the conversation needs a reply AND classify conversation type
 * 4) Update conversation type if needed (only if type is missing or "general")
 * 5) If reply needed, use LLM to generate a reply in markdown format following the brand tone
 * 6) Create an approval record for the generated reply
 *
 * Key features:
 * - AI-powered reply detection and generation
 * - Intelligent conversation type classification
 * - Brand tone of voice integration
 * - Markdown-formatted responses
 * - Approval workflow for human review
 * - Processes one conversation per execution
 */

export const conversationAutoReplyWorkflow = {
  workflowConfig: {
    name: 'Conversation Auto-Reply',
    description:
      'Automatically find one unprocessed open conversation, check if it needs a reply, generate AI-powered response in markdown format, and create approval record',
    workflowType: 'predefined',
    version: '1.0.0',
    config: {
      timeout: 120000, // 2 minutes timeout for single conversation
      retryPolicy: { maxRetries: 2, backoffMs: 3000 },
      variables: {
        organizationId: 'org_demo',
        workflowId: 'conversationAutoReply',
        backoffHours: 168, // Only process conversations not processed in last 168 hours (7 days)
      },
    },
  },
  stepsConfig: [
    // Step 1: Trigger - Manual or Scheduled
    {
      stepSlug: 'start',
      name: 'Start',
      stepType: 'trigger',
      order: 1,
      config: {
        type: 'manual', // Can be changed to 'schedule' for automated processing
        // For scheduled processing, uncomment below:
        // schedule: '0 */2 * * *', // Every 2 hours
        // timezone: 'UTC',
      },
      nextSteps: { success: 'find_unprocessed_conversation' },
    },

    // Step 2: Find Unprocessed Open Conversation
    // Uses filterExpression with smart index selection
    {
      stepSlug: 'find_unprocessed_conversation',
      name: 'Find Unprocessed Open Conversation',
      stepType: 'action',
      order: 2,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'find_unprocessed',
          tableName: 'conversations',
          backoffHours: '{{backoffHours}}',
          filterExpression: 'status == "open"',
        },
      },
      nextSteps: {
        success: 'check_has_conversation',
      },
    },

    // Step 3: Check if We Have a Conversation to Process
    {
      stepSlug: 'check_has_conversation',
      name: 'Check Has Conversation',
      stepType: 'condition',
      order: 3,
      config: {
        expression: 'steps.find_unprocessed_conversation.output.data != null',
        description: 'Check if an unprocessed open conversation was found',
      },
      nextSteps: {
        true: 'extract_conversation_data',
        false: 'noop',
      },
    },

    // Step 4: Extract Conversation Data
    {
      stepSlug: 'extract_conversation_data',
      name: 'Extract Conversation Data',
      stepType: 'action',
      order: 4,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'currentConversationId',
              value:
                '{{steps.find_unprocessed_conversation.output.data._id}}',
            },
            {
              name: 'currentConversationSubject',
              value:
                '{{steps.find_unprocessed_conversation.output.data.subject}}',
            },
            {
              name: 'currentConversationCustomerId',
              value:
                '{{steps.find_unprocessed_conversation.output.data.customerId}}',
            },
            {
              name: 'currentConversationCreationTime',
              value:
                '{{steps.find_unprocessed_conversation.output.data._creationTime}}',
            },
            {
              name: 'currentConversationType',
              value:
                '{{steps.find_unprocessed_conversation.output.data.type}}',
            },
          ],
        },
      },
      nextSteps: {
        success: 'query_conversation_messages',
      },
    },

    // Step 5: Query Messages for Current Conversation
    {
      stepSlug: 'query_conversation_messages',
      name: 'Query Conversation Messages',
      stepType: 'action',
      order: 5,
      config: {
        type: 'conversation',
        parameters: {
          operation: 'query_messages',
          conversationId: '{{currentConversationId}}',
          paginationOpts: {
            numItems: 50,
            cursor: null,
          },
        },
      },
      nextSteps: {
        success: 'query_tone_of_voice',
      },
    },

    // Step 6: Query Tone of Voice
    {
      stepSlug: 'query_tone_of_voice',
      name: 'Query Tone of Voice',
      stepType: 'action',
      order: 6,
      config: {
        type: 'tone_of_voice',
        parameters: {
          operation: 'get_tone_of_voice',
        },
      },
      nextSteps: {
        success: 'check_needs_reply',
      },
    },

    // Step 7: LLM Check if Reply is Needed AND Classify Conversation Type
    {
      stepSlug: 'check_needs_reply',
      name: 'Check if Reply is Needed and Classify Type',
      stepType: 'llm',
      order: 7,
      config: {
        name: 'Reply Necessity Checker and Type Classifier',
        temperature: 0.2,
        maxTokens: 500,
        outputFormat: 'json',
        outputSchema: {
          type: 'object',
          properties: {
            needs_reply: {
              type: 'boolean',
              description: 'Whether the conversation needs a reply from support',
            },
            reason: {
              type: 'string',
              description:
                'Brief explanation of why a reply is or is not needed',
            },
            urgency: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
              description: 'Urgency level of the response',
            },
            conversation_type: {
              type: 'string',
              enum: [
                'product_recommendation',
                'churn_survey',
                'service_request',
                'general',
                'spam',
              ],
              description: 'Classification of the conversation type',
            },
            type_confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description: 'Confidence level in the type classification (0-1)',
            },
            type_reasoning: {
              type: 'string',
              description:
                'Brief explanation of the conversation type classification',
            },
            should_update_type: {
              type: 'boolean',
              description:
                'Whether the conversation type should be updated (only if current type is missing, empty, or "general")',
            },
          },
          required: [
            'needs_reply',
            'reason',
            'urgency',
            'conversation_type',
            'type_confidence',
            'type_reasoning',
            'should_update_type',
          ],
          additionalProperties: false,
        },
        systemPrompt: `You are an expert customer service assistant. Analyze the conversation to:
1. Determine if a reply is needed
2. Classify the conversation type

REPLY NECESSITY:
A reply is needed if:
- The last message is from a customer (inbound)
- The customer is asking a question or requesting help
- The conversation requires follow-up or acknowledgment
- There's an unresolved issue or concern

A reply is NOT needed if:
- The last message is from an agent (outbound)
- The conversation is already resolved
- The customer's message is just an acknowledgment (e.g., "Thanks!", "Got it")
- The conversation is spam

CONVERSATION TYPE CLASSIFICATION:
Available types:
- "product_recommendation": Customer is asking about products, looking for recommendations, or interested in purchasing
- "churn_survey": Customer is canceling, expressing dissatisfaction, or considering leaving
- "service_request": Customer needs help with an existing product/service, has a technical issue, or needs support
- "general": General inquiries, questions about the company, or unclear intent
- "spam": Spam, promotional content, or irrelevant messages

Return your analysis in JSON format.`,
        userPrompt: `Conversation Subject: {{currentConversationSubject}}

Current Conversation Type: {{currentConversationType}}

Recent Messages:
{{steps.query_conversation_messages.output.data.page|formatList("Direction: {direction}\nContent: {content}\nSent At: {sentAt}", "\n\n---\n\n")}}

Task:
1. Determine if this conversation needs a reply from the support team
2. Classify the conversation type (only update if current type is missing, empty, or "general")

Return JSON format:
{
  "needs_reply": true/false,
  "reason": "Brief explanation of why a reply is or isn't needed",
  "urgency": "low|medium|high",
  "conversation_type": "product_recommendation|churn_survey|service_request|general|spam",
  "type_confidence": 0.0-1.0,
  "type_reasoning": "Brief explanation of the conversation type classification",
  "should_update_type": true/false
}

Note: Set should_update_type to true only if the current type is missing, empty, or set to "general"`,
      },
      nextSteps: {
        success: 'check_should_update_type',
      },
    },

    // Step 8: Check if We Should Update Conversation Type
    {
      stepSlug: 'check_should_update_type',
      name: 'Check Should Update Type',
      stepType: 'condition',
      order: 8,
      config: {
        expression:
          'steps.check_needs_reply.output.data.should_update_type == true',
        description:
          'Check if AI determined that conversation type should be updated',
      },
      nextSteps: {
        true: 'update_conversation_type',
        false: 'evaluate_needs_reply',
      },
    },

    // Step 9: Update Conversation Type
    {
      stepSlug: 'update_conversation_type',
      name: 'Update Conversation Type',
      stepType: 'action',
      order: 9,
      config: {
        type: 'conversation',
        parameters: {
          operation: 'update',
          conversationId: '{{currentConversationId}}',
          updates: {
            type: '{{steps.check_needs_reply.output.data.conversation_type}}',
          },
        },
      },
      nextSteps: {
        success: 'evaluate_needs_reply',
      },
    },

    // Step 10: Evaluate if Reply is Needed
    {
      stepSlug: 'evaluate_needs_reply',
      name: 'Evaluate Needs Reply',
      stepType: 'condition',
      order: 10,
      config: {
        expression: 'steps.check_needs_reply.output.data.needs_reply == true',
        description: 'Check if LLM determined that a reply is needed',
      },
      nextSteps: {
        true: 'generate_reply',
        false: 'record_processed',
      },
    },

    // Step 11: LLM Generate Reply in Markdown
    {
      stepSlug: 'generate_reply',
      name: 'Generate Reply',
      stepType: 'llm',
      order: 11,
      config: {
        name: 'Reply Generator',
        temperature: 0.7,
        maxTokens: 20000,
        outputFormat: 'text',
        tools: [
          'customer_search',
          'list_customers',
          'product_get',
          'list_products',
        ],
        systemPrompt: `You are John, a friendly and helpful customer service representative. Write natural, conversational replies that are warm, helpful, and genuinely human.

YOUR IDENTITY:
- Your name is John
- You're a real person on the support team, not a bot
- Write as yourself - use "I" when referring to your actions
- Sign your messages with your name: "John" or "Best, John" or similar natural sign-offs

TONE OF VOICE:
{{ steps.query_tone_of_voice.output.data.generatedTone ? 'Follow this brand tone of voice:' : 'Write in a friendly, professional tone. Be warm, helpful, and conversational.' }}

{{ steps.query_tone_of_voice.output.data.generatedTone || '' }}

Writing Style - Be Human:
- Write like you're having a real conversation, not reading from a script
- Use natural language and contractions (I'm, you're, we'll, etc.)
- Show genuine empathy and personality
- Vary your sentence structure - mix short and long sentences
- Use casual but professional language (avoid corporate jargon)
- Add personal touches like "Happy to help!" or "Great question!"
- Don't be overly formal - be warm and approachable
- Avoid robotic phrases like "I apologize for any inconvenience" - say "Sorry about that!" instead
- Use emojis sparingly and naturally if appropriate for the context

Guidelines:
- Address the customer by name if you know it
- Acknowledge their feelings and concerns genuinely
- Provide clear, helpful information without sounding like a manual
- Be conversational but stay on topic
- End naturally - like you would in a real conversation
- ALWAYS sign off with your name (John) at the end - this is important for personalization

Available Tools - USE THEM PROACTIVELY:
- customer_search: Look up customer details by email or customer ID
- list_customers: Browse and search through customer records
- product_get: Look up product details by product ID (supports 'fields' selection)
- list_products: Browse and search through product catalog

WHEN TO USE TOOLS:
You MUST use these tools proactively when:
- The customer asks about products (e.g., "What products do you have?", "Tell me about X product", "Do you have Y?")
- The customer asks about pricing, availability, or product specifications
- The customer asks about their account, order history, or personal information
- The customer mentions a product name or asks for product recommendations
- You need to verify customer information or account details
- The customer asks "What can I buy?" or similar questions about your offerings

IMPORTANT: Don't just acknowledge the request - actually USE the tools to fetch real data and provide specific information. For example:
- If asked "What products do you have?", use list_products to show actual products
- If asked "What's my account info?", use customer_search with their customer ID to fetch their details
- If asked about a specific product, use product_get to get accurate details

CRITICAL - DO NOT SHOW PRICES:
- NEVER mention or display product prices in your responses
- If a customer asks about pricing, politely let them know you'll have someone contact them with pricing details
- Focus on product features, availability, and benefits instead
- You can mention everything else about products (name, description, features, availability) - just not prices

Format your response naturally:
- Use markdown sparingly - only when it genuinely helps readability
- Use **bold** for key points, not everything
- Use lists when showing multiple items (products, features, etc.)
- Keep formatting minimal and natural - don't over-format
- Write in paragraphs like a real email or message
- Sign off naturally at the end

Remember: Write like a real person having a genuine conversation. Customers want to feel like they're talking to a human, not a bot. Fetch real data using the tools and present it in a friendly, conversational way.`,
        userPrompt: `You are John, responding to this customer conversation.

Conversation Subject: {{currentConversationSubject}}

Customer ID: {{currentConversationCustomerId}}

Recent Messages:
{{steps.query_conversation_messages.output.data.page|formatList("Direction: {direction}\nContent: {content}\nSent At: {sentAt}", "\n\n---\n\n")}}

Reply Analysis:
Reason: {{steps.check_needs_reply.output.data.reason}}
Urgency: {{steps.check_needs_reply.output.data.urgency}}

Task: As John, generate a warm and professional reply in markdown format that addresses the customer's needs. Use the available tools to look up customer or product information if needed. Remember to sign your message with your name at the end.`,
      },
      nextSteps: {
        success: 'create_approval',
      },
    },

    // Step 12: Create Approval Record
    {
      stepSlug: 'create_approval',
      name: 'Create Approval Record',
      stepType: 'action',
      order: 12,
      config: {
        type: 'approval',
        parameters: {
          operation: 'create_approval',
          resourceType: 'conversations',
          resourceId: '{{currentConversationId}}',
          priority: '{{steps.check_needs_reply.output.data.urgency}}',
          description:
            'Review and approve the AI-generated reply for conversation: {{currentConversationSubject}}',
          metadata: {
            emailBody: '{{steps.generate_reply.output.data}}',
            customerId: '{{currentConversationCustomerId}}',
          },
        },
      },
      nextSteps: {
        success: 'record_processed',
      },
    },

    // Step 13: Record Conversation as Processed
    {
      stepSlug: 'record_processed',
      name: 'Record Conversation as Processed',
      stepType: 'action',
      order: 13,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'record_processed',
          tableName: 'conversations',
          recordId: '{{currentConversationId}}',
          metadata: {
            needsReply: '{{steps.check_needs_reply.output.data.needs_reply}}',
            urgency: '{{steps.check_needs_reply.output.data.urgency}}',
            reason: '{{steps.check_needs_reply.output.data.reason}}',
            conversationType:
              '{{steps.check_needs_reply.output.data.conversation_type}}',
            typeConfidence:
              '{{steps.check_needs_reply.output.data.type_confidence}}',
            typeReasoning:
              '{{steps.check_needs_reply.output.data.type_reasoning}}',
            typeUpdated:
              '{{steps.check_needs_reply.output.data.should_update_type}}',
          },
        },
      },
      nextSteps: {
        success: 'noop',
      },
    },
  ],
};

export default conversationAutoReplyWorkflow;
