/**
 * Conversation Auto-Reply Workflow
 *
 * This workflow automatically finds one unprocessed inbound message, checks if it needs a reply,
 * generates an AI-powered reply in markdown format using the organization's tone of voice,
 * and creates an approval record.
 *
 * High-level flow:
 * 1) Query for one unprocessed inbound conversation message
 * 2) Check if this message is the latest inbound message in its conversation
 * 3) If not latest, skip and mark as processed
 * 4) Query the organization's tone of voice
 * 5) Use LLM to check if the conversation needs a reply AND classify conversation type
 * 6) Update conversation type if needed (only if type is missing or "general")
 * 7) If reply needed, use LLM to generate a reply in markdown format following the brand tone
 * 8) Create an approval record for the generated reply
 * 9) Record the message as processed
 *
 * Key features:
 * - Tracks at message level (not conversation level) for real-time response
 * - AI-powered reply detection and generation
 * - Intelligent conversation type classification
 * - Brand tone of voice integration
 * - Markdown-formatted responses
 * - Approval workflow for human review
 * - Processes one message per execution
 */

const conversationAutoReplyWorkflow = {
  workflowConfig: {
    name: 'Conversation Auto-Reply',
    description:
      'Automatically find one unprocessed inbound message, check if it needs a reply, generate AI-powered response in markdown format, and create approval record',
    workflowType: 'predefined',
    version: '2.0.0',
    config: {
      timeout: 120000, // 2 minutes timeout for single message
      retryPolicy: { maxRetries: 2, backoffMs: 3000 },
      variables: {
        organizationId: 'org_demo',
        workflowId: 'conversationAutoReply',
        backoffHours: -1, // BACKOFF_NEVER_REPROCESS - each message processed once
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
      nextSteps: { success: 'find_unprocessed_inbound_message' },
    },

    // Step 2: Find Unprocessed Inbound Message
    {
      stepSlug: 'find_unprocessed_inbound_message',
      name: 'Find Unprocessed Inbound Message',
      stepType: 'action',
      order: 2,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'find_unprocessed',
          tableName: 'conversationMessages',
          backoffHours: '{{backoffHours}}',
          filterExpression: 'direction == "inbound"',
        },
      },
      nextSteps: {
        success: 'check_has_message',
      },
    },

    // Step 3: Check if We Have a Message to Process
    {
      stepSlug: 'check_has_message',
      name: 'Check Has Message',
      stepType: 'condition',
      order: 3,
      config: {
        expression:
          'steps.find_unprocessed_inbound_message.output.data != null',
        description: 'Check if an unprocessed inbound message was found',
      },
      nextSteps: {
        true: 'extract_message_data',
        false: 'noop',
      },
    },

    // Step 4: Extract Message Data
    {
      stepSlug: 'extract_message_data',
      name: 'Extract Message Data',
      stepType: 'action',
      order: 4,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'currentMessageId',
              value:
                '{{steps.find_unprocessed_inbound_message.output.data._id}}',
            },
            {
              name: 'currentConversationId',
              value:
                '{{steps.find_unprocessed_inbound_message.output.data.conversationId}}',
            },
            {
              name: 'currentMessageDeliveredAt',
              value:
                '{{steps.find_unprocessed_inbound_message.output.data.deliveredAt}}',
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
        success: 'find_latest_inbound_message',
      },
    },

    // Step 6: Find Latest Inbound Message ID
    {
      stepSlug: 'find_latest_inbound_message',
      name: 'Find Latest Inbound Message',
      stepType: 'action',
      order: 6,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'latestInboundMessageId',
              value:
                '{{(steps.query_conversation_messages.output.data.page|filterBy("direction", "inbound")|sort("deliveredAt", "desc")|first)._id}}',
            },
          ],
        },
      },
      nextSteps: {
        success: 'check_is_latest_inbound',
      },
    },

    // Step 7: Check if Current Message is Latest Inbound
    {
      stepSlug: 'check_is_latest_inbound',
      name: 'Check Is Latest Inbound',
      stepType: 'condition',
      order: 7,
      config: {
        expression: 'currentMessageId == latestInboundMessageId',
        description:
          'Check if current message is the latest inbound message in conversation',
      },
      nextSteps: {
        true: 'query_conversation',
        false: 'record_message_processed', // Skip but mark as processed
      },
    },

    // Step 8: Query Conversation Details
    {
      stepSlug: 'query_conversation',
      name: 'Query Conversation',
      stepType: 'action',
      order: 8,
      config: {
        type: 'conversation',
        parameters: {
          operation: 'get_by_id',
          conversationId: '{{currentConversationId}}',
        },
      },
      nextSteps: {
        success: 'extract_conversation_data',
      },
    },

    // Step 9: Extract Conversation Data
    {
      stepSlug: 'extract_conversation_data',
      name: 'Extract Conversation Data',
      stepType: 'action',
      order: 9,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'currentConversationSubject',
              value: '{{steps.query_conversation.output.data.subject}}',
            },
            {
              name: 'currentConversationCustomerId',
              value: '{{steps.query_conversation.output.data.customerId}}',
            },
            {
              name: 'currentConversationType',
              value: '{{steps.query_conversation.output.data.type}}',
            },
          ],
        },
      },
      nextSteps: {
        success: 'query_tone_of_voice',
      },
    },

    // Step 10: Query Tone of Voice
    {
      stepSlug: 'query_tone_of_voice',
      name: 'Query Tone of Voice',
      stepType: 'action',
      order: 10,
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

    // Step 11: LLM Check if Reply is Needed AND Classify Conversation Type
    {
      stepSlug: 'check_needs_reply',
      name: 'Check if Reply is Needed and Classify Type',
      stepType: 'llm',
      order: 11,
      config: {
        name: 'Reply Necessity Checker and Type Classifier',
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

    // Step 12: Check if We Should Update Conversation Type
    {
      stepSlug: 'check_should_update_type',
      name: 'Check Should Update Type',
      stepType: 'condition',
      order: 12,
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

    // Step 13: Update Conversation Type
    {
      stepSlug: 'update_conversation_type',
      name: 'Update Conversation Type',
      stepType: 'action',
      order: 13,
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

    // Step 14: Evaluate if Reply is Needed
    {
      stepSlug: 'evaluate_needs_reply',
      name: 'Evaluate Needs Reply',
      stepType: 'condition',
      order: 14,
      config: {
        expression: 'steps.check_needs_reply.output.data.needs_reply == true',
        description: 'Check if LLM determined that a reply is needed',
      },
      nextSteps: {
        true: 'generate_reply',
        false: 'record_message_processed',
      },
    },

    // Step 15: LLM Generate Reply in Markdown
    {
      stepSlug: 'generate_reply',
      name: 'Generate Reply',
      stepType: 'llm',
      order: 15,
      config: {
        name: 'Reply Generator',
        outputFormat: 'text',
        tools: ['customer_read', 'product_read'],
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
- customer_read: Fetch customer info. Use operation='get_by_id' with customerId, operation='get_by_email' with email, or operation='list' to browse all customers
- product_read: Fetch product info. Use operation='get_by_id' with productId, or operation='list' to browse all products

WHEN TO USE TOOLS:
You MUST use these tools proactively when:
- The customer asks about products (e.g., "What products do you have?", "Tell me about X product", "Do you have Y?")
- The customer asks about pricing, availability, or product specifications
- The customer asks about their account, order history, or personal information
- The customer mentions a product name or asks for product recommendations
- You need to verify customer information or account details
- The customer asks "What can I buy?" or similar questions about your offerings

IMPORTANT: Don't just acknowledge the request - actually USE the tools to fetch real data and provide specific information. For example:
- If asked "What products do you have?", use product_read with operation='list' to show actual products
- If asked "What's my account info?", use customer_read with operation='get_by_id' and the customerId to fetch their details
- If asked about a specific product, use product_read with operation='get_by_id' to get accurate details

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

    // Step 16: Create Approval Record
    {
      stepSlug: 'create_approval',
      name: 'Create Approval Record',
      stepType: 'action',
      order: 16,
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
            messageId: '{{currentMessageId}}',
          },
        },
      },
      nextSteps: {
        success: 'record_message_processed',
      },
    },

    // Step 17: Record Message as Processed (Final Step)
    {
      stepSlug: 'record_message_processed',
      name: 'Record Message as Processed',
      stepType: 'action',
      order: 17,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'record_processed',
          tableName: 'conversationMessages',
          recordId: '{{currentMessageId}}',
          metadata: {
            conversationId: '{{currentConversationId}}',
            wasLatestInbound: '{{currentMessageId == latestInboundMessageId}}',
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
        success: 'noop', // 'noop' is a special keyword to end the workflow
      },
    },
  ],
};

export default conversationAutoReplyWorkflow;
