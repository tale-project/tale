# Full Site Coverage Testing (AI-Directed)

> **Purpose**: Quick validation that all pages load without errors and basic functionality works. Focus on coverage, not deep testing.

## Prerequisites

> **AI Instructions**: Execute the following steps sequentially. Each step must complete successfully before proceeding to the next. If any step fails, stop and report the error.

### Step 1: Kill processes on port 3000

Run this command to free up port 3000:

```bash
lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true
```

**Expected**: Command completes (exit code 0). No output means no process was running.

### Step 2: Stop and clean Docker containers

```bash
docker compose down -v
```

**Expected**: Containers stop and volumes are removed. Output shows "Removed" messages or "No resource found" if nothing was running.

### Step 3: Rebuild and start containers

```bash
docker compose up --build -d
```

**Expected**: All services start successfully. Look for "Started" or "Running" status messages.

**Note**: This may take 5-10 minutes on first run.

### Step 4: Wait for services to be ready

Check that services are healthy:

```bash
docker compose ps
```

**Expected**: All services show "Up" or "healthy" status.

### Step 5: Verify application is accessible

Navigate to `http://localhost:3000` using the browser tool and verify:

- Page loads without connection errors
- No 500/502/503 errors
- Login or homepage content is visible

**If verification fails**: Wait 30 seconds and retry up to 3 times before reporting failure.

### Prerequisites Checklist

| Step | Command/Action                     | Status |
| ---- | ---------------------------------- | ------ |
| 1    | Kill port 3000 processes           | ☐      |
| 2    | `docker compose down -v`           | ☐      |
| 3    | `docker compose up --build -d`     | ☐      |
| 4    | Verify containers healthy          | ☐      |
| 5    | Verify `localhost:3000` accessible | ☐      |

**Proceed to testing only when all prerequisites are ☑**

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

📸 Screenshots: `settings.png`, `integrations.png`

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
Pages Tested: ___/14
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
```
