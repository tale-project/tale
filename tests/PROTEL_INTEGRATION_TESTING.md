# Protel PMS Integration Testing Guide (AI-Directed)

> **AI AGENT INSTRUCTIONS**: This document is designed for AI agents to execute automated testing of the Protel PMS SQL integration. Follow each step sequentially, take screenshots at designated points, and store all evidence in the specified folder structure.

## Overview

This test validates the Protel PMS (Property Management System) SQL integration, which connects directly to a Protel MS SQL Server database. The test covers:

- **Pre-test cleanup** of previous test data
- Account and organization setup (clean start)
- Protel integration connection via SQL credentials
- AI chat agent testing of all Protel operations

---

## Pre-Test Database Cleanup (MANDATORY)

> **⚠️ IMPORTANT:** Before running any tests, you MUST execute this cleanup step to remove test data from previous test runs. This ensures a clean state for accurate test results.

### Cleanup Script

**Action:** Run the following Node.js script from the `services/platform` directory to clear all test data created by previous test runs.

**Step 1:** Navigate to the platform services directory:

```bash
cd /home/larry/Documents/tale/services/platform
```

**Step 2:** Create and run a cleanup script using the credentials from `.test.env`:

```javascript
// cleanup-protel-test-data.js
const sql = require('mssql');

async function cleanupTestData() {
  const config = {
    server: process.env.PROTO_SERVER_ADDRESS,
    database: process.env.PROTO_DATABASE,
    user: process.env.PROTO_USER_NAME,
    password: process.env.PROTO_USER_PASSWORD,
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
  };

  try {
    console.log('Connecting to Protel database...');
    await sql.connect(config);
    console.log('Connected successfully!\n');

    // Track deletions
    let totalDeleted = 0;

    // 1. Delete test postings (leist) - must be deleted before reservations
    console.log('=== Cleaning up test postings (leist) ===');
    const postingsResult = await sql.query(`
      DELETE FROM proteluser.leist
      WHERE buchnr IN (
        SELECT buchnr FROM proteluser.buch
        WHERE kundennr IN (
          SELECT kdnr FROM proteluser.kunden
          WHERE name1 = 'TestGuest'
             OR name1 = 'Test Corp International'
             OR email LIKE '%testguest@example.com%'
             OR email LIKE '%testcorp.com%'
        )
      )
    `);
    console.log(`  Deleted ${postingsResult.rowsAffected[0]} test postings`);
    totalDeleted += postingsResult.rowsAffected[0];

    // 2. Delete test reservations (buch) - must be deleted before guests
    console.log('\n=== Cleaning up test reservations (buch) ===');
    const reservationsResult = await sql.query(`
      DELETE FROM proteluser.buch
      WHERE kundennr IN (
        SELECT kdnr FROM proteluser.kunden
        WHERE name1 = 'TestGuest'
           OR name1 = 'Test Corp International'
           OR email LIKE '%testguest@example.com%'
           OR email LIKE '%testcorp.com%'
      )
    `);
    console.log(
      `  Deleted ${reservationsResult.rowsAffected[0]} test reservations`
    );
    totalDeleted += reservationsResult.rowsAffected[0];

    // 3. Delete test guest profiles (kunden)
    console.log('\n=== Cleaning up test guest profiles (kunden) ===');
    const guestsResult = await sql.query(`
      DELETE FROM proteluser.kunden
      WHERE name1 = 'TestGuest'
         OR name1 = 'Test Corp International'
         OR email LIKE '%testguest@example.com%'
         OR email LIKE '%testcorp.com%'
         OR (vorname = 'Automated' AND name1 = 'TestGuest')
    `);
    console.log(
      `  Deleted ${guestsResult.rowsAffected[0]} test guest profiles`
    );
    totalDeleted += guestsResult.rowsAffected[0];

    // 4. Delete test company profiles (if stored separately)
    console.log('\n=== Cleaning up test company profiles ===');
    const companiesResult = await sql.query(`
      DELETE FROM proteluser.kunden
      WHERE name1 = 'Test Corp International'
         OR email LIKE '%accounts@testcorp.com%'
    `);
    console.log(
      `  Deleted ${companiesResult.rowsAffected[0]} test company profiles`
    );
    totalDeleted += companiesResult.rowsAffected[0];

    console.log('\n' + '='.repeat(50));
    console.log(
      `✅ CLEANUP COMPLETE: Total ${totalDeleted} test records deleted`
    );
    console.log('='.repeat(50));

    await sql.close();
    console.log('\nDatabase connection closed.');
  } catch (err) {
    console.error('❌ Cleanup Error:', err.message);
    process.exit(1);
  }
}

cleanupTestData();
```

**Step 3:** Execute the cleanup:

```bash
node -e "
const sql = require('mssql');

async function cleanupTestData() {
  const config = {
    server: process.env.PROTO_SERVER_ADDRESS,
    database: process.env.PROTO_DATABASE,
    user: process.env.PROTO_USER_NAME,
    password: process.env.PROTO_USER_PASSWORD,
    options: {
      encrypt: false,
      trustServerCertificate: true,
    }
  };

  try {
    console.log('Connecting to Protel database...');
    await sql.connect(config);
    console.log('Connected successfully!\n');

    let totalDeleted = 0;

    // 1. Delete test postings (leist)
    console.log('=== Cleaning up test postings (leist) ===');
    const postingsResult = await sql.query(\`
      DELETE FROM proteluser.leist
      WHERE buchnr IN (
        SELECT buchnr FROM proteluser.buch
        WHERE kundennr IN (
          SELECT kdnr FROM proteluser.kunden
          WHERE name1 = 'TestGuest'
             OR name1 = 'Test Corp International'
             OR email LIKE '%testguest@example.com%'
             OR email LIKE '%testcorp.com%'
        )
      )
    \`);
    console.log('  Deleted ' + postingsResult.rowsAffected[0] + ' test postings');
    totalDeleted += postingsResult.rowsAffected[0];

    // 2. Delete test reservations (buch)
    console.log('\n=== Cleaning up test reservations (buch) ===');
    const reservationsResult = await sql.query(\`
      DELETE FROM proteluser.buch
      WHERE kundennr IN (
        SELECT kdnr FROM proteluser.kunden
        WHERE name1 = 'TestGuest'
           OR name1 = 'Test Corp International'
           OR email LIKE '%testguest@example.com%'
           OR email LIKE '%testcorp.com%'
      )
    \`);
    console.log('  Deleted ' + reservationsResult.rowsAffected[0] + ' test reservations');
    totalDeleted += reservationsResult.rowsAffected[0];

    // 3. Delete test guest profiles (kunden)
    console.log('\n=== Cleaning up test guest profiles (kunden) ===');
    const guestsResult = await sql.query(\`
      DELETE FROM proteluser.kunden
      WHERE name1 = 'TestGuest'
         OR name1 = 'Test Corp International'
         OR email LIKE '%testguest@example.com%'
         OR email LIKE '%testcorp.com%'
         OR (vorname = 'Automated' AND name1 = 'TestGuest')
    \`);
    console.log('  Deleted ' + guestsResult.rowsAffected[0] + ' test guest profiles');
    totalDeleted += guestsResult.rowsAffected[0];

    console.log('\n' + '='.repeat(50));
    console.log('CLEANUP COMPLETE: Total ' + totalDeleted + ' test records deleted');
    console.log('='.repeat(50));

    await sql.close();
    console.log('\nDatabase connection closed.');

  } catch (err) {
    console.error('Cleanup Error:', err.message);
    process.exit(1);
  }
}

cleanupTestData();
"
```

**Verification:**

- The script should connect successfully and report the number of deleted records
- If no test data exists, counts will be 0 (which is expected for fresh environments)
- Any SQL errors indicate a problem that must be resolved before continuing

**Expected Output:**

```
Connecting to Protel database...
Connected successfully!

=== Cleaning up test postings (leist) ===
  Deleted X test postings

=== Cleaning up test reservations (buch) ===
  Deleted X test reservations

=== Cleaning up test guest profiles (kunden) ===
  Deleted X test guest profiles

==================================================
CLEANUP COMPLETE: Total X test records deleted
==================================================

Database connection closed.
```

---

## Wait Time Guidelines

| Operation                                  | Expected Duration | How to Verify Completion                           |
| ------------------------------------------ | ----------------- | -------------------------------------------------- |
| Docker build (`docker compose up --build`) | 10-15 minutes     | All services show "healthy" in `docker compose ps` |
| Service startup                            | 3-5 minutes       | Application loads at `http://localhost:3000`       |
| SQL connection test                        | 5-15 seconds      | Connection dialog shows success/error              |
| AI chat response                           | 10-60 seconds     | Response appears in chat                           |
| SQL query execution                        | 5-30 seconds      | Results returned in chat                           |

## Screenshot Storage Requirements

**Before starting any tests, create a screenshot folder:**

```text
tests/screenshots/protel-YYYY-MM-DD_HH_mm/
```

**Example:** `tests/screenshots/protel-2025-12-24_14_30/`

**Screenshot naming convention:** `{step_number}_{description}.png`

---

## Prerequisites

- Docker and Docker Compose installed
- Access to `.test.env` file with Protel test credentials (located at project root)
- Browser automation capability (Playwright MCP tools)
- Node.js with `mssql` package installed in `services/platform`

**Verify mssql package is available:**

```bash
cd /home/larry/Documents/tale/services/platform && npm list mssql
```

If not installed, run:

```bash
cd /home/larry/Documents/tale/services/platform && npm install mssql
```

**Protel Test Credentials (from `.test.env` at project root):**

| Environment Variable   | Description        |
| ---------------------- | ------------------ |
| `PROTO_SERVER_ADDRESS` | SQL Server address |
| `PROTO_DATABASE`       | Database name      |
| `PROTO_USER_NAME`      | SQL username       |
| `PROTO_USER_PASSWORD`  | SQL password       |

> **Note:** These credentials must be configured in `/home/larry/Documents/tale/.test.env` before running tests. Never commit actual credential values to the repository.

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

**WAIT TIME: 10-15 minutes**

**Verification Steps:**

1. Wait at least 60 seconds after the command completes
2. Run `docker compose ps` to check service status
3. All services should show "healthy" or "running" status
4. Verify the application is accessible at `http://localhost:3000`

---

### 3. Create Account and Organization

**Actions:**

1. Navigate to `http://localhost:3000`
2. **SCREENSHOT:** `01_homepage.png`
3. Click "Sign Up" to navigate to the registration page
4. **SCREENSHOT:** `02_signup_page.png`

**Account Creation:**

1. Use these test credentials:
   - **Email:** `protel-test@example.com`
   - **Password:** `TestPassword123!`
   - **Name:** `Protel Test User`
2. Fill in the sign-up form
3. **SCREENSHOT:** `03_signup_form_filled.png`
4. Submit the form
5. **SCREENSHOT:** `04_account_created.png`

**Organization Setup:**

1. Create organization: `Protel Test Hotel`
2. Complete organization setup
3. **SCREENSHOT:** `05_organization_created.png`

---

### 4. Connect Protel Integration

**Actions:**

1. Navigate to **Settings > Integrations**
2. **SCREENSHOT:** `06_integrations_page.png`
3. Find and click the **Protel PMS** integration card
4. **SCREENSHOT:** `07_protel_dialog.png`

**Enter Protel SQL Credentials:**

Read from `.test.env` and fill the form:

- **Server Address:** Value of `PROTO_SERVER_ADDRESS`
- **Port:** `1433` (default)
- **Database:** Value of `PROTO_DATABASE`
- **Username:** Value of `PROTO_USER_NAME`
- **Password:** Value of `PROTO_USER_PASSWORD`

5. **SCREENSHOT:** `08_protel_credentials_filled.png`
6. Click **Connect**
7. Wait for connection to complete (5-15 seconds)
8. **SCREENSHOT:** `09_protel_connected.png`

**Verification:** Protel shows as "Connected" with server address displayed.

---

### 5. Test Protel Integration via AI Chat

Navigate to the **Chat** page to test Protel operations through the AI agent.

**SCREENSHOT:** `10_chat_page.png`

The AI agent has access to Protel integration tools. Test the following operations by sending chat messages:

---

#### 5a. Test Database Introspection

**Chat Message:**

```
Can you show me what tables are available in the Protel database?
```

**Wait for response** (10-30 seconds)

**SCREENSHOT:** `11a_introspect_tables.png`

**Expected:** AI returns a list of database tables (e.g., buch, kunden, zimmer, kat, leist, etc.)

---

#### 5b. Test Room Operations

**Chat Message:**

```
List all rooms in the hotel with their categories.
```

**Wait for response**

**SCREENSHOT:** `11b_list_rooms.png`

**Expected:** AI returns room list with room numbers, category codes, and names.

---

**Chat Message:**

```
Show me all room categories available in the system.
```

**Wait for response**

**SCREENSHOT:** `11c_room_categories.png`

**Expected:** AI returns category list with codes, names, and room counts.

---

#### 5c. Test Guest/Profile Operations

**Chat Message:**

```
Search for guest profiles in the system. Show me the first 10 guests.
```

**Wait for response**

**SCREENSHOT:** `12a_list_guests.png`

**Expected:** AI returns guest profiles with names, emails, contact info.

---

**Chat Message:**

```
List all company profiles registered in Protel.
```

**Wait for response**

**SCREENSHOT:** `12b_list_companies.png`

**Expected:** AI returns company profiles.

---

**Chat Message:**

```
Show me all travel agent profiles.
```

**Wait for response**

**SCREENSHOT:** `12c_list_travel_agents.png`

**Expected:** AI returns travel agent profiles.

---

#### 5d. Test Reservation Operations

**Chat Message:**

```
Show me all current reservations. Include guest names and room information.
```

**Wait for response**

**SCREENSHOT:** `13a_list_reservations.png`

**Expected:** AI returns reservations with guest info, room numbers, dates, status.

---

**Chat Message:**

```
Who are the guests checking in today?
```

**Wait for response**

**SCREENSHOT:** `13b_arrivals_today.png`

**Expected:** AI returns today's arrivals or indicates none if empty.

---

**Chat Message:**

```
Which guests are checking out today?
```

**Wait for response**

**SCREENSHOT:** `13c_departures_today.png`

**Expected:** AI returns today's departures or indicates none if empty.

---

**Chat Message:**

```
Show me all in-house guests currently staying at the hotel.
```

**Wait for response**

**SCREENSHOT:** `13d_inhouse_guests.png`

**Expected:** AI returns currently checked-in guests with room assignments.

---

#### 5e. Test Room Availability

**Chat Message:**

```
Check room availability for the next 7 days. What room categories have availability?
```

**Wait for response**

**SCREENSHOT:** `14_room_availability.png`

**Expected:** AI returns availability by category with total/available room counts.

---

#### 5f. Test Posting/Folio Operations

**Chat Message:**

```
Show me today's postings and charges across the hotel.
```

**Wait for response**

**SCREENSHOT:** `15a_daily_postings.png`

**Expected:** AI returns posting records for today.

---

**Chat Message:**

```
List all revenue codes used in the system.
```

**Wait for response**

**SCREENSHOT:** `15b_revenue_codes.png`

**Expected:** AI returns revenue/posting codes with descriptions.

---

#### 5g. Test Revenue/Statistics Operations

**Chat Message:**

```
Give me a revenue summary for today broken down by department.
```

**Wait for response**

**SCREENSHOT:** `16a_daily_revenue.png`

**Expected:** AI returns revenue totals by category/department.

---

**Chat Message:**

```
Show me occupancy statistics for the past week.
```

**Wait for response**

**SCREENSHOT:** `16b_occupancy_stats.png`

**Expected:** AI returns occupancy data with reservation counts, guest counts, room nights.

---

#### 5h. Test Reference Data Operations

**Chat Message:**

```
What payment methods are available in the system?
```

**Wait for response**

**SCREENSHOT:** `17a_payment_methods.png`

**Expected:** AI returns list of payment methods.

---

**Chat Message:**

```
List all reservation status codes.
```

**Wait for response**

**SCREENSHOT:** `17b_reservation_statuses.png`

**Expected:** AI returns status codes (Confirmed, Provisional, Cancelled, etc.)

---

**Chat Message:**

```
Show me all VIP classification codes.
```

**Wait for response**

**SCREENSHOT:** `17c_vip_codes.png`

**Expected:** AI returns VIP codes with descriptions.

---

**Chat Message:**

```
List all market segment codes.
```

**Wait for response**

**SCREENSHOT:** `17d_market_codes.png`

**Expected:** AI returns market codes.

---

**Chat Message:**

```
What booking source codes are configured?
```

**Wait for response**

**SCREENSHOT:** `17e_source_codes.png`

**Expected:** AI returns source codes.

---

#### 5i. Test Complex Queries

**Chat Message:**

```
I need a summary: How many reservations are arriving this week, how many are currently in-house, and what's our expected revenue for today?
```

**Wait for response**

**SCREENSHOT:** `18_complex_query.png`

**Expected:** AI combines multiple operations to provide a comprehensive summary.

---

#### 5j. Test Specific Reservation Lookup

**Chat Message:**

```
Can you look up the details for a specific reservation? Pick one from the recent reservations and show me the full details including guest information and any charges.
```

**Wait for response**

**SCREENSHOT:** `19_reservation_detail.png`

**Expected:** AI fetches a specific reservation with full details and postings.

---

### 6. Test Write Operations (Reservations, Guests, Postings)

> **⚠️ WARNING:** These tests modify data in the Protel database. Only run on test/staging environments!

---

#### 6a. Create a New Guest Profile

**Chat Message:**

```
Create a new guest profile with the following details:
- Last Name: TestGuest
- First Name: Automated
- Email: testguest@example.com
- Phone: +1-555-0123
- City: Test City
- Country: USA
```

**Wait for response**

**SCREENSHOT:** `20a_create_guest.png`

**Expected:** AI creates guest profile and returns the new guest_id.

---

#### 6b. Update the Guest Profile

**Chat Message:**

```
Update the guest we just created (use the guest ID from the previous response). Add VIP code 1 and change the phone to +1-555-9999.
```

**Wait for response**

**SCREENSHOT:** `20b_update_guest.png`

**Expected:** AI updates the guest profile and confirms the changes.

---

#### 6c. Create a New Reservation

**Chat Message:**

```
Create a reservation for the guest we just created. Use these details:
- Check-in: Tomorrow's date
- Check-out: 3 days from now
- Room category: Use the first available category
- Rate: 150
- Adults: 2
- Reservation status: Confirmed (1)
```

**Wait for response**

**SCREENSHOT:** `21a_create_reservation.png`

**Expected:** AI creates reservation and returns the new reservation_id.

---

#### 6d. Update the Reservation

**Chat Message:**

```
Update the reservation we just created. Change the rate to 175 and add a note saying "VIP guest - complimentary upgrade".
```

**Wait for response**

**SCREENSHOT:** `21b_update_reservation.png`

**Expected:** AI updates the reservation and confirms the changes.

---

#### 6e. Assign Room to Reservation

**Chat Message:**

```
Assign an available room to our test reservation. Pick a room from the category we used.
```

**Wait for response**

**SCREENSHOT:** `21c_assign_room.png`

**Expected:** AI assigns a room and returns the room assignment confirmation.

---

#### 6f. Post a Charge to the Reservation

**Chat Message:**

```
Post a room service charge of 45.00 to our test reservation. Use the description "Room Service - Dinner" and an appropriate revenue code.
```

**Wait for response**

**SCREENSHOT:** `22a_post_charge.png`

**Expected:** AI posts the charge and returns the posting_id.

---

#### 6g. Post a Payment

**Chat Message:**

```
Post a cash payment of 100.00 to our test reservation as a deposit.
```

**Wait for response**

**SCREENSHOT:** `22b_post_payment.png`

**Expected:** AI posts the payment and returns the posting_id.

---

#### 6h. Void a Posting

**Chat Message:**

```
Void the room service charge we just posted (use the posting ID). Reason: "Posted in error - guest complaint".
```

**Wait for response**

**SCREENSHOT:** `22c_void_posting.png`

**Expected:** AI creates a reversal posting and returns the new posting_id.

---

#### 6i. Check In the Guest

**Chat Message:**

```
Check in the guest for our test reservation.
```

**Wait for response**

**SCREENSHOT:** `23a_check_in.png`

**Expected:** AI changes reservation status to In-House and confirms check-in.

---

#### 6j. Check Out the Guest

**Chat Message:**

```
Check out the guest from our test reservation.
```

**Wait for response**

**SCREENSHOT:** `23b_check_out.png`

**Expected:** AI changes reservation status to Checked-Out and confirms check-out.

---

#### 6k. Create a Company Profile

**Chat Message:**

```
Create a company profile:
- Company Name: Test Corp International
- Email: accounts@testcorp.com
- Phone: +1-800-555-0199
- City: Corporate City
- Country: USA
- VAT Number: US123456789
```

**Wait for response**

**SCREENSHOT:** `24_create_company.png`

**Expected:** AI creates company profile and returns the new company_id.

---

#### 6l. Cancel a Reservation (Test with New Reservation)

**Chat Message:**

```
First create a new provisional reservation for tomorrow with the test guest we created, then cancel it with reason "Guest requested cancellation".
```

**Wait for response**

**SCREENSHOT:** `25_cancel_reservation.png`

**Expected:** AI creates and then cancels the reservation, showing both operations.

---

### 7. Disconnect Protel Integration (Optional)

**Actions:**

1. Navigate to **Settings > Integrations**
2. Click on the connected Protel integration
3. **SCREENSHOT:** `30_protel_connected_state.png`
4. Click **Disconnect**
5. Confirm disconnection
6. **SCREENSHOT:** `31_protel_disconnected.png`

**Verification:** Protel shows as disconnected.

---

## Test Completion Summary

**After all tests complete:**

**SCREENSHOT:** `99_test_summary.png` - Capture final state

### Screenshot Verification Checklist

**Expected screenshots (minimum 47 for full test, 35 for read-only test):**

#### Setup & Connection (10 screenshots)

| Step | Filename                           | Description            |
| ---- | ---------------------------------- | ---------------------- |
| 1    | `01_homepage.png`                  | Landing page           |
| 2    | `02_signup_page.png`               | Sign up form           |
| 3    | `03_signup_form_filled.png`        | Filled registration    |
| 4    | `04_account_created.png`           | Account created        |
| 5    | `05_organization_created.png`      | Organization dashboard |
| 6    | `06_integrations_page.png`         | Integrations page      |
| 7    | `07_protel_dialog.png`             | Protel dialog          |
| 8    | `08_protel_credentials_filled.png` | Credentials entered    |
| 9    | `09_protel_connected.png`          | Connection success     |
| 10   | `10_chat_page.png`                 | Chat interface         |

#### Read Operations (24 screenshots)

| Step | Filename                       | Description          |
| ---- | ------------------------------ | -------------------- |
| 11a  | `11a_introspect_tables.png`    | Database tables      |
| 11b  | `11b_list_rooms.png`           | Room list            |
| 11c  | `11c_room_categories.png`      | Room categories      |
| 12a  | `12a_list_guests.png`          | Guest profiles       |
| 12b  | `12b_list_companies.png`       | Company profiles     |
| 12c  | `12c_list_travel_agents.png`   | Travel agents        |
| 13a  | `13a_list_reservations.png`    | Reservations         |
| 13b  | `13b_arrivals_today.png`       | Today's arrivals     |
| 13c  | `13c_departures_today.png`     | Today's departures   |
| 13d  | `13d_inhouse_guests.png`       | In-house guests      |
| 14   | `14_room_availability.png`     | Availability check   |
| 15a  | `15a_daily_postings.png`       | Daily postings       |
| 15b  | `15b_revenue_codes.png`        | Revenue codes        |
| 16a  | `16a_daily_revenue.png`        | Revenue summary      |
| 16b  | `16b_occupancy_stats.png`      | Occupancy stats      |
| 17a  | `17a_payment_methods.png`      | Payment methods      |
| 17b  | `17b_reservation_statuses.png` | Reservation statuses |
| 17c  | `17c_vip_codes.png`            | VIP codes            |
| 17d  | `17d_market_codes.png`         | Market codes         |
| 17e  | `17e_source_codes.png`         | Source codes         |
| 18   | `18_complex_query.png`         | Complex summary      |
| 19   | `19_reservation_detail.png`    | Reservation detail   |

#### Write Operations (12 screenshots)

| Step | Filename                     | Description          |
| ---- | ---------------------------- | -------------------- |
| 20a  | `20a_create_guest.png`       | Create guest profile |
| 20b  | `20b_update_guest.png`       | Update guest profile |
| 21a  | `21a_create_reservation.png` | Create reservation   |
| 21b  | `21b_update_reservation.png` | Update reservation   |
| 21c  | `21c_assign_room.png`        | Assign room          |
| 22a  | `22a_post_charge.png`        | Post charge          |
| 22b  | `22b_post_payment.png`       | Post payment         |
| 22c  | `22c_void_posting.png`       | Void posting         |
| 23a  | `23a_check_in.png`           | Check in guest       |
| 23b  | `23b_check_out.png`          | Check out guest      |
| 24   | `24_create_company.png`      | Create company       |
| 25   | `25_cancel_reservation.png`  | Cancel reservation   |

#### Cleanup & Summary (3 screenshots)

| Step | Filename                        | Description     |
| ---- | ------------------------------- | --------------- |
| 30   | `30_protel_connected_state.png` | Connected state |
| 31   | `31_protel_disconnected.png`    | Disconnected    |
| 99   | `99_test_summary.png`           | Final state     |

### Protel Operations Coverage

| Category      | Read Operations                                                                                                 | Write Operations                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Introspection | `introspect_tables`                                                                                             | -                                                                                                     |
| Rooms         | `list_rooms`, `list_room_categories`, `get_room_availability`                                                   | `assign_room`                                                                                         |
| Guests        | `list_guests`, `get_guest`, `list_companies`, `list_travel_agents`                                              | `create_guest`, `update_guest`, `create_company`                                                      |
| Reservations  | `list_reservations`, `get_reservation`, `get_arrivals_today`, `get_departures_today`, `get_inhouse_guests`      | `create_reservation`, `update_reservation`, `cancel_reservation`, `check_in_guest`, `check_out_guest` |
| Postings      | `get_reservation_postings`, `get_daily_postings`                                                                | `post_charge`, `post_payment`, `void_posting`                                                         |
| Revenue       | `list_revenue_codes`, `get_daily_revenue_summary`, `get_occupancy_statistics`                                   | -                                                                                                     |
| Reference     | `list_payment_methods`, `list_reservation_statuses`, `list_vip_codes`, `list_market_codes`, `list_source_codes` | -                                                                                                     |

**Total Operations:** 22 read + 13 write = 35 operations

### Test Report

**Report the following:**

- Total screenshots captured (expected: 35, actual: \_\_\_)
- Missing screenshots (list any)
- Operations that failed (with error details)
- Operations that returned empty results (expected vs unexpected)
- Overall test status: PASS / FAIL

---

## Troubleshooting

| Issue                 | Action                                                        |
| --------------------- | ------------------------------------------------------------- |
| Connection timeout    | Verify server address is reachable, check firewall            |
| Authentication failed | Verify username/password in `.test.env`                       |
| Empty query results   | May be expected for some operations (no arrivals today, etc.) |
| AI doesn't use Protel | Ensure integration is connected before testing chat           |
| SQL errors            | Check database name matches, verify SQL Server is running     |

**On any failure:**

1. Take a screenshot of the error state
2. Name it: `ERROR_{step}_{description}.png`
3. Continue with remaining tests if possible
4. Report all failures in the final summary
