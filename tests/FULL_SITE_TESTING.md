# Full Site Coverage Testing (AI-Directed)

> **Purpose**: Quick validation that all pages load without errors and basic functionality works. Focus on coverage, not deep testing.

## Prerequisites

- Kill any processes using port 3000: `lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true`
- Docker services running (`docker compose up -d`)
- Application accessible at `http://localhost:3000`

## Screenshot Setup

```bash
# Create screenshot folder
mkdir -p tests/screenshots/$(date +%Y-%m-%d_%H_%M)
```

Screenshot naming: `{page_name}.png` (e.g., `homepage.png`, `chat.png`)

---

## Test Checklist

### 1. Authentication Pages

| Page           | URL        | Verify                        |
| -------------- | ---------- | ----------------------------- |
| Homepage/Login | `/`        | Page loads, no console errors |
| Sign Up        | `/sign-up` | Form displays correctly       |
| Sign In        | `/sign-in` | Form displays correctly       |

**Action**: Create a test account if needed:

- Email: `protel-test@example.com`
- Password: `TestPassword123!`

📸 Screenshot: `auth.png`

---

### 2. Main Navigation Pages

After login, visit each page and verify it loads without errors:

| Page          | Path                            | Verify                           |
| ------------- | ------------------------------- | -------------------------------- |
| Dashboard     | `/dashboard/[id]`               | Page loads, main content visible |
| Chat          | `/dashboard/[id]/chat`          | Chat interface displays          |
| Conversations | `/dashboard/[id]/conversations` | List/table loads                 |
| Approvals     | `/dashboard/[id]/approvals`     | List/table loads                 |
| Automations   | `/dashboard/[id]/automations`   | Automation cards display         |

📸 Screenshots: `dashboard.png`, `chat.png`, `conversations.png`, `approvals.png`, `automations.png`

---

### 3. Knowledge Section

| Page      | Path                        | Verify                        |
| --------- | --------------------------- | ----------------------------- |
| Products  | `/dashboard/[id]/products`  | Table or empty state displays |
| Customers | `/dashboard/[id]/customers` | Table or empty state displays |
| Documents | `/dashboard/[id]/documents` | Table or empty state displays |
| Websites  | `/dashboard/[id]/websites`  | Table or empty state displays |

📸 Screenshots: `products.png`, `customers.png`, `documents.png`, `websites.png`

---

### 4. Settings Section

| Page             | Path                                    | Verify                    |
| ---------------- | --------------------------------------- | ------------------------- |
| General Settings | `/dashboard/[id]/settings`              | Settings form loads       |
| Integrations     | `/dashboard/[id]/settings/integrations` | Integration list displays |
| Team             | `/dashboard/[id]/settings/team`         | Team members list loads   |
| Billing          | `/dashboard/[id]/settings/billing`      | Billing info displays     |

📸 Screenshots: `settings.png`, `integrations.png`, `team.png`, `billing.png`

---

### 5. Basic Functionality Checks

| Feature      | Action                         | Expected                     |
| ------------ | ------------------------------ | ---------------------------- |
| Chat         | Send "Hello"                   | Response received (no error) |
| Navigation   | Click sidebar items            | Pages switch correctly       |
| Theme Toggle | Click theme button (if exists) | Theme changes                |

---

## Verification Steps

For each page:

1. Navigate to the page
2. Wait for page to fully load (loading spinners gone)
3. Check browser console for errors (`browser_console_messages`)
4. Take screenshot
5. Move to next page

**Pass Criteria**:

- Page renders without crash
- No critical console errors (ignore warnings)
- Main content area displays something (data or empty state)

---

## Test Summary

After completing all checks:

```
Pages Tested: ___/17
Pages with Errors: ___
Screenshots Captured: ___

Status: PASS / FAIL
```

**If errors found**, note:

- Page URL
- Error message (from console or UI)
- Screenshot filename

---

## Quick Reference - All Pages

```
/
/sign-up
/sign-in
/dashboard/[id]
/dashboard/[id]/chat
/dashboard/[id]/conversations
/dashboard/[id]/approvals
/dashboard/[id]/automations
/dashboard/[id]/products
/dashboard/[id]/customers
/dashboard/[id]/documents
/dashboard/[id]/websites
/dashboard/[id]/settings
/dashboard/[id]/settings/integrations
/dashboard/[id]/settings/team
/dashboard/[id]/settings/billing
```
