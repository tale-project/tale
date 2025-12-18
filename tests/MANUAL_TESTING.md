# Manual Testing Guide (AI-Directed)

> **🤖 AI AGENT INSTRUCTIONS**: This document is designed for AI agents to execute automated manual testing. Follow each step sequentially, take screenshots at designated points, and store all evidence in the specified folder structure.

## Screenshot Storage Requirements

**Before starting any tests, create a screenshot folder with the following naming convention:**

```text
tests/screenshots/YYYY-MM-DD_HH_mm/
```

- `YYYY-MM-DD` = Current date (e.g., `2025-12-18`)
- `HH` = Current hour in 24-hour format (e.g., `14` for 2 PM)

**Example folder path:** `tests/screenshots/2025-12-18_14_31/`

**Screenshot naming convention:** `{step_number}_{description}.png`
- Example: `01_homepage.png`, `03_account_created.png`, `06a_customer_sync_started.png`

**⚠️ IMPORTANT - Screenshot Storage Instructions for AI Agents:**
- **DO NOT** save screenshots to temporary directories (e.g., `/tmp/playwright-mcp-output/`)
- **ALWAYS** save screenshots directly to the target directory: `tests/screenshots/YYYY-MM-DD_HH/`
- Use the full relative path from the workspace root when specifying the filename parameter
- After taking all screenshots, verify they exist in the target directory using `ls -lh tests/screenshots/YYYY-MM-DD_HH/`
- If screenshots are saved to temporary locations, copy them to the target directory immediately using `cp` command

---

## Prerequisites

- Docker and Docker Compose installed
- Access to `.test.env` file with Circuly test credentials
- Browser automation capability (Playwright MCP tools)

---

## Testing Steps

### 1. Clean Start

**Action:** Stop and remove all containers and volumes.

```bash
docker compose down -v
```

**Verification:** Confirm command completes without errors.

---

### 2. Build and Start Services

**Action:** Build and start all services in detached mode.

```bash
docker compose up --build -d
```

**Verification:** Wait for services to be healthy. Check with `docker compose ps`.

---

### 3. Create Account and Organization

**Actions:**
1. Navigate to `http://localhost:3000`
2. 📸 **SCREENSHOT:** `03a_homepage.png` - Capture the landing/login page
3. Click on "Sign Up" or "Create Account" link to navigate to the registration page
4. 📸 **SCREENSHOT:** `03b_signup_page.png` - Capture the sign up form

**Account Creation (Email & Password):**

1. Generate test credentials using the following format:
  - **Email:** `test-{timestamp}@example.com` (e.g., `test-1734567890@example.com`)
  - **Password:** `TestPassword123!` (or any strong password with uppercase, lowercase, number, and special character)
  - **Name:** `Test User` (if required)
2. Fill in the sign-up form:
  - Enter the generated email address in the email field
  - Enter the password in the password field
  - Enter password confirmation if required
  - Fill in any additional required fields (name, etc.)
3. 📸 **SCREENSHOT:** `03c_signup_form_filled.png` - Capture the filled sign-up form (before submission)
4. Click the "Sign Up" / "Create Account" / "Register" button to submit the form
5. 📸 **SCREENSHOT:** `03d_account_created.png` - Capture successful account creation confirmation

**Organization Setup:**
10. After account creation, you may be prompted to create an organization
11. Enter organization name: `Test Organization` (or similar)
12. Complete any additional organization setup steps
13. 📸 **SCREENSHOT:** `03e_organization_created.png` - Capture the organization dashboard

**Verification:**
- User is logged in successfully
- Organization is visible in the UI
- No error messages are displayed

**⚠️ Note for AI Agents:** Store the generated email and password for potential use in later test steps if re-login is required.

---

### 4. Test Chatbot

**Actions:**
1. Navigate to the chat page
2. 📸 **SCREENSHOT:** `04a_chat_page.png` - Capture the empty chat interface
3. Send a test message: "Hello, can you help me?"
4. Wait for the chatbot to respond
5. 📸 **SCREENSHOT:** `04b_chatbot_response.png` - Capture the conversation with response

**Verification:** Chatbot responds with a coherent message.

---

### 5. Connect Circuly Integration

**Actions:**
1. Navigate to **Settings > Integrations**
2. 📸 **SCREENSHOT:** `05a_integrations_page.png` - Capture the integrations page
3. Click to connect Circuly
4. Read credentials from `.test.env`:
   - `CIRCULY_TEST_USERNAME`
   - `CIRCULY_TEST_PASSWORD`
5. Enter credentials and connect
6. 📸 **SCREENSHOT:** `05b_circuly_connected.png` - Capture successful connection status

**Verification:** Circuly shows as "Connected" in the integrations list.

---

### 6. Run Circuly Automations

**Navigate to the Automations page and click into the Circuly automation.**

#### 6a. Sync Customers

**Actions:**
1. Find and trigger the **Sync Customers** automation
2. 📸 **SCREENSHOT:** `06a_customer_sync_started.png` - Capture automation trigger
3. Go to the Executions tab
4. Wait for execution to complete (poll status every 10 seconds)
5. 📸 **SCREENSHOT:** `06a_customer_sync_success.png` - Capture successful completion

**Verification:** Execution status shows "Success". **Do NOT proceed until this succeeds.**

#### 6b. Sync Products

**Actions:**
1. Trigger the **Sync Products** automation
2. 📸 **SCREENSHOT:** `06b_product_sync_started.png` - Capture automation trigger
3. Monitor execution progress in the Executions tab
4. Wait for completion
5. 📸 **SCREENSHOT:** `06b_product_sync_success.png` - Capture successful completion

**Verification:** Execution status shows "Success". **Do NOT proceed until this succeeds.**

#### 6c. Sync Subscriptions

**Actions:**
1. Trigger the **Sync Subscriptions** automation
2. 📸 **SCREENSHOT:** `06c_subscription_sync_started.png` - Capture automation trigger
3. Monitor execution progress
4. Wait for completion
5. 📸 **SCREENSHOT:** `06c_subscription_sync_success.png` - Capture successful completion

**Verification:** Execution status shows "Success".

---

### 7. Verify Synced Data

**Actions:**
1. Navigate to the **Knowledge** tab
2. Go to **Customers** page
3. 📸 **SCREENSHOT:** `07a_customers_list.png` - Capture customers list showing synced data
4. Navigate to **Products** page
5. 📸 **SCREENSHOT:** `07b_products_list.png` - Capture products list showing synced data

**Verification:** Both pages show populated data (not empty lists).

---

### 8. Product Recommendation Automation

**Actions:**
1. Navigate to the **Automations** page
2. Find the **General Product Recommendation** automation
3. Trigger the automation
4. 📸 **SCREENSHOT:** `08a_recommendation_started.png` - Capture automation trigger
5. Monitor execution and wait for completion
6. 📸 **SCREENSHOT:** `08b_recommendation_success.png` - Capture successful completion

**Verification:** Execution status shows "Success".

---

### 9. Approve Product Recommendation

**Actions:**
1. Navigate to the **Approvals** page
2. 📸 **SCREENSHOT:** `09a_approvals_list.png` - Capture approvals page showing pending items
3. Verify there is at least one pending approval
4. Click on the pending approval to review
5. 📸 **SCREENSHOT:** `09b_approval_detail.png` - Capture approval details
6. Click to approve the recommendation
7. 📸 **SCREENSHOT:** `09c_approval_confirmed.png` - Capture confirmation of approval

**Verification:** Approval is processed and status changes to "Approved".

---

### 10. Trigger Product Recommendation Email

**Actions:**
1. Navigate to the **Conversations** page
2. Find the product recommendation email automation
3. Trigger the email process
4. 📸 **SCREENSHOT:** `10a_email_triggered.png` - Capture email automation trigger
5. Wait for execution to complete
6. 📸 **SCREENSHOT:** `10b_email_success.png` - Capture successful completion

**Verification:** Email automation executes successfully.

---

### 11. Verify Email Conversation

**Actions:**
1. Navigate to the **Conversations** page
2. 📸 **SCREENSHOT:** `11a_conversations_list.png` - Capture conversations list showing new conversation
3. Verify there is a new open conversation
4. Click into the conversation
5. 📸 **SCREENSHOT:** `11b_conversation_detail.png` - Capture conversation with pending email in input area

**Verification:**
- A new open conversation exists
- There is a pending/draft email visible in the input text area

---

## Test Completion Summary

**After all tests complete, create a summary:**

📸 **FINAL SCREENSHOT:** `99_test_summary.png` - Capture final state of the application

**Report the following:**
- Total screenshots captured
- Any failed steps (with screenshot evidence)
- Overall test status: PASS / FAIL

---

## Troubleshooting

| Issue | Action |
|-------|--------|
| Services fail to start | Run `docker compose logs -f` and capture output |
| Automations fail | Check Executions tab, 📸 capture error details |
| Missing environment variables | Verify `.test.env` file exists and is properly formatted |
| UI elements not found | Wait additional time, refresh page, then retry |

**On any failure:**
1. 📸 Take a screenshot of the error state
2. Name it: `ERROR_{step_number}_{description}.png`
3. Continue with remaining tests if possible
4. Report all failures in the final summary

