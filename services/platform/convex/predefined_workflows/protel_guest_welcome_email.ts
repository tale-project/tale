/**
 * Protel Guest Welcome Email Workflow
 *
 * This workflow fetches upcoming guest arrivals (7-14 days ahead) from Protel PMS
 * via the integration_processing_records action and sends personalized welcome emails.
 *
 * High-level flow:
 * 1) Use integration_processing_records to find unprocessed upcoming reservations
 * 2) Loop through each reservation
 * 3) Extract guest and reservation data
 * 4) Use AI to generate a personalized welcome email
 * 5) Create a conversation (email draft) for review
 * 6) Create an approval for the email before sending
 * 7) Mark the reservation as processed
 *
 * Features:
 * - Fetches reservations with check-in dates 7-14 days in the future
 * - Uses Protel's list_reservations SQL operation via integration
 * - Processes multiple reservations per execution using loop node
 * - AI-powered personalized welcome email generation
 * - Creates approval workflow for email review before sending
 * - Tracks processed reservations to avoid duplicate emails
 *
 * Data Source Configuration:
 * - integration: 'protel' (SQL integration to Protel PMS)
 * - action: 'list_reservations' (fetches from proteluser.buch table)
 * - params: buchstatus=0 (arrivals, not checked in)
 * - uniqueKey: 'reservation_id' (unique identifier for deduplication)
 * - filter: JEXL expression to filter to 7-14 days ahead
 * - limit: Number of reservations to process per execution
 *
 * Workflow Type: Predefined
 * - Developer-defined workflow
 * - User provides Protel SQL credentials
 * - Can be scheduled daily or triggered manually
 */

export const protelGuestWelcomeEmailWorkflow = {
  workflowConfig: {
    name: 'Protel Guest Welcome Email',
    description:
      'Send personalized welcome emails to guests arriving in 7-14 days',
    workflowType: 'predefined',
    version: '1.1.0',
    config: {
      timeout: 300000, // 5 minutes total timeout
      retryPolicy: { maxRetries: 2, backoffMs: 3000 },
      variables: {
        // Days ahead to look for arrivals
        minDaysAhead: 7,
        maxDaysAhead: 14,
        // Backoff: process each reservation once per 7 days
        backoffHours: 168,
        // Number of reservations to process per execution
        batchSize: 10,
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
        type: 'manual',
        // For scheduled welcome emails, uncomment below:
        // schedule: '0 9 * * *', // Every day at 9 AM
        // timezone: 'UTC',
      },
      nextSteps: { success: 'find_upcoming_arrivals' },
    },

    // Step 2: Find Unprocessed Upcoming Arrivals
    // Uses integration_processing_records to fetch from Protel and find unprocessed records
    {
      stepSlug: 'find_upcoming_arrivals',
      name: 'Find Upcoming Arrivals',
      stepType: 'action',
      order: 2,
      config: {
        type: 'integration_processing_records',
        parameters: {
          strategy: 'find_by_timestamp',
          integration: 'protel',
          action: 'list_reservations',
          params: {
            buchstatus: 0, // Arrivals (not checked in)
          },
          uniqueKey: 'reservation_id',
          tag: 'upcoming_arrivals',
          // Local JEXL filter: check_in_date between 7 and 14 days from now
          // daysAgo returns negative for future dates, so we check daysAgo(date) >= -14 && daysAgo(date) <= -7
          filter:
            'daysAgo(check_in_date) >= -14 && daysAgo(check_in_date) <= -7 && guest_email != null && guest_email != ""',
          cursor: {
            field: 'check_in_date',
            actionParam: 'fromDate',
            format: 'date',
          },
          // Reprocess each reservation after 7 days (168 hours)
          backoffHours: '{{backoffHours}}',
          // Process multiple reservations per execution
          limit: '{{batchSize}}',
        },
      },
      nextSteps: {
        success: 'check_has_arrivals',
      },
    },

    // Step 3: Check if Arrivals Found
    {
      stepSlug: 'check_has_arrivals',
      name: 'Check if Arrivals Found',
      stepType: 'condition',
      order: 3,
      config: {
        expression: 'steps.find_upcoming_arrivals.output.data != null',
        description: 'Check if we found any upcoming arrivals',
      },
      nextSteps: {
        true: 'loop_arrivals',
        false: 'noop',
      },
    },

    // Step 4: Loop Through Arrivals
    {
      stepSlug: 'loop_arrivals',
      name: 'Loop Through Arrivals',
      stepType: 'loop',
      order: 4,
      config: {
        items: '{{steps.find_upcoming_arrivals.output.data}}',
        itemVariable: 'currentArrival',
      },
      nextSteps: {
        loop: 'extract_reservation_data',
        done: 'noop',
      },
    },

    // Step 5: Extract Reservation and Guest Data
    {
      stepSlug: 'extract_reservation_data',
      name: 'Extract Reservation Data',
      stepType: 'action',
      order: 5,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'currentReservation',
              value: '{{loop.currentItem}}',
            },
            {
              name: 'reservationId',
              value: '{{loop.currentItem.reservation_id}}',
            },
            {
              name: 'guestId',
              value: '{{loop.currentItem.guest_id}}',
            },
            {
              name: 'guestName',
              value:
                '{{loop.currentItem.guest_firstname}} {{loop.currentItem.guest_name1}}',
            },
            {
              name: 'guestFirstName',
              value: '{{loop.currentItem.guest_firstname}}',
            },
            {
              name: 'guestEmail',
              value: '{{loop.currentItem.guest_email}}',
            },
            {
              name: 'checkInDate',
              value: '{{loop.currentItem.check_in_date}}',
            },
            {
              name: 'checkOutDate',
              value: '{{loop.currentItem.check_out_date}}',
            },
            {
              name: 'roomCategory',
              value: '{{loop.currentItem.category_name}}',
            },
            {
              name: 'roomNumber',
              value: '{{loop.currentItem.room_number}}',
            },
            {
              name: 'guestCount',
              value: '{{loop.currentItem.guests}}',
            },
            {
              name: 'adultsCount',
              value: '{{loop.currentItem.adults}}',
            },
            {
              name: 'childrenCount',
              value: '{{loop.currentItem.children}}',
            },
          ],
        },
      },
      nextSteps: {
        success: 'generate_welcome_email',
      },
    },

    // Step 6: Generate Personalized Welcome Email with AI
    {
      stepSlug: 'generate_welcome_email',
      name: 'Generate Welcome Email',
      stepType: 'llm',
      order: 6,
      config: {
        name: 'Welcome Email Generator',
        temperature: 0.7,
        maxTokens: 2000,
        maxSteps: 10,
        outputFormat: 'json',
        outputSchema: {
          type: 'object',
          description: 'Welcome email content',
          properties: {
            subject: {
              type: 'string',
              description: 'Email subject line - warm and welcoming',
            },
            body: {
              type: 'string',
              description: 'Full email body in Markdown format',
            },
            preview: {
              type: 'string',
              description: 'Email preview text shown in inbox',
            },
          },
          required: ['subject', 'body', 'preview'],
        },
        tools: ['rag_search'],
        systemPrompt: `You are a hospitality expert who crafts warm, personalized welcome emails for hotel guests.
Your task is to write a friendly pre-arrival email that makes guests feel excited about their upcoming stay.

You have access to tools:
- Use the "rag_search" tool to look up hotel-specific information like amenities, services, local attractions, restaurant hours, etc.

Guidelines:
- Use a warm, professional yet friendly tone
- Address the guest by their first name
- Mention specific details about their stay (dates, room type, number of guests)
- Include helpful pre-arrival information (check-in time, what to bring, etc.)
- Suggest amenities or services they might enjoy based on their stay details
- If traveling with children, mention family-friendly services
- Keep the email concise but informative (3-4 paragraphs)
- End with a warm closing and contact information for questions
- Format the email body in Markdown
- Do not include any placeholder text - write as if for a real guest`,
        userPrompt: `Generate a personalized welcome email for an upcoming guest:

Guest Name: {{guestName}}
Guest First Name: {{guestFirstName}}
Guest Email: {{guestEmail}}

Reservation Details:
- Reservation ID: {{reservationId}}
- Check-in Date: {{checkInDate}}
- Check-out Date: {{checkOutDate}}
- Room Category: {{roomCategory}}
- Room Number: {{roomNumber}}
- Total Guests: {{guestCount}}
- Adults: {{adultsCount}}
- Children: {{childrenCount}}

Before writing the email, use the "rag_search" tool to find relevant information about hotel amenities, services, or local attractions that would be helpful for this guest.

Write a warm, personalized welcome email that:
1. Greets them by first name
2. Confirms their stay details
3. Provides helpful pre-arrival information
4. Suggests relevant amenities or activities
5. Ends with a warm invitation and contact info`,
      },
      nextSteps: {
        success: 'create_conversation',
      },
    },

    // Step 7: Create Conversation (Email Draft)
    {
      stepSlug: 'create_conversation',
      name: 'Create Email Conversation',
      stepType: 'action',
      order: 7,
      config: {
        type: 'conversation',
        parameters: {
          operation: 'create',
          subject: '{{steps.generate_welcome_email.output.data.subject}}',
          status: 'open',
          priority: 'medium',
          type: 'welcome_email',
          channel: 'email',
          direction: 'outbound',
          metadata: {
            emailSubject: '{{steps.generate_welcome_email.output.data.subject}}',
            emailBody: '{{steps.generate_welcome_email.output.data.body}}',
            emailPreview: '{{steps.generate_welcome_email.output.data.preview}}',
            customerEmail: '{{guestEmail}}',
            // Protel reservation data
            protelReservationId: '{{reservationId}}',
            protelGuestId: '{{guestId}}',
            guestName: '{{guestName}}',
            checkInDate: '{{checkInDate}}',
            checkOutDate: '{{checkOutDate}}',
            roomCategory: '{{roomCategory}}',
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
          resourceId: '{{steps.create_conversation.output.data._id}}',
          priority: 'medium',
          description: 'Review and approve welcome email before sending to guest',
          metadata: {
            guestName: '{{guestName}}',
            guestEmail: '{{guestEmail}}',
            protelReservationId: '{{reservationId}}',
            checkInDate: '{{checkInDate}}',
            checkOutDate: '{{checkOutDate}}',
            roomCategory: '{{roomCategory}}',
            emailSubject: '{{steps.generate_welcome_email.output.data.subject}}',
            emailBody: '{{steps.generate_welcome_email.output.data.body}}',
          },
        },
      },
      nextSteps: {
        success: 'record_processed',
      },
    },

    // Step 9: Mark Reservation as Processed
    {
      stepSlug: 'record_processed',
      name: 'Record Reservation Processed',
      stepType: 'action',
      order: 9,
      config: {
        type: 'integration_processing_records',
        parameters: {
          strategy: 'record_processed',
          integration: 'protel',
          tag: 'upcoming_arrivals',
          recordId: '{{reservationId}}',
          metadata: {
            welcomeEmailGenerated: true,
            conversationId: '{{steps.create_conversation.output.data._id}}',
            approvalId: '{{steps.create_email_approval.output.data._id}}',
            processedAt: '{{now}}',
            guestEmail: '{{guestEmail}}',
            checkInDate: '{{checkInDate}}',
          },
        },
      },
      nextSteps: {
        // Return to loop for next arrival
        success: 'loop_arrivals',
      },
    },
  ],
};

export default protelGuestWelcomeEmailWorkflow;
