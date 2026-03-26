---
title: Tale Platform Documentation
description: Setup, features, roles, APIs, and operations for the Tale platform.
---

# Tale Platform Documentation

Tale is an open-source, self-hosted AI platform for teams that want a full-stack AI application they can own, control, and extend. It includes an intelligent chat assistant, a semantic knowledge base, customer conversation management, visual automation workflows, and a structured API layer.

Unlike cloud-only AI products, Tale runs entirely on your own infrastructure. Your data stays on your servers. There are no per-seat fees, no vendor lock-in, and no model restrictions beyond what your API key supports.

## Architecture at a Glance

Tale runs as six Docker services that communicate over an internal network:

| Service | Technology | Role | Local Port |
| --- | --- | --- | --- |
| Platform | Bun + TanStack + Convex | Web UI, real-time backend, auth, data, workflows | 3000 (via proxy) |
| RAG | Python + FastAPI | Document indexing, vector search, answer generation | 8001 |
| Crawler | Python + Playwright + Crawl4AI | Website crawling, URL discovery, file-to-text conversion | 8002 |
| Operator | Python + Playwright + LLM | Browser automation agent for web tasks | 8004 |
| Database | PostgreSQL | Persistent storage for platform data | 5432 |
| Proxy | Caddy | TLS termination and routing | 80 / 443 |

```
┌─────────────────────────────────────────────────────────────┐
│                         Caddy Proxy                          │
│              (Routes traffic to healthy backend)             │
└─────────────────────────┬───────────────────────────────────┘
                          │
        ┌─────────────────┴─────────────────┐
        ▼                                   ▼
┌───────────────────┐               ┌───────────────────┐
│   Blue Services   │               │  Green Services   │
│    (Active)       │               │   (Standby)       │
├───────────────────┤               ├───────────────────┤
│ platform-blue     │               │ platform-green    │
│ rag-blue          │               │ rag-green         │
│ crawler-blue      │               │ crawler-green     │
│ operator-blue     │               │ operator-green    │
└───────────────────┘               └───────────────────┘
        │                                   │
        └─────────────────┬─────────────────┘
                          ▼
              ┌───────────────────┐
              │  Shared Services  │
              │   (Stateful)      │
              ├───────────────────┤
              │ db (TimescaleDB)  │
              │ proxy (Caddy)     │
              └───────────────────┘
```

> **Note:** All communication between services stays on the internal Docker network. Only ports 80 and 443 are exposed publicly through the Caddy proxy. The database (5432) and API services (8001, 8002, 8004) are exposed on the host for local development only.

## Key Capabilities

- AI chat assistant with multi-turn conversations, file attachments, agent selection, and built-in tools
- Semantic knowledge base for documents, websites, products, customers, and vendors
- Customer conversations inbox with AI-assisted replies and bulk actions
- Visual automation builder with LLM steps, conditionals, loops, and scheduling
- Custom AI agents with tailored instructions, knowledge, and tools
- Role-based access control from read-only Member to full Admin
- SSO and integrations including Microsoft Entra ID, REST APIs, OneDrive sync, and SQL connectors
- Production operations with zero-downtime deployments, Prometheus metrics, and Sentry error tracking

## Setup Guide

This section walks you through getting Tale running locally for the first time, and then covers deploying it to a production server. The whole process takes about 15 minutes.

### Prerequisites

#### Required Software

| Software | Minimum Version | Where to Get It |
| --- | --- | --- |
| Docker Desktop | 24.0+ | https://www.docker.com/products/docker-desktop |
| Git | Any recent version | https://git-scm.com |

#### Required API Key

Tale uses OpenRouter as its default AI gateway, which gives you access to hundreds of models through a single API key.

1. Go to https://openrouter.ai and create a free account.
2. Navigate to Keys in your account dashboard and generate a new API key.
3. Copy the key. You will need it in Step 3.

> **Tip:** You can use any OpenAI-compatible provider, including a local Ollama instance, by setting `OPENAI_BASE_URL` and `OPENAI_API_KEY` in your `.env`. OpenRouter is the recommended choice for its model variety and simple pricing.

### Quick Start (Local)

If you are on Windows or want to skip building from source, jump to the pre-built images section instead. It is faster and has the same result.

#### Step 1: Set Up Your Local Domain

Tale uses `tale.local` as its default local address. Add one line to your hosts file so your browser can reach it.

On macOS or Linux:

```bash
sudo sh -c 'echo "127.0.0.1 tale.local" >> /etc/hosts'
```

On Windows, run PowerShell as Administrator:

```powershell
Add-Content -Path "C:\Windows\System32\drivers\etc\hosts" -Value "127.0.0.1 tale.local"
```

#### Step 2: Clone the Repository

```bash
git clone https://github.com/tale-project/tale.git
cd tale
```

#### Step 3: Set Up Your `.env` File

Copy the example environment file:

```bash
cp .env.example .env
```

Open `.env` in any text editor. The file already has placeholder values for everything. You only need to fill in these required ones:

| Variable | Required? | How to Fill It In |
| --- | --- | --- |
| `OPENAI_API_KEY` | Yes | Paste your OpenRouter API key here |
| `BETTER_AUTH_SECRET` | Yes | Generate with: `openssl rand -base64 32` |
| `ENCRYPTION_SECRET_HEX` | Yes | Generate with: `openssl rand -hex 32` |
| `DB_PASSWORD` | Yes | Choose any password for the local database |

> **Important:** The `.env.example` file ships with example secrets that are not safe to use. You must replace `BETTER_AUTH_SECRET` and `ENCRYPTION_SECRET_HEX` with your own generated values before starting. Using the example values is a security risk even in local development.

#### Step 4: Start the Platform

The first time you run this, Docker builds the service images from source. This takes 3 to 5 minutes. Subsequent starts are much faster.

```bash
docker compose up --build
```

Watch the logs. When you see this message, everything is ready:

```text
🎉 Tale Platform is running!
```

> **Note:** You will see a stream of `200 OK` health check messages while services are starting. Those are normal and do not mean the UI is ready. Wait for the ready message before opening your browser.

#### Step 5: Trust the Certificate (Recommended)

Tale generates a self-signed TLS certificate for local development. Your browser will show a security warning the first time you visit. To get rid of it permanently, run:

```bash
docker exec tale-proxy caddy trust
```

Then restart your browser.

#### Step 6: Open the App

Go to https://tale.local in your browser. The first time you open it, you will be taken to a sign-up page to create your admin account.

### Using Pre-Built Images (Recommended for Windows)

This approach skips the local build entirely. Docker pulls pre-built images from GitHub and starts them directly. You only need two files from the repository: `compose.yml` and `.env`.

Add these two lines to your `.env` file:

```dotenv
PULL_POLICY=always
VERSION=latest
```

Then start without the `--build` flag:

```bash
docker compose up
```

> **Tip:** To update Tale to the latest version when using pre-built images, run `docker compose down`, then `docker compose pull`, then `docker compose up`. This fetches new images without affecting your data.

### Daily Workflow

#### Starting the Platform

1. Open Docker Desktop and wait until the engine status shows green.
2. In your terminal, go to the `tale` folder and run `docker compose up`.
3. Wait for the platform ready message, then open https://tale.local.

#### Stopping the Platform

To stop all services while keeping your data:

```bash
docker compose down
```

> **Important:** Never run `docker compose down -v`. The `-v` flag deletes all Docker volumes, which permanently erases your database, uploaded documents, crawler state, and all platform data. There is no recovery from this.

### Production Deployment

#### Option A: Docker Compose

For a single-server production setup, update your `.env` with these values:

```dotenv
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=letsencrypt
TLS_EMAIL=admin@yourdomain.com
PULL_POLICY=always
VERSION=latest
```

Make sure ports 80 and 443 are open on your server firewall. Let's Encrypt will issue and renew TLS certificates automatically.

Then start in detached mode:

```bash
docker compose up -d
```

#### Option B: Zero-Downtime Deployment

For production environments where downtime is not acceptable, Tale ships with a blue-green deployment script. It runs two versions of stateless services at the same time, checks that the new version is healthy, then switches traffic over.

```bash
# Deploy a specific version with no downtime
./scripts/deploy.sh deploy v1.2.0

# Deploy latest version
./scripts/deploy.sh deploy latest

# Roll back to the previous version
./scripts/deploy.sh rollback

# Check which version is currently live
./scripts/deploy.sh status
```

> **Note:** Zero-downtime deployment requires at least 12 GB of RAM on the server because both versions run at the same time during the switchover. The database and proxy are shared and are not duplicated.

### Convex Dashboard Access

Tale includes an embedded Convex backend. The Convex Dashboard lets you inspect the database, view function logs, and manage background jobs.

1. Run this to generate an admin key:

```bash
docker exec tale-platform /app/generate-admin-key.sh
```

2. Copy the key from the output.
3. Open https://tale.local/convex-dashboard in your browser.
4. Paste the admin key when prompted.

> **Note:** The Convex Dashboard gives direct read and write access to all data. Only share admin keys with trusted team members.

## Platform Features

### AI Chat

The AI Chat is the main interface for working with Tale's AI. It is a conversation workspace where you can ask questions, request actions, and explore your data in plain language.

#### Using the Chat

- Access: Navigate to Chat in the left sidebar.
- To start a new conversation, click the plus icon in the top toolbar or use the keyboard shortcut.
- Each conversation is saved to your history and can be searched or renamed later.

#### Sending Messages

Type in the input area at the bottom of the screen. The Enter key sends your message. Use Shift+Enter for a new line within a message. The input area grows automatically as you type.

#### File Attachments

You can attach files to any message by clicking the paperclip icon or dragging files into the chat window. Supported file types include:

- Images: PNG, JPEG, GIF, WebP. The agent analyzes the visual content.
- Documents: PDF, DOCX, XLSX, PPTX, TXT, Markdown. The agent reads the content.
- Code files: JS, TS, Python, and most common source file formats.

Files are uploaded before the message is sent. A loading spinner shows for each file while it uploads.

#### Selecting an Agent

The agent selector is in the bottom-left corner of the input area, shown as a bot icon. Use it to choose which AI agent handles your conversation. The default is the system chat agent. Custom agents your team has built also appear here.

#### Chat History

Click the clock icon in the top toolbar to open the history sidebar. You can:

- Browse all past conversations, grouped by date
- Click a conversation to open it
- Double-click a conversation title to rename it inline
- Use the three-dot menu to rename or delete a conversation
- Search across all conversations with `Ctrl+K` or `Cmd+K` on Mac

#### What the Chat Agent Can Do

The default chat agent can handle:

| Tool Category | What You Can Ask |
| --- | --- |
| Customer lookup | Find customers by email, ID, status, locale, or custom metadata fields |
| Product catalog | Browse products by category, search by name or ID, check stock and pricing |
| Vendor information | Look up vendor details and contact information |
| Knowledge base search | Ask questions that are answered by your uploaded documents and crawled websites |

#### Keyboard Shortcuts

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| New chat | `Alt + Ctrl + N` | `Option + Cmd + N` |
| Search chats | `Ctrl + K` | `Cmd + K` |
| Toggle history sidebar | `Ctrl + H` | `Cmd + H` |

### Knowledge Base

The Knowledge Base is where Tale stores information for the AI to use. Anything you add here becomes searchable by the chat agent using meaning-based search. It is split into five sections, all accessible from the Knowledge tab in the sidebar.

> **Note:** Editing the Knowledge Base requires the Editor role or higher. Members can view all knowledge items but cannot create, update, or delete them.

#### Documents

Documents are the core of the knowledge base. You can upload files directly or sync from Microsoft OneDrive. Once indexed, the content is searchable by the AI agent.

**Uploading Documents**

1. Navigate to Knowledge > Documents.
2. Click the Upload button in the top-right action menu.
3. Drag files into the upload area or click to browse. You can select multiple files at once.
4. Optionally assign the documents to one or more teams. This controls which team-filtered views they appear in.
5. Click Upload. Each file is queued for background processing. A status indicator shows when indexing is done.

Supported file types: PDF, DOCX, PPTX, XLSX, TXT, Markdown, CSV, HTML, JSON, YAML, and most code file formats.

Maximum file size: 100 MB per file.

**Folder Organization**

Documents can be organized into folders. Use the breadcrumb navigation at the top of the Documents table to move between folders. You can create folders during upload or from the action menu.

**Microsoft OneDrive Sync**

If a Microsoft account integration is configured, a Sync from OneDrive option appears in the action menu. This imports documents directly from OneDrive without downloading them to your server first.

#### Websites

Website tracking tells Tale's crawler to visit and index pages from a given domain on a schedule. Once indexed, the AI agent can answer questions about that site's content.

**Adding a Website**

1. Navigate to Knowledge > Websites and click Add Website.
2. Enter the full URL of the website, for example `https://docs.example.com`.
3. Select a scan interval. This controls how often the crawler re-checks for updated content.
4. Click Add. The crawler fetches the homepage right away and starts finding linked pages.

| Scan Interval | Best For |
| --- | --- |
| Every hour | Sites with frequent content changes |
| Every 6 hours (default) | Documentation sites and company wikis |
| Every day | Marketing sites and blogs |
| Every 7 days | Reference sites with infrequent updates |

#### Products

The Products section stores your product catalog. Each product record includes a name, description, image URL, stock level, price, currency, category, and status.

Products can be added one at a time or imported in bulk via CSV. The CSV format has no header row, with columns in this order:

```text
name, description, imageUrl, stock, price, currency, category, status
```

Valid status values: `active`, `inactive`, `draft`, `archived`. Invalid values fall back to `draft`.

#### Customers

The Customers section stores your customer list. Each customer has an email address, locale, status, and optional custom metadata. Imported customers are set to a status of `churned` by default.

Import via CSV with this format:

```text
email, locale
```

Valid locale values: `en`, `de`, `es`, `fr`, `it`, `nl`, `pt`, `zh`. Invalid locales fall back to `en`.

#### Vendors

The Vendors section stores supplier and partner records. Vendor data is searchable by the AI agent and can be referenced in automated workflows. The same CSV import that works for customers also works here.

### Conversations

Conversations is the customer inbox. When customers contact your team through a connected channel such as email, their messages appear here as conversation threads. Your team can read, reply, close, and manage them from this one view.

#### Conversation Statuses

| Status | Meaning |
| --- | --- |
| Open | Active conversation that needs a response or is in progress |
| Closed | Conversation that has been resolved and marked as done |
| Spam | Messages flagged as unsolicited or irrelevant |
| Archived | Conversations kept for reference but removed from the active inbox |

#### Replying to a Conversation

1. Click any conversation in the list to open it in the right panel.
2. The message composer loads at the bottom. It is a rich-text editor that supports bold, italic, lists, links, and code blocks.
3. Write your reply. You can attach files using the paperclip icon in the toolbar.
4. Use the AI Improve button, if enabled, to have the AI clean up your message before sending.
5. Click Send. The message is sent through whichever channel the customer used.

#### Bulk Actions

Select multiple conversations using the checkbox at the top of the list. Available bulk actions:

- Change status: close, reopen, archive, or mark as spam
- Assign to a team
- Send a message to all selected conversation participants at once

#### Priority Filtering

Use the filter dropdown in the toolbar to show conversations by priority. This helps surface urgent threads without scrolling through the full inbox.

### Approvals

The Approvals queue holds actions that need a human to review before they run. Automations and AI agents can be set up to pause at certain steps and wait for approval instead of acting on their own.

#### Reviewing an Approval

1. Navigate to Approvals > Pending.
2. Click any approval to see the full context: which workflow triggered it, what action it wants to take, and what data it would use.
3. Click Approve to let it proceed, or Reject to cancel it.
4. All resolved approvals, approved and rejected, are available in the Resolved tab for reference.

### Automations

Automations let you define and run multi-step business processes without writing backend code. A workflow is a series of steps. Each step does one thing, and steps are connected to form a complete process.

#### Creating a Workflow

There are two ways to create a workflow:

##### Option 1: AI-Assisted Creation

1. Navigate to Automations and click New Automation.
2. Enter a name and a description of what the workflow should do. The more detail you add, the better the AI can build the initial steps.
3. Click Continue. The platform creates the workflow and opens the AI Chat panel on the right where you can refine things in conversation.

##### Option 2: Manual Visual Editor

1. Create a new workflow as above but leave the description blank.
2. Use the Add Step button on the workflow canvas to add steps one at a time.
3. Configure each step using the side panel that appears when you click on a step.
4. Connect steps by clicking the connector handles and drawing lines between them.

#### Step Types

| Step Type | Color | What It Does |
| --- | --- | --- |
| Trigger | Teal | The entry point of the workflow. Defines when it starts, such as schedule, event, webhook, or manual run |
| Action | Blue | Runs an operation such as create a record, send a message, call an API, or update data |
| LLM | Purple | Sends a prompt to an AI model and passes the response to the next step |
| Condition | Orange | Checks a condition and routes execution down different branches |
| Loop | Green | Repeats a set of steps for each item in a list |

#### Triggers

Every workflow needs at least one trigger to know when to run.

##### Schedule Triggers

Run the workflow on a time schedule. You can enter a cron expression directly or use the AI assistant to generate one from plain English, such as “every weekday at 9am”.

All schedules run in UTC. Quick presets are available for every 5 minutes, hourly, daily, weekly, and monthly.

##### Event Triggers

Run the workflow when something happens in the platform, for example when a new customer is added, a conversation is opened, or a product's stock hits zero. Each event type can have optional filter conditions.

##### Webhook Triggers

Each workflow gets a unique webhook URL. Sending an HTTP POST to this URL with a JSON body starts the workflow with that data as input. You can add a webhook secret to verify that incoming requests are genuine.

#### Workflow Configuration

Navigate to a workflow's Configuration tab to adjust:

- Active toggle: enable or disable the workflow. Draft workflows cannot be activated until they are published first.
- Timeout: maximum time in milliseconds a workflow is allowed to run before being stopped. Default is 300,000 ms (5 minutes).
- Max retries: how many times a failed step will be retried before the whole workflow fails. Default is 3.
- Backoff: delay in milliseconds between retry attempts. Default is 1,000 ms.
- Variables: a JSON object of key-value pairs that are available to all steps as shared configuration data.

#### Testing a Workflow

Use the Test panel, available from the side panel in the workflow editor, to:

- Dry Run: shows which steps would run and in what order, without actually executing anything
- Execute: triggers a real run with test input data. Check the Executions tab to see the result

#### Execution History

Navigate to the Executions tab of any workflow to see a log of all past runs, including start time, duration, status, and the input and output data at each step.

### Custom Agents

Custom Agents are specialized AI assistants you configure for specific tasks. Unlike the default chat agent, which is general-purpose, a custom agent has its own instructions, a defined set of knowledge it can access, a specific AI model, and optional tool restrictions.

#### Creating a Custom Agent

1. Navigate to Custom Agents in the sidebar.
2. Click New Agent.
3. Enter a Display Name shown in the agent selector and an Internal Name, a URL-safe slug used in API calls such as `support-agent`.
4. Optionally add a description, then click Create.
5. You will land on the agent configuration page where you can set up its Instructions, Knowledge, Tools, and Webhook.

#### Instructions Tab

This is the most important tab. It defines what the agent knows, how it behaves, and what it can do.

- System Instructions: the prompt sent to the model before every conversation. Use this to define the agent's role, tone, what topics it should and should not cover, and how it should format its answers.
- Model Preset: choose between Fast, Standard, and Advanced. Your admin's model configuration determines which models are in each tier.
- File Preprocessing: when on, attached files are processed with vision AI before being passed to the agent, which helps with image-heavy or scanned documents.
- Structured Responses: when on, the agent formats its answers with consistent structure such as sections and lists instead of free-form text.

Changes on this tab are saved automatically. A save indicator in the top-right shows the current status.

#### Knowledge Tab

Controls which parts of the knowledge base this agent can access. By default, agents can search all organization knowledge. You can restrict it to specific document folders, product categories, or team-scoped data.

#### Tools Tab

Controls which platform capabilities the agent can use. Toggle individual tools on or off. For example, a support-only agent might have web browsing turned off but customer lookup turned on.

#### Webhook Tab

Each custom agent gets a unique webhook endpoint. You can POST a message and conversation context to this URL to get a response from the agent without using the platform UI. This is useful for integrating the agent into external products or chat widgets.

#### Versioning

Custom agents support versioning. When you edit an agent's instructions, a draft version is created. The live version keeps serving requests until you publish the draft. The version history dialog shows all past versions and lets you compare or roll back.

### Settings

#### Organization Settings

Accessible to Admins only. Configure organization-wide settings and manage team members.

##### Organization Name

The organization name appears in the sidebar, emails, and notification headers. Edit the name field and click Save Changes to update it.

##### Member Management

The member table lists all users in the organization with their email, display name, role, and join date. Admins can:

- Add members: enter an email, optional password, display name, and role. If the email already exists in Tale, the user is added to the organization without creating a new account.
- Edit members: change a member's display name, role, or set a new password for them.
- Remove members: removes the member from the organization. Their account is not deleted.

#### Teams

Teams let you organize members and control knowledge base visibility. A document or conversation tagged to a team only appears when that team is active in the filter. Teams are managed from the Teams settings tab, Admin only.

#### Integrations

Configure connections to external services. Tale supports the following integration types:

##### REST API Integrations

Connect any HTTP-based API by entering the base URL and credentials. Supported authentication methods:

- API Key: pass a key in a header or query parameter
- Bearer Token: `Authorization: Bearer <token>`
- Basic Auth: username and password
- OAuth 2.0: authorization code flow with automatic token refresh

##### SQL Integrations

Connect a PostgreSQL or MySQL database. The AI agent and automations can query it using plain language that is translated to SQL.

##### Email (Conversations)

Connect an email account to enable the Conversations inbox. Incoming emails become conversation threads. Replies sent from the platform are delivered as normal email responses.

##### Microsoft OneDrive

Connect a Microsoft account to enable OneDrive document sync. Users can then import files from OneDrive directly into the Knowledge Base.

#### API Keys

Generate API keys for programmatic access to the Tale API. Keys have the same permissions as the user who created them, scoped to their role. Keys can be revoked at any time from this tab.

#### Branding

Customize the look of the platform for your organization. Admin only. Available options:

- Application Name: replaces "Tale" in the browser tab and header
- Logo: upload an image to replace the default logo in the navigation bar
- Favicon: upload a custom favicon for the browser tab, with separate images for light and dark mode
- Brand Color: the primary color used for buttons and active states
- Accent Color: secondary color used for highlights and badges

#### Account Settings

Available to all users. Change your password here. If you signed up via SSO, you can also set a regular password from this page to enable direct login.

#### Audit Logs

Admin only. A time-ordered record of significant actions taken in the organization, including member changes, integration updates, workflow publications, and settings changes. Useful for compliance and troubleshooting.

## Roles and Permissions

Tale uses five roles. Every user belongs to exactly one role within an organization. The same person can have different roles in different organizations.

### Role Overview

| Role | Who It's For |
| --- | --- |
| Admin | Full control over the organization. Manages members, settings, integrations, and all content. |
| Developer | For engineers and integration builders. Full data access but cannot manage members or organization settings. |
| Editor | For content and customer service staff. Creates knowledge base content, handles conversations, and approves actions. |
| Member | Read-only access. Can use AI chat to explore data but cannot create or edit content. |

### Permission Matrix

#### AI Chat

| Feature | Member | Editor | Developer | Admin |
| --- | --- | --- | --- | --- |
| Create and send messages | ✓ | ✓ | ✓ | ✓ |
| View own chat history | ✓ | ✓ | ✓ | ✓ |
| Delete and rename conversations | ✓ | ✓ | ✓ | ✓ |
| Select custom agent | ✓ | ✓ | ✓ | ✓ |

#### Knowledge Base

| Feature | Member | Editor | Developer | Admin |
| --- | --- | --- | --- | --- |
| View all knowledge items | ✓ | ✓ | ✓ | ✓ |
| Upload / edit / delete documents | — | ✓ | ✓ | ✓ |
| Manage products, customers, vendors | — | ✓ | ✓ | ✓ |
| Add and configure website crawling | — | ✓ | ✓ | ✓ |

#### Conversations

| Feature | Member | Editor | Developer | Admin |
| --- | --- | --- | --- | --- |
| View conversations | ✓ | ✓ | ✓ | ✓ |
| Reply to customers | — | ✓ | ✓ | ✓ |
| Close / reopen / archive conversations | — | ✓ | ✓ | ✓ |
| Mark as spam | — | ✓ | ✓ | ✓ |

#### Approvals

| Feature | Member | Editor | Developer | Admin |
| --- | --- | --- | --- | --- |
| View pending approvals | ✓ | ✓ | ✓ | ✓ |
| Approve or reject actions | — | ✓ | ✓ | ✓ |

#### Automations and Custom Agents

| Feature | Member | Editor | Developer | Admin |
| --- | --- | --- | --- | --- |
| View automation list | — | — | ✓ | ✓ |
| Create and edit automations | — | — | ✓ | ✓ |
| Publish and activate automations | — | — | ✓ | ✓ |
| View execution logs | — | — | ✓ | ✓ |

#### Integrations and API

| Feature | Member | Editor | Developer | Admin |
| --- | --- | --- | --- | --- |
| View integrations | — | — | ✓ | ✓ |
| Configure integrations | — | — | ✓ | ✓ |
| Generate and revoke API keys | — | — | ✓ | ✓ |

#### Organization Administration

| Feature | Member | Editor | Developer | Admin |
| --- | --- | --- | --- | --- |
| View organization settings | — | — | — | ✓ |
| Edit organization name and branding | — | — | — | ✓ |
| Add and remove members | — | — | — | ✓ |
| Change member roles | — | — | — | ✓ |

### SSO Configuration

Tale supports Microsoft Entra ID, formerly Azure AD, as a single sign-on provider, so your users can log in with their existing Microsoft accounts.

#### Enabling SSO

1. Go to Settings > Integrations.
2. Find the SSO section and enter your Entra ID details: client ID, tenant ID, and client secret.
3. Add the redirect URI in your Azure app registration: `https://yourdomain.com/http_api/api/sso/callback`
4. Save and test the connection. The SSO button will appear on the login page.

> **Note:** SSO and password login can be used at the same time. Users who joined before SSO was set up can keep using their passwords. Users who sign in via SSO can optionally add a password from Account Settings.

## API Reference

Each Tale service has its own REST API. These are used internally between services but are also available for direct integration with external systems.

### Interactive API Documentation

All Python-based services have a Swagger UI for exploring and testing the API:

| Service | Swagger UI URL | OpenAPI JSON |
| --- | --- | --- |
| RAG | http://localhost:8001/docs | http://localhost:8001/openapi.json |
| Crawler | http://localhost:8002/docs | http://localhost:8002/openapi.json |
| Operator | http://localhost:8004/docs | http://localhost:8004/openapi.json |

### RAG API

The RAG API handles document indexing and search. It is the engine behind the knowledge base.

#### Add a Document

```http
POST /api/v1/documents
```

```json
{
  "content": "Your document text here...",
  "document_id": "optional-custom-id",
  "team_ids": ["team-abc123"],
  "metadata": { "source": "manual", "category": "policy" }
}
```

Document indexing runs in the background. The response includes a `job_id` you can use to check progress.

#### Upload a File

```http
POST /api/v1/documents/upload
Content-Type: multipart/form-data
```

```text
file:      <binary file data>
team_ids:  "team-abc123"
metadata:  '{"source": "upload"}'  (optional JSON string)
```

#### Search the Knowledge Base

```http
POST /api/v1/search
```

```json
{
  "query": "What is our return policy?",
  "team_ids": ["team-abc123"],
  "top_k": 5,
  "similarity_threshold": 0.0
}
```

#### Check Indexing Job Status

```http
GET /api/v1/jobs/{job_id}
```

Job states: `queued`, `running`, `completed`, `failed`. Keep checking this endpoint until the state is `completed` or `failed`.

### Crawler API

#### Register a Website for Crawling

```http
POST /api/v1/websites
```

```json
{
  "domain": "https://docs.example.com",
  "scan_interval": 21600
}
```

`scan_interval` is in seconds. Minimum value is 60.

#### Fetch Page Content

```http
POST /api/v1/urls/fetch
```

```json
{
  "urls": ["https://docs.example.com/guide"],
  "word_count_threshold": 100
}
```

Returns cached content when available, or fetches it live if not.

### Platform API

The Platform service exposes a public API at `/api/v1/*` for programmatic access to your data. Authenticate using a Bearer token from Settings > API Keys.

Full API documentation: `https://yourdomain.com/api/v1/openapi.json`

## Operations

### Monitoring

All Tale services expose a Prometheus `/metrics` endpoint on the internal Docker network. To enable access from outside, set a bearer token in your `.env` file:

```dotenv
METRICS_BEARER_TOKEN=your-secret-token-here
```

Metrics are then available at these endpoints:

| Service | Metrics Endpoint |
| --- | --- |
| Crawler | `https://yourdomain.com/metrics/crawler` |
| RAG | `https://yourdomain.com/metrics/rag` |
| Operator | `https://yourdomain.com/metrics/operator` |
| Platform (Express) | `https://yourdomain.com/metrics/platform` |

> **Note:** The Convex backend exposes over 260 built-in metrics covering query latency, mutation throughput, and scheduler performance.

### Error Tracking

Tale supports Sentry and compatible alternatives such as GlitchTip for error tracking. Set your DSN in `.env`:

```dotenv
SENTRY_DSN=https://your-key@your-sentry-host/project-id
```

If `SENTRY_DSN` is not set, error tracking is off and errors only appear in Docker logs.

### Viewing Logs

All service logs go to Docker stdout with automatic rotation at 10 MB per file, keeping 3 files per service.

```bash
# Stream all service logs
docker compose logs -f

# Stream logs for a specific service
docker compose logs -f rag

# View recent logs without streaming
docker compose logs --tail=100 platform
```

### Database Backups

To create a database snapshot:

```bash
docker exec tale-db pg_dump -U tale tale > backup-$(date +%Y%m%d).sql
```

To restore from a backup:

```bash
docker exec -i tale-db psql -U tale tale < backup-20260101.sql
```

### Health Checks

Each service has a health check endpoint:

| Endpoint | What It Checks |
| --- | --- |
| `GET /health` | Proxy is running and listening |
| `GET /api/health` | Platform is up and Convex backend is reachable |
| `http://localhost:8001/health` | RAG service is running and database pool is connected |
| `http://localhost:8002/health` | Crawler service and browser engine are ready |
| `http://localhost:8004/health` | Operator service is running |

## Troubleshooting

### Common Issues

#### "Docker Engine not found" on Windows

This means Docker Desktop is not running. Open Docker Desktop from the Start menu or system tray, wait for the engine to show green, then try your command again.

#### Browser Shows Certificate Warning

Tale uses a self-signed certificate for local development. You can click through the browser warning or remove it permanently by running:

```bash
docker exec tale-proxy caddy trust
```

Then restart your browser.

#### Platform Does Not Load After `docker compose up`

Wait for the platform ready message in the logs. This can take up to two minutes. The `200 OK` health check messages that appear before it do not mean the UI is ready.

#### AI Responses Are Slow or Failing

Check your `OPENAI_API_KEY` in `.env`. Common causes:

- Expired or revoked API key. Regenerate it at openrouter.ai.
- Insufficient credits on your OpenRouter account.
- The model set in `OPENAI_MODEL` is not available on your account tier.
- Network issue between the Tale server and the OpenRouter API.

#### Documents Are Not Searchable After Upload

Document indexing runs in the background. After uploading, the RAG service extracts text, splits it into chunks, generates embeddings, and writes to the database. Large files such as multi-hundred-page PDFs can take several minutes. Check the status indicator in Knowledge > Documents to see the current state.

#### Website Crawling Shows No Pages

After adding a website, the crawler does an initial pass of the homepage and any links it finds. This takes a few minutes depending on site size. If the page count stays at 0, check `docker compose logs crawler` for errors. Common causes are SSL issues on the target site or `robots.txt` blocks.

#### Forgot Admin Password

If you are locked out of your admin account, another admin can reset your password from Settings > Organization > member row > Edit > Set Password. If no admins are available, someone with Docker access can use the Convex Dashboard to update the user record directly.

### Getting Help

- Logs: `docker compose logs -f` is always the first place to look
- GitHub Issues: https://github.com/tale-project/tale/issues
- Convex Dashboard: useful for inspecting raw data and function logs when debugging backend problems
- API Docs: `http://localhost:8001/docs`, `/8002/docs`, `/8004/docs`
