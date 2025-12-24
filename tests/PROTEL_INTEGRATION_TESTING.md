# Protel PMS Integration Testing Guide (AI-Directed)

> **AI AGENT INSTRUCTIONS**: This document is designed for AI agents to execute automated testing of the Protel PMS SQL integration. Follow each step sequentially, take screenshots at designated points, and store all evidence in the specified folder structure.

## Overview

This test validates the Protel PMS (Property Management System) SQL integration, which connects directly to a Protel MS SQL Server database. The test covers:
- Account and organization setup (clean start)
- Protel integration connection via SQL credentials
- AI chat agent testing of all Protel operations

## Wait Time Guidelines

| Operation | Expected Duration | How to Verify Completion |
|-----------|------------------|-------------------------|
| Docker build (`docker compose up --build`) | 10-15 minutes | All services show "healthy" in `docker compose ps` |
| Service startup | 3-5 minutes | Application loads at `http://localhost:3000` |
| SQL connection test | 5-15 seconds | Connection dialog shows success/error |
| AI chat response | 10-60 seconds | Response appears in chat |
| SQL query execution | 5-30 seconds | Results returned in chat |

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
- Access to `.test.env` file with Protel test credentials
- Browser automation capability (Playwright MCP tools)

**Protel Test Credentials (from `.test.env`):**
- `PROTO_SERVER_ADDRESS` - SQL Server address
- `PROTO_DATABASE` - Database name
- `PROTO_USER_NAME` - SQL username
- `PROTO_USER_PASSWORD` - SQL password

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
1. Generate test credentials:
   - **Email:** `protel-test-{timestamp}@example.com`
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

### 6. Disconnect Protel Integration (Optional)

**Actions:**
1. Navigate to **Settings > Integrations**
2. Click on the connected Protel integration
3. **SCREENSHOT:** `20_protel_connected_state.png`
4. Click **Disconnect**
5. Confirm disconnection
6. **SCREENSHOT:** `21_protel_disconnected.png`

**Verification:** Protel shows as disconnected.

---

## Test Completion Summary

**After all tests complete:**

**SCREENSHOT:** `99_test_summary.png` - Capture final state

### Screenshot Verification Checklist

**Expected screenshots (minimum 25):**

| Step | Filename | Description |
|------|----------|-------------|
| 1 | `01_homepage.png` | Landing page |
| 2 | `02_signup_page.png` | Sign up form |
| 3 | `03_signup_form_filled.png` | Filled registration |
| 4 | `04_account_created.png` | Account created |
| 5 | `05_organization_created.png` | Organization dashboard |
| 6 | `06_integrations_page.png` | Integrations page |
| 7 | `07_protel_dialog.png` | Protel dialog |
| 8 | `08_protel_credentials_filled.png` | Credentials entered |
| 9 | `09_protel_connected.png` | Connection success |
| 10 | `10_chat_page.png` | Chat interface |
| 11a | `11a_introspect_tables.png` | Database tables |
| 11b | `11b_list_rooms.png` | Room list |
| 11c | `11c_room_categories.png` | Room categories |
| 12a | `12a_list_guests.png` | Guest profiles |
| 12b | `12b_list_companies.png` | Company profiles |
| 12c | `12c_list_travel_agents.png` | Travel agents |
| 13a | `13a_list_reservations.png` | Reservations |
| 13b | `13b_arrivals_today.png` | Today's arrivals |
| 13c | `13c_departures_today.png` | Today's departures |
| 13d | `13d_inhouse_guests.png` | In-house guests |
| 14 | `14_room_availability.png` | Availability check |
| 15a | `15a_daily_postings.png` | Daily postings |
| 15b | `15b_revenue_codes.png` | Revenue codes |
| 16a | `16a_daily_revenue.png` | Revenue summary |
| 16b | `16b_occupancy_stats.png` | Occupancy stats |
| 17a | `17a_payment_methods.png` | Payment methods |
| 17b | `17b_reservation_statuses.png` | Reservation statuses |
| 17c | `17c_vip_codes.png` | VIP codes |
| 17d | `17d_market_codes.png` | Market codes |
| 17e | `17e_source_codes.png` | Source codes |
| 18 | `18_complex_query.png` | Complex summary |
| 19 | `19_reservation_detail.png` | Reservation detail |
| 20 | `20_protel_connected_state.png` | Connected state |
| 21 | `21_protel_disconnected.png` | Disconnected |
| 99 | `99_test_summary.png` | Final state |

### Protel Operations Coverage

| Category | Operations Tested |
|----------|------------------|
| Introspection | `introspect_tables` |
| Rooms | `list_rooms`, `list_room_categories`, `get_room_availability` |
| Guests | `list_guests`, `get_guest`, `list_companies`, `list_travel_agents` |
| Reservations | `list_reservations`, `get_reservation`, `get_arrivals_today`, `get_departures_today`, `get_inhouse_guests` |
| Postings | `get_reservation_postings`, `get_daily_postings` |
| Revenue | `list_revenue_codes`, `get_daily_revenue_summary`, `get_occupancy_statistics` |
| Reference | `list_payment_methods`, `list_reservation_statuses`, `list_vip_codes`, `list_market_codes`, `list_source_codes` |

### Test Report

**Report the following:**
- Total screenshots captured (expected: 35, actual: ___)
- Missing screenshots (list any)
- Operations that failed (with error details)
- Operations that returned empty results (expected vs unexpected)
- Overall test status: PASS / FAIL

---

## Troubleshooting

| Issue | Action |
|-------|--------|
| Connection timeout | Verify server address is reachable, check firewall |
| Authentication failed | Verify username/password in `.test.env` |
| Empty query results | May be expected for some operations (no arrivals today, etc.) |
| AI doesn't use Protel | Ensure integration is connected before testing chat |
| SQL errors | Check database name matches, verify SQL Server is running |

**On any failure:**
1. Take a screenshot of the error state
2. Name it: `ERROR_{step}_{description}.png`
3. Continue with remaining tests if possible
4. Report all failures in the final summary
