# Workflow System - User Guide

**Build powerful automation workflows with AI, data processing, and customer engagement.**

---

## Table of Contents

1. [What You Can Build](#what-you-can-build)
2. [Quick Start](#quick-start)
3. [Building Blocks](#building-blocks)
4. [Working with Data](#working-with-data)
5. [Common Patterns](#common-patterns)
6. [Scheduling & Automation](#scheduling--automation)
7. [Best Practices](#best-practices)

---

## How to Use Workflows

You don't need to write code! There are two main ways to create and manage workflows:

### 1. 🤖 Ask the AI Assistant

Simply describe what you want in natural language:

```
"Create a workflow that sends a welcome email to new customers"

"Build a workflow that finds inactive customers and sends them a re-engagement offer"

"I need a workflow that uses AI to recommend products based on purchase history"
```

The AI will create the workflow structure for you.

### 2. 🖱️ Use the Visual Workflow Editor

The platform includes a visual workflow editor where you can:

- **View workflows** - See your workflow as a visual flowchart
- **Add steps** - Click to add new steps to your workflow
- **Connect steps** - Draw connections between steps
- **Configure steps** - Edit step settings through a side panel
- **Test workflows** - Run test executions and see results
- **Chat with AI** - Get help building your workflow from the AI assistant

The visual editor shows:
- Step types with color-coded icons (Trigger, Action, LLM, Condition, Loop)
- Connections between steps
- Step names and descriptions
- Minimap for navigation
- Real-time validation

**Note:** The examples in this guide show the JSON structure that represents workflows. You don't need to write JSON manually - the visual editor and AI assistant handle this for you.

---

## What You Can Build

Workflows let you automate complex business processes by connecting simple building blocks. Here are real examples:

### 🤖 AI-Powered Customer Support
**Auto-reply to customer conversations**
- Detect when a conversation needs a reply
- Generate personalized responses using AI
- Match your brand's tone of voice
- Create approval records for review

### 📊 Smart Product Recommendations
**Suggest products to customers**
- Analyze customer purchase history
- Use AI to find relevant products
- Generate personalized recommendations
- Send via email or save to database

### 🔍 Customer Health Monitoring
**Identify at-risk customers**
- Assess customer status (active/churned/at-risk)
- Analyze engagement patterns
- Trigger retention campaigns
- Update customer records automatically

### 📄 Content Processing
**Scan and index website content**
- Fetch website pages
- Extract metadata and content
- Upload to knowledge base (RAG)
- Keep content synchronized

### 🔄 Data Synchronization
**Keep systems in sync**
- Import customers from external systems
- Sync products and inventory
- Upload documents to search
- Process data in batches

---

## Understanding Workflow Structure

A workflow is a series of **steps** connected together. Each step does one thing, then passes control to the next step.

### Visual Flow

```
┌─────────┐
│ Trigger │  ← Workflow starts here
└────┬────┘
     │
     ▼
┌─────────┐
│ Action  │  ← Do something (get data, send email, etc.)
└────┬────┘
     │
     ▼
┌──────────┐
│Condition │  ← Make a decision
└─┬──────┬─┘
  │      │
true   false
  │      │
  ▼      ▼
┌────┐ ┌────┐
│Step│ │Step│  ← Different paths based on condition
└────┘ └────┘
```

### Key Concepts

**Steps** - Individual building blocks
- **Trigger** - How the workflow starts
- **Action** - Do something (get data, send email, update records)
- **LLM** - Use AI to analyze or generate content
- **Condition** - Make decisions and branch
- **Loop** - Process multiple items

**Connections** - How steps link together
- Each step can go to different next steps based on the outcome
- `success` → next step when things work
- `error` → handle failures
- `true`/`false` → branch based on conditions
- `next`/`done` → loop through items

**Data Flow** - Information moves through your workflow
- Start with input data
- Each step can access previous step outputs
- Use variables to reference data: `{{customer.email}}`, `{{product.name}}`
- Store secrets securely for API keys and passwords

---

## Quick Start

Let's build your first workflow: **Send a welcome email to new customers**

### Tell the AI What You Want

```
"Create a workflow that sends a welcome email to new customers.
It should get the customer data and send a personalized email."
```

### What the AI Creates

The AI will build a workflow with 3 steps:

**Step 1: Trigger**
- Type: Manual trigger
- Purpose: Start the workflow when you provide a customer ID

**Step 2: Get Customer**
- Type: Action (customer.get_by_id)
- Purpose: Fetch customer details
- Input: Customer ID from workflow input
- Output: Customer name, email, and other details

**Step 3: Send Email**
- Type: Action (email_send)
- Purpose: Send personalized welcome email
- Input: Customer email and name from Step 2
- Output: Email sent confirmation

### How It Works

```
You provide: customerId = "cust_456"
         ↓
Step 1: Workflow starts
         ↓
Step 2: Gets customer data
         → name: "John Doe"
         → email: "john@example.com"
         ↓
Step 3: Sends email
         → To: john@example.com
         → Subject: "Welcome to our platform!"
         → Body: "Hi John Doe, welcome aboard!"
         ↓
Done! ✓
```

### View and Test

After the AI creates it:
1. **View** the workflow in the visual editor (see the flowchart)
2. **Test** it with a real customer ID
3. **Activate** it when ready
4. **Run** it manually or on a schedule

That's it! You've created your first workflow without writing any code.

---

## Building Blocks

Workflows are built from 5 types of steps. Each step does one thing well.

### 1. 🎯 Trigger - Start Your Workflow

**What it does:** Defines how the workflow starts

**When to use:** Every workflow needs exactly one trigger as the first step

**Example:**
```json
{
  "stepType": "trigger",
  "config": {
    "type": "manual"
  }
}
```

**Trigger types:**
- `manual` - Start manually from UI or API
- `schedule` - Run on a schedule (cron)
- `webhook` - Trigger from external system
- `event` - React to system events

**Output ports:** `success`

---

### 2. 🤖 LLM - AI Processing

**What it does:** Uses AI to analyze data, generate content, or make decisions

**When to use:**
- Generate personalized content
- Analyze customer data
- Make intelligent decisions
- Extract information from text

**Example: Generate product recommendation**
```json
{
  "stepType": "llm",
  "config": {
    "name": "Product Recommender",
    "systemPrompt": "You are a product recommendation expert.",
    "userPrompt": "Recommend products for customer: {{steps.get_customer.output.name}}",
    "temperature": 0.7,
    "maxTokens": 500,
    "outputFormat": "json",
    "tools": ["product_search", "customer_get"]
  }
}
```

**Configuration options:**
- `systemPrompt` - Define the AI's role and behavior (required)
- `userPrompt` - The specific task or question (optional)
- `temperature` - Creativity level: 0 (focused) to 1 (creative)
- `maxTokens` - Maximum response length
- `outputFormat` - `"text"` for natural language, `"json"` for structured data
- `tools` - Array of tools the AI can use (e.g., `["customer_get", "product_search"]`)

**Available tools:**
- Customer: `customer_get`, `customer_search`, `list_customers`
- Product: `product_get`, `product_search`, `list_products`
- Conversation: `conversation_get`, `conversation_search`
- And more...

**Output ports:** `success`, `error`

---

### 3. ⚡ Condition - Make Decisions

**What it does:** Branch your workflow based on data

**When to use:**
- Check if a value meets criteria
- Route based on customer status
- Handle different scenarios

**Example: Check if customer is VIP**
```json
{
  "stepType": "condition",
  "config": {
    "expression": "{{steps.get_customer.output.totalSpent}} > 1000",
    "description": "Is customer VIP?"
  },
  "nextSteps": {
    "true": "send_vip_offer",
    "false": "send_standard_offer"
  }
}
```

**Expression examples:**
```javascript
// Numbers
"{{customer.age}} >= 18"
"{{order.total}} > 100 && {{order.total}} < 500"

// Strings
"{{customer.status}} == 'active'"
"{{customer.email}} contains '@gmail.com'"

// Arrays
"{{customer.tags}} includes 'vip'"
"{{order.items.length}} > 5"

// Combining conditions
"{{customer.status}} == 'active' && {{customer.totalSpent}} > 1000"
```

**Output ports:** `true`, `false`

---

### 4. 🔧 Action - Do Something

**What it does:** Performs operations like sending emails, updating records, calling APIs, or managing data

**When to use:** Whenever you need to interact with data or external systems

Actions are the workhorses of your workflow. Each action type provides specific operations for different parts of your system.

#### Customer Actions

Manage customer data and relationships:

- **create** - Create a new customer
- **get_by_id** - Get customer details by ID
- **query** - Search customers with filters (status, source, etc.)
- **update** - Update customer information
- **filter** - Advanced filtering with expressions (e.g., "totalSpent > 1000")

**Example use cases:**
- "Get customer by ID and check their status"
- "Find all active customers who haven't purchased in 30 days"
- "Update customer status to VIP"

#### Product Actions

Manage product catalog:

- **create** - Create a new product
- **get_by_id** - Get product details by ID
- **query** - Search products with filters (category, status, etc.)
- **update** - Update product information
- **filter** - Advanced filtering with expressions
- **hydrate_fields** - Enrich data with product details

**Example use cases:**
- "Get product details for recommendations"
- "Find all active products in a category"
- "Update product stock levels"

#### Conversation Actions

Manage customer conversations and messages:

- **create** - Create a new conversation
- **get_by_id** - Get conversation details
- **query** - Search conversations (by status, customer, channel)
- **query_messages** - Get messages in a conversation
- **update** - Update conversation status or metadata
- **create_from_email** - Create conversation from email thread
- **create_from_sent_email** - Create conversation from sent email

**Example use cases:**
- "Find all open conversations"
- "Get conversation history for a customer"
- "Update conversation status to resolved"

#### Document Actions

Manage documents and files:

- **create** - Create a new document
- **get_by_id** - Get document details
- **query** - Search documents
- **update** - Update document metadata
- **generate_signed_url** - Get temporary download URL

**Example use cases:**
- "Upload a document for processing"
- "Get signed URL for document download"
- "Query documents by source provider"

#### Email Provider Actions

Get email configuration:

- **get_default** - Get default email provider settings
- **get_imap_credentials** - Get IMAP credentials for email sync

**Example use cases:**
- "Get email provider for sending messages"
- "Get IMAP credentials for syncing inbox"

#### RAG (Knowledge Base) Actions

Upload content to semantic search:

- **upload_document** - Upload a document to knowledge base
- **upload_text** - Upload text content directly

**Example use cases:**
- "Index customer documents for AI search"
- "Upload product descriptions to knowledge base"

#### Approval Actions

Manage approval workflows:

- **create_approval** - Create an approval request
- **update_approval_status** - Approve or reject
- **get_approval** - Get approval details
- **list_pending_approvals** - List all pending approvals
- **get_approval_history** - Get approval history

**Example use cases:**
- "Create approval for AI-generated email"
- "List pending approvals for review"
- "Approve or reject a request"

#### Integration Actions

Connect to external systems:

- **Execute any operation** from configured integrations (Shopify, Circuly, custom APIs, etc.)

**Example use cases:**
- "Sync orders from Shopify"
- "Get subscription data from Circuly"
- "Call custom ERP API"

#### Utility Actions

General-purpose operations:

- **set_variables** - Store data for later use in the workflow
- **workflow.upload_all_workflows** - Upload workflows to knowledge base

**Example use cases:**
- "Store calculated values"
- "Save intermediate results"

**Output ports:** All actions have `success` and `error` ports

---

### 5. 🔄 Loop - Process Collections

**What it does:** Iterate over arrays and process each item

**When to use:**
- Send emails to multiple customers
- Process a list of products
- Handle batch operations

**Example: Send email to each customer**
```json
{
  "stepSlug": "loop_customers",
  "stepType": "loop",
  "config": {
    "items": "{{steps.get_customers.output.customers}}",
    "itemVariable": "customer"
  },
  "nextSteps": {
    "next": "send_email",
    "done": "finish"
  }
}
```

**Inside the loop:**
```json
{
  "stepSlug": "send_email",
  "stepType": "action",
  "config": {
    "type": "email_send",
    "parameters": {
      "to": "{{loop.item.email}}",
      "subject": "Hello {{loop.item.name}}!",
      "body": "You are customer #{{loop.index}}"
    }
  },
  "nextSteps": {
    "success": "loop_customers"
  }
}
```

**How it works:**
1. Loop starts with first item
2. Executes the `next` step for that item
3. That step returns to the loop
4. Loop moves to next item
5. Repeats until all items processed
6. Then goes to `done` step

**Loop variables:**
- `{{loop.item}}` - Current item being processed
- `{{loop.item.propertyName}}` - Access properties of current item
- `{{loop.index}}` - Current position (starts at 0)
- `{{loop.parent.item}}` - For nested loops (access outer loop's item)

**Output ports:** `next`, `done`, `error`

---

## Working with Data

### Variables and Templating

Use `{{variable}}` syntax to access data anywhere in your workflow:

**Input data:**
```typescript
{{input.customerId}}
{{input.productName}}
```

**Step outputs:**
```typescript
{{steps.get_customer.output.email}}
{{steps.analyze.output.score}}
```

**Loop context:**
```typescript
{{loop.item.name}}
{{loop.index}}
```

**Built-in variables:**
```typescript
{{organizationId}}      // Current organization
{{wfDefinitionId}}      // Workflow ID
{{$now}}               // Current timestamp
```

### Using Secrets

Store sensitive data (API keys, passwords) securely:

```typescript
// In workflow config
config: {
  secrets: {
    apiKey: {
      kind: 'inlineEncrypted',
      cipherText: '...'  // Encrypted value
    }
  }
}

// Use in steps
parameters: {
  authorization: '{{secrets.apiKey}}'
}
```

### Accessing Nested Data

```typescript
// Object properties
{{customer.profile.address.city}}

// Array items
{{products[0].name}}

// With filters (Mustache)
{{#customers}}
  {{name}}: {{email}}
{{/customers}}
```

---

## Common Patterns

### Pattern 1: AI-Powered Customer Engagement

**Use case:** Automatically reply to customer messages with AI

**What you tell the AI:**
> "Create a workflow that finds open conversations, uses AI to decide if they need a reply, generates a response, and saves it for approval."

**Workflow structure:**
```json
{
  "name": "Auto-Reply to Conversations",
  "steps": [
    {
      "stepSlug": "find_conversations",
      "stepType": "action",
      "config": {
        "type": "conversation_search",
        "parameters": {
          "status": "open",
          "limit": 10
        }
      },
      "nextSteps": { "success": "loop_conversations" }
    },
    {
      "stepSlug": "loop_conversations",
      "stepType": "loop",
      "config": {
        "items": "{{steps.find_conversations.output.conversations}}",
        "itemVariable": "conversation"
      },
      "nextSteps": {
        "next": "check_needs_reply",
        "done": "finish"
      }
    },
    {
      "stepSlug": "check_needs_reply",
      "stepType": "llm",
      "config": {
        "systemPrompt": "Analyze if this conversation needs a reply. Return JSON with 'needsReply' boolean.",
        "userPrompt": "Conversation: {{loop.item.messages}}",
        "outputFormat": "json"
      },
      "nextSteps": { "success": "decide_reply" }
    },
    {
      "stepSlug": "decide_reply",
      "stepType": "condition",
      "config": {
        "expression": "{{steps.check_needs_reply.output.needsReply}} == true"
      },
      "nextSteps": {
        "true": "generate_reply",
        "false": "loop_conversations"
      }
    },
    {
      "stepSlug": "generate_reply",
      "stepType": "llm",
      "config": {
        "systemPrompt": "You are a helpful customer service agent. Generate a professional reply.",
        "userPrompt": "Reply to: {{loop.item.lastMessage}}"
      },
      "nextSteps": { "success": "save_reply" }
    },
    {
      "stepSlug": "save_reply",
      "stepType": "action",
      "config": {
        "type": "conversation_create_draft",
        "parameters": {
          "conversationId": "{{loop.item._id}}",
          "message": "{{steps.generate_reply.output}}"
        }
      },
      "nextSteps": { "success": "loop_conversations" }
    }
  ]
}
```

**What happens:**
1. Finds up to 10 open conversations
2. Loops through each conversation
3. AI analyzes if it needs a reply
4. If yes, AI generates a professional response
5. Saves the response as a draft for human approval
6. Continues to next conversation

---

### Pattern 2: Smart Product Recommendations

**Use case:** Recommend products based on customer behavior

**What you tell the AI:**
> "Create a workflow that gets a customer's purchase history, uses AI to recommend 3 relevant products, saves the recommendations, and sends them via email."

**Workflow structure:**
```json
{
  "name": "Product Recommendations",
  "steps": [
    {
      "stepSlug": "get_customer",
      "stepType": "action",
      "config": {
        "type": "customer_get",
        "parameters": {
          "customerId": "{{input.customerId}}"
        }
      },
      "nextSteps": { "success": "get_orders" }
    },
    {
      "stepSlug": "get_orders",
      "stepType": "action",
      "config": {
        "type": "customer_orders",
        "parameters": {
          "customerId": "{{input.customerId}}",
          "limit": 20
        }
      },
      "nextSteps": { "success": "recommend_products" }
    },
    {
      "stepSlug": "recommend_products",
      "stepType": "llm",
      "config": {
        "systemPrompt": "You are a product recommendation expert. Analyze purchase history and recommend 3 relevant products.",
        "userPrompt": "Customer: {{steps.get_customer.output.name}}\nPurchase history: {{steps.get_orders.output}}",
        "outputFormat": "json",
        "tools": ["product_search", "product_get"]
      },
      "nextSteps": { "success": "save_recommendations" }
    },
    {
      "stepSlug": "save_recommendations",
      "stepType": "action",
      "config": {
        "type": "recommendation_create",
        "parameters": {
          "customerId": "{{input.customerId}}",
          "products": "{{steps.recommend_products.output.products}}"
        }
      },
      "nextSteps": { "success": "send_email" }
    },
    {
      "stepSlug": "send_email",
      "stepType": "action",
      "config": {
        "type": "email_send",
        "parameters": {
          "to": "{{steps.get_customer.output.email}}",
          "subject": "Products you might love",
          "body": "Hi {{steps.get_customer.output.name}}, based on your recent purchases, we think you'll love these: {{steps.recommend_products.output.products}}"
        }
      },
      "nextSteps": { "success": "end" }
    }
  ]
}
```

**What happens:**
1. Gets customer data
2. Fetches their last 20 orders
3. AI analyzes purchase patterns and recommends 3 products (can search product catalog)
4. Saves recommendations to database
5. Sends personalized email with recommendations

---

### Pattern 3: Batch Processing with Loops

**Use case:** Process multiple items efficiently

**What you tell the AI:**
> "Create a workflow that finds inactive customers, uses AI to assess their status, and updates their records accordingly."

**Workflow structure:**
```json
{
  "name": "Assess Customer Health",
  "steps": [
    {
      "stepSlug": "find_inactive",
      "stepType": "action",
      "config": {
        "type": "customer_search",
        "parameters": {
          "status": "inactive",
          "limit": 100
        }
      },
      "nextSteps": { "success": "loop_customers" }
    },
    {
      "stepSlug": "loop_customers",
      "stepType": "loop",
      "config": {
        "items": "{{steps.find_inactive.output.customers}}",
        "itemVariable": "customer"
      },
      "nextSteps": {
        "next": "assess_customer",
        "done": "finish"
      }
    },
    {
      "stepSlug": "assess_customer",
      "stepType": "llm",
      "config": {
        "systemPrompt": "Assess customer health. Return JSON with 'status' field: 'active', 'at_risk', or 'churned'.",
        "userPrompt": "Customer data: {{loop.item}}",
        "outputFormat": "json"
      },
      "nextSteps": { "success": "update_customer" }
    },
    {
      "stepSlug": "update_customer",
      "stepType": "action",
      "config": {
        "type": "customer_update",
        "parameters": {
          "customerId": "{{loop.item._id}}",
          "status": "{{steps.assess_customer.output.status}}"
        }
      },
      "nextSteps": { "success": "loop_customers" }
    }
  ]
}
```

**What happens:**
1. Finds up to 100 inactive customers
2. Loops through each customer
3. AI analyzes their data and determines status
4. Updates customer record with new status
5. Continues to next customer

---

### Pattern 4: Multi-Step AI Conversation

**Use case:** AI steps that build on each other's context

**What you tell the AI:**
> "Create a workflow where AI first analyzes customer data, then based on that analysis, recommends specific actions. The AI should remember the first analysis when making recommendations."

**Important:** To share context between AI steps, you need to provide a `threadId` when starting the workflow.

**Workflow structure:**
```json
{
  "name": "Customer Analysis with Recommendations",
  "steps": [
    {
      "stepSlug": "get_customer",
      "stepType": "action",
      "config": {
        "type": "customer_get",
        "parameters": {
          "customerId": "{{input.customerId}}"
        }
      },
      "nextSteps": { "success": "analyze_customer" }
    },
    {
      "stepSlug": "analyze_customer",
      "stepType": "llm",
      "config": {
        "systemPrompt": "You are a customer success analyst. Analyze the customer's data and identify patterns.",
        "userPrompt": "Analyze this customer: {{steps.get_customer.output}}"
      },
      "nextSteps": { "success": "recommend_actions" }
    },
    {
      "stepSlug": "recommend_actions",
      "stepType": "llm",
      "config": {
        "systemPrompt": "Based on your previous analysis, recommend 3 specific actions we should take.",
        "userPrompt": "What should we do?"
      },
      "nextSteps": { "success": "save_recommendations" }
    },
    {
      "stepSlug": "save_recommendations",
      "stepType": "action",
      "config": {
        "type": "set_variables",
        "parameters": {
          "analysis": "{{steps.analyze_customer.output}}",
          "recommendations": "{{steps.recommend_actions.output}}"
        }
      },
      "nextSteps": { "success": "end" }
    }
  ]
}
```

**How to run with shared context:**
When you start this workflow, provide a `threadId`:
```json
{
  "input": {
    "customerId": "cust_456"
  },
  "threadId": "thread_abc123"
}
```

**What happens:**
1. Gets customer data
2. AI analyzes the customer (creates analysis in thread)
3. AI recommends actions (remembers the analysis from step 2)
4. Saves both analysis and recommendations

**Without threadId:** Each AI step would start fresh with no memory of previous steps.

---

### Pattern 5: Error Handling

**Use case:** Handle failures gracefully

**What you tell the AI:**
> "Create a workflow that sends an email to a customer. If it succeeds, mark them as contacted. If it fails, log the error for review."

**Workflow structure:**
```json
{
  "name": "Send Email with Error Handling",
  "steps": [
    {
      "stepSlug": "get_customer",
      "stepType": "action",
      "config": {
        "type": "customer_get",
        "parameters": {
          "customerId": "{{input.customerId}}"
        }
      },
      "nextSteps": { "success": "send_email" }
    },
    {
      "stepSlug": "send_email",
      "stepType": "action",
      "config": {
        "type": "email_send",
        "parameters": {
          "to": "{{steps.get_customer.output.email}}",
          "subject": "Important update",
          "body": "Hi {{steps.get_customer.output.name}}, ..."
        }
      },
      "nextSteps": {
        "success": "mark_sent",
        "error": "log_failure"
      }
    },
    {
      "stepSlug": "mark_sent",
      "stepType": "action",
      "config": {
        "type": "customer_update",
        "parameters": {
          "customerId": "{{input.customerId}}",
          "emailSent": true,
          "lastContactedAt": "{{$now}}"
        }
      },
      "nextSteps": { "success": "end" }
    },
    {
      "stepSlug": "log_failure",
      "stepType": "action",
      "config": {
        "type": "set_variables",
        "parameters": {
          "errorMessage": "{{steps.send_email.error}}",
          "failedAt": "{{$now}}",
          "customerId": "{{input.customerId}}"
        }
      },
      "nextSteps": { "success": "end" }
    }
  ]
}
```

**What happens:**

**Success path:**
1. Gets customer data
2. Sends email successfully
3. Updates customer record with `emailSent: true`

**Error path:**
1. Gets customer data
2. Email fails (invalid address, service down, etc.)
3. Logs error details for review

---

## Scheduling & Automation

### Run on a Schedule

Use cron expressions to run workflows automatically:

```typescript
// In workflow config
config: {
  schedule: {
    cron: '0 9 * * *',      // Every day at 9 AM
    timezone: 'America/New_York'
  }
}
```

**Common schedules:**
- `0 * * * *` - Every hour
- `0 9 * * *` - Daily at 9 AM
- `0 9 * * 1` - Every Monday at 9 AM
- `*/15 * * * *` - Every 15 minutes
- `0 0 1 * *` - First day of each month

### Trigger from Events

```typescript
{
  stepType: 'trigger',
  config: {
    type: 'event',
    eventType: 'customer.created'
  }
}
```

### Webhook Triggers

```typescript
{
  stepType: 'trigger',
  config: {
    type: 'webhook',
    path: '/webhooks/new-order'
  }
}
```

---

## Best Practices

### ✅ Do's

**1. Keep steps focused**
- Each step should do one thing well
- Break complex logic into multiple steps

**2. Use descriptive names**
```typescript
// Good
stepSlug: 'check_customer_vip_status'

// Bad
stepSlug: 'step3'
```

**3. Handle errors**
- Always define `error` ports for actions and LLM steps
- Log failures for debugging

**4. Test with small data first**
- Start with 1-5 items in loops
- Scale up after testing

**5. Use variables wisely**
- Store reusable values in variables
- Keep secrets encrypted

**6. Add descriptions**
```typescript
{
  name: 'Send Welcome Email',
  description: 'Sends personalized welcome email to new customers within 24 hours'
}
```

### ❌ Don'ts

**1. Don't create circular flows**
```typescript
// Bad: Infinite loop
step1 → step2 → step1
```

**2. Don't hardcode sensitive data**
```typescript
// Bad
apiKey: 'sk_live_abc123'

// Good
apiKey: '{{secrets.apiKey}}'
```

**3. Don't process huge batches in one workflow**
```typescript
// Bad: 10,000 items in one loop
items: allCustomers  // 10,000 customers

// Good: Process in chunks
items: '{{steps.get_batch.output.customers}}'  // 100 at a time
```

**4. Don't skip error handling**
```typescript
// Bad: No error port
nextSteps: { success: 'next_step' }

// Good: Handle both cases
nextSteps: {
  success: 'next_step',
  error: 'log_error'
}
```

**5. Don't nest loops too deeply**
```typescript
// Bad: 3+ levels of nesting
loop → loop → loop → loop

// Good: Flatten or use separate workflows
```

---

## Debugging Tips

### View Execution Logs

```typescript
// Get execution details
const execution = await ctx.runQuery(api.wf_executions.getExecution, {
  executionId: 'exec_123'
});

console.log(execution.status);        // 'running', 'completed', 'failed'
console.log(execution.currentStepSlug); // Which step is running
console.log(execution.variables);     // Current variable state
```

### Common Issues

**Issue: "Variable not found"**
```typescript
// Check variable path
{{steps.get_customer.output.email}}  // ✅ Correct
{{customer.email}}                    // ❌ Wrong - missing 'steps.'
```

**Issue: "Loop not iterating"**
```typescript
// Make sure to return to loop
nextSteps: {
  success: 'loop_continue'  // Must go back to loop step
}
```

**Issue: "AI not using tools"**
```typescript
// Make sure tools are specified
config: {
  tools: ['customer_get', 'product_search'],  // ✅ Specify tools
  systemPrompt: 'Use tools to find customer data'
}
```

**Issue: "Workflow stuck"**
- Check for missing `nextSteps` definitions
- Verify all ports are connected
- Look for condition expressions that never evaluate to true

---

## Next Steps

Ready to build your first workflow? Here's what to do:

1. **Start Simple** - Begin with a basic workflow like "send welcome email"
2. **Ask the AI** - Describe what you want in natural language
3. **Test It** - Run your workflow with test data
4. **Iterate** - Add more steps and complexity as needed
5. **Explore Examples** - Check `services/platform/convex/predefined_workflows/` for complete working examples

---

## Need Help?

- **Ask the AI Assistant** - It can help you build and debug workflows
- **Check Execution Logs** - See what happened at each step
- **Test with Small Data** - Start with 1-5 items before scaling up
- **Start Simple** - Build basic workflows first, then add complexity

Happy automating! 🚀





