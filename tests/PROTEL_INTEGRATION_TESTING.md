# Protel PMS Integration Testing Guide (AI-Directed)

> **AI AGENT INSTRUCTIONS**: Execute automated testing of the Protel PMS SQL integration. Follow steps sequentially, take screenshots at designated points, and store evidence in `.playwright-mcp/tests/`.

> **Tip:** For best results, execute all chat-based operations (Steps 5-6) within the same browser session and chat thread. This preserves conversational context, allowing natural references like "the guest we just created" or "our test reservation" without re-querying entity IDs.

## Overview

Tests the Protel PMS SQL integration covering:
- Pre-test cleanup of previous test data
- Account and organization setup
- Protel integration connection via SQL credentials
- AI chat agent testing of all Protel operations

---

## Prerequisites

- Kill any processes using port 3000: `lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true`
- Docker and Docker Compose installed
- Access to `.env` file with Protel test credentials (project root)
- Browser automation capability (Playwright MCP tools)
- Node.js with dependencies installed in `services/platform`

**Install dependencies:**
```bash
cd /home/larry/Documents/tale/services/platform && npm ci
```

**Protel Credentials (from `.env`):**

| Variable | Description |
|----------|-------------|
| `PROTO_SERVER_ADDRESS` | SQL Server address |
| `PROTO_DATABASE` | Database name |
| `PROTO_USER_NAME` | SQL username |
| `PROTO_USER_PASSWORD` | SQL password |

---

## Pre-Test Setup (MANDATORY)

### 1. Clear Screenshot Folder

**Action:** Remove previous test screenshots.

```bash
rm -rf /home/larry/Documents/tale/.playwright-mcp/tests && mkdir -p /home/larry/Documents/tale/.playwright-mcp/tests
```

### 2. Database Cleanup

**Action:** Run cleanup script from `services/platform` directory to remove test data.

```bash
cd /home/larry/Documents/tale/services/platform && node -e "
const sql = require('mssql');

async function cleanupTestData() {
  const config = {
    server: process.env.PROTO_SERVER_ADDRESS,
    database: process.env.PROTO_DATABASE,
    user: process.env.PROTO_USER_NAME,
    password: process.env.PROTO_USER_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true }
  };

  try {
    console.log('Connecting to Protel database...');
    await sql.connect(config);
    console.log('Connected successfully!\n');

    let totalDeleted = 0;

    console.log('=== Cleaning up test postings (leist) ===');
    const postingsResult = await sql.query(\`
      DELETE FROM proteluser.leist WHERE buchnr IN (
        SELECT buchnr FROM proteluser.buch WHERE kundennr IN (
          SELECT kdnr FROM proteluser.kunden
          WHERE name1 = 'TestGuest' OR name1 = 'Test Corp International'
             OR email LIKE '%testguest@example.com%' OR email LIKE '%testcorp.com%'
        )
      )
    \`);
    console.log('  Deleted ' + postingsResult.rowsAffected[0] + ' test postings');
    totalDeleted += postingsResult.rowsAffected[0];

    console.log('\n=== Cleaning up test reservations (buch) ===');
    const reservationsResult = await sql.query(\`
      DELETE FROM proteluser.buch WHERE kundennr IN (
        SELECT kdnr FROM proteluser.kunden
        WHERE name1 = 'TestGuest' OR name1 = 'Test Corp International'
           OR email LIKE '%testguest@example.com%' OR email LIKE '%testcorp.com%'
      )
    \`);
    console.log('  Deleted ' + reservationsResult.rowsAffected[0] + ' test reservations');
    totalDeleted += reservationsResult.rowsAffected[0];

    console.log('\n=== Cleaning up test guest profiles (kunden) ===');
    const guestsResult = await sql.query(\`
      DELETE FROM proteluser.kunden
      WHERE name1 = 'TestGuest' OR name1 = 'Test Corp International'
         OR email LIKE '%testguest@example.com%' OR email LIKE '%testcorp.com%'
         OR (vorname = 'Automated' AND name1 = 'TestGuest')
    \`);
    console.log('  Deleted ' + guestsResult.rowsAffected[0] + ' test guest profiles');
    totalDeleted += guestsResult.rowsAffected[0];

    console.log('\n' + '='.repeat(50));
    console.log('CLEANUP COMPLETE: Total ' + totalDeleted + ' test records deleted');
    console.log('='.repeat(50));

    await sql.close();
  } catch (err) {
    console.error('Cleanup Error:', err.message);
    process.exit(1);
  }
}

cleanupTestData();
"
```

**Verification:** Script reports deleted record counts (0 is valid for fresh environments).

---

## Wait Time Guidelines

| Operation | Duration | Verification |
|-----------|----------|--------------|
| Docker build | 10-15 min | All services "healthy" in `docker compose ps` |
| Service startup | 3-5 min | App loads at `http://localhost:3000` |
| SQL connection | 5-15 sec | Dialog shows success/error |
| AI chat response | 10-60 sec | Response appears in chat |

---

## Testing Steps

### 1. Clean Start

```bash
docker compose down -v
```

### 2. Build and Start Services

```bash
docker compose up --build -d
```

**Wait 10-15 minutes**, then verify:
1. Run `docker compose ps` - all services healthy/running
2. Navigate to `http://localhost:3000`

### 3. Create Account and Organization

| Action | Screenshot |
|--------|------------|
| Navigate to `http://localhost:3000` | `01_homepage.png` |
| Click "Sign Up" | `02_signup_page.png` |
| Fill form: Email: `protel-test@example.com`, Password: `TestPassword123!`, Name: `Protel Test User` | `03_signup_form_filled.png` |
| Submit form | `04_account_created.png` |
| Create organization: `Protel Test Hotel` | `05_organization_created.png` |

### 4. Connect Protel Integration

| Action | Screenshot |
|--------|------------|
| Navigate to Settings > Integrations | `06_integrations_page.png` |
| Click Protel PMS card | `07_protel_dialog.png` |
| Fill credentials from `.env` (Server, Port: 1433, Database, Username, Password) | `08_protel_credentials_filled.png` |
| Click Connect, wait 5-15 sec | `09_protel_connected.png` |

**Verification:** Protel shows "Connected" with server address.

### 5. Test Protel Integration via AI Chat

Navigate to Chat page. **Screenshot:** `10_chat_page.png`

#### 5a. Database Introspection

| Chat Message | Screenshot |
|--------------|------------|
| "Can you show me what tables are available in the Protel database?" | `11a_introspect_tables.png` |

#### 5b. Room Operations

| Chat Message | Screenshot |
|--------------|------------|
| "List all rooms in the hotel with their categories." | `11b_list_rooms.png` |
| "Show me all room categories available in the system." | `11c_room_categories.png` |

#### 5c. Guest/Profile Operations

| Chat Message | Screenshot |
|--------------|------------|
| "Search for guest profiles in the system. Show me the first 10 guests." | `12a_list_guests.png` |
| "List all company profiles registered in Protel." | `12b_list_companies.png` |
| "Show me all travel agent profiles." | `12c_list_travel_agents.png` |

#### 5d. Reservation Operations

| Chat Message | Screenshot |
|--------------|------------|
| "Show me all current reservations. Include guest names and room information." | `13a_list_reservations.png` |
| "Who are the guests checking in today?" | `13b_arrivals_today.png` |
| "Which guests are checking out today?" | `13c_departures_today.png` |
| "Show me all in-house guests currently staying at the hotel." | `13d_inhouse_guests.png` |

#### 5e. Room Availability

| Chat Message | Screenshot |
|--------------|------------|
| "Check room availability for the next 7 days. What room categories have availability?" | `14_room_availability.png` |

#### 5f. Posting/Folio Operations

| Chat Message | Screenshot |
|--------------|------------|
| "Show me today's postings and charges across the hotel." | `15a_daily_postings.png` |
| "List all revenue codes used in the system." | `15b_revenue_codes.png` |

#### 5g. Revenue/Statistics Operations

| Chat Message | Screenshot |
|--------------|------------|
| "Give me a revenue summary for today broken down by department." | `16a_daily_revenue.png` |
| "Show me occupancy statistics for the past week." | `16b_occupancy_stats.png` |

#### 5h. Reference Data Operations

| Chat Message | Screenshot |
|--------------|------------|
| "What payment methods are available in the system?" | `17a_payment_methods.png` |
| "List all reservation status codes." | `17b_reservation_statuses.png` |
| "Show me all VIP classification codes." | `17c_vip_codes.png` |
| "List all market segment codes." | `17d_market_codes.png` |
| "What booking source codes are configured?" | `17e_source_codes.png` |

#### 5i. Complex Queries

| Chat Message | Screenshot |
|--------------|------------|
| "I need a summary: How many reservations are arriving this week, how many are currently in-house, and what's our expected revenue for today?" | `18_complex_query.png` |

#### 5j. Specific Reservation Lookup

| Chat Message | Screenshot |
|--------------|------------|
| "Can you look up the details for a specific reservation? Pick one from the recent reservations and show me the full details including guest information and any charges." | `19_reservation_detail.png` |

### 6. Test Write Operations

> **WARNING:** These tests modify data. Only run on test/staging environments!

#### 6a-6b. Guest Profile Operations

| Chat Message | Screenshot |
|--------------|------------|
| "Create a new guest profile: Last Name: TestGuest, First Name: Automated, Email: testguest@example.com, Phone: +1-555-0123, City: Test City, Country: USA" | `20a_create_guest.png` |
| "Update the guest we just created. Add VIP code 1 and change the phone to +1-555-9999." | `20b_update_guest.png` |

#### 6c-6e. Reservation Operations

| Chat Message | Screenshot |
|--------------|------------|
| "Create a reservation for the guest we just created: Check-in: Tomorrow, Check-out: 3 days from now, Room category: first available, Rate: 150, Adults: 2, Status: Confirmed (1)" | `21a_create_reservation.png` |
| "Update the reservation we just created. Change the rate to 175 and add a note saying 'VIP guest - complimentary upgrade'." | `21b_update_reservation.png` |
| "Assign an available room to our test reservation. Pick a room from the category we used." | `21c_assign_room.png` |

#### 6f-6h. Posting Operations

| Chat Message | Screenshot |
|--------------|------------|
| "Post a room service charge of 45.00 to our test reservation. Use description 'Room Service - Dinner' and appropriate revenue code." | `22a_post_charge.png` |
| "Post a cash payment of 100.00 to our test reservation as a deposit." | `22b_post_payment.png` |
| "Void the room service charge we just posted. Reason: 'Posted in error - guest complaint'." | `22c_void_posting.png` |

#### 6i-6j. Check In/Out Operations

| Chat Message | Screenshot |
|--------------|------------|
| "Check in the guest for our test reservation." | `23a_check_in.png` |
| "Check out the guest from our test reservation." | `23b_check_out.png` |

#### 6k-6l. Additional Write Operations

| Chat Message | Screenshot |
|--------------|------------|
| "Create a company profile: Company Name: Test Corp International, Email: accounts@testcorp.com, Phone: +1-800-555-0199, City: Corporate City, Country: USA, VAT Number: US123456789" | `24_create_company.png` |
| "First create a new provisional reservation for tomorrow with the test guest we created, then cancel it with reason 'Guest requested cancellation'." | `25_cancel_reservation.png` |

### 7. Disconnect Protel Integration (Optional)

| Action | Screenshot |
|--------|------------|
| Navigate to Settings > Integrations, click connected Protel | `30_protel_connected_state.png` |
| Click Disconnect, confirm | `31_protel_disconnected.png` |

---

## Test Completion

**Final Screenshot:** `99_test_summary.png`

### Screenshot Checklist

**Total: 35 read-only, 47 full test**

| Category | Screenshots |
|----------|-------------|
| Setup & Connection (10) | `01-10_*.png` |
| Read Operations (22) | `11a-19_*.png` |
| Write Operations (12) | `20a-25_*.png` |
| Cleanup & Summary (3) | `30, 31, 99_*.png` |

### Operations Coverage

| Category | Read | Write |
|----------|------|-------|
| Introspection | `introspect_tables` | - |
| Rooms | `list_rooms`, `list_room_categories`, `get_room_availability` | `assign_room` |
| Guests | `list_guests`, `get_guest`, `list_companies`, `list_travel_agents` | `create_guest`, `update_guest`, `create_company` |
| Reservations | `list_reservations`, `get_reservation`, `get_arrivals_today`, `get_departures_today`, `get_inhouse_guests` | `create_reservation`, `update_reservation`, `cancel_reservation`, `check_in_guest`, `check_out_guest` |
| Postings | `get_reservation_postings`, `get_daily_postings` | `post_charge`, `post_payment`, `void_posting` |
| Revenue | `list_revenue_codes`, `get_daily_revenue_summary`, `get_occupancy_statistics` | - |
| Reference | `list_payment_methods`, `list_reservation_statuses`, `list_vip_codes`, `list_market_codes`, `list_source_codes` | - |

**Total: 22 read + 13 write = 35 operations**

### Test Report

Report:
- Screenshots captured (expected: 35-47)
- Missing screenshots
- Failed operations with errors
- Empty results (expected vs unexpected)
- Overall status: **PASS / FAIL**

---

## Troubleshooting

| Issue | Action |
|-------|--------|
| Connection timeout | Verify server reachable, check firewall |
| Authentication failed | Verify credentials in `.env` |
| Empty query results | May be expected (no arrivals today, etc.) |
| AI doesn't use Protel | Ensure integration connected before testing |
| SQL errors | Check database name, verify SQL Server running |

**On failure:** Screenshot as `ERROR_{step}_{description}.png`, continue if possible, report all failures.
