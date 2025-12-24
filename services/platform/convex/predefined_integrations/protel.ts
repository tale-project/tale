/**
 * Protel PMS SQL Integration Definition
 *
 * Predefined integration for Protel Property Management System via direct SQL access.
 * This is a SQL-type integration that connects directly to the Protel MS SQL Server database.
 *
 * Database: Protel (MS SQL Server 2022)
 * Main schemas: proteluser (main data), dbo (system/custom)
 */

import type { PredefinedIntegration, SqlOperation } from './types';

/**
 * SQL Operations for Protel PMS
 *
 * These are the pre-configured SQL queries that users can use with this integration.
 * Based on actual Protel database schema analysis.
 */
const protelSqlOperations: SqlOperation[] = [
  // ============================================
  // RESERVATION OPERATIONS
  // ============================================
  {
    name: 'list_reservations',
    title: 'List Reservations',
    description:
      'Fetch all reservations with optional filters for status and date range',
    query: `
      SELECT
        b.buchnr AS reservation_id,
        b.kundennr AS guest_id,
        b.zimmernr AS room_id,
        z.ziname AS room_number,
        b.katnr AS category_id,
        k2.kat AS category_code,
        k2.bez AS category_name,
        b.datumvon AS check_in_date,
        b.datumbis AS check_out_date,
        b.buchstatus AS booking_status,
        b.resstatus AS reservation_status,
        rs.resbez AS reservation_status_name,
        b.anzahl AS guests,
        b.anzerw AS adults,
        b.anzkin1 + b.anzkin2 + b.anzkin3 + b.anzkin4 AS children,
        b.preis AS rate,
        b.anzeit AS arrival_time,
        b.abzeit AS departure_time,
        k.name1 AS guest_name1,
        k.name2 AS guest_name2,
        k.vorname AS guest_firstname,
        k.email AS guest_email,
        k.telefonnr AS guest_phone,
        b.crsnumber AS crs_number,
        b.resdatum AS reservation_date,
        b.resuser AS created_by,
        b.market,
        b.source
      FROM proteluser.buch b
      LEFT JOIN proteluser.kunden k ON b.kundennr = k.kdnr
      LEFT JOIN proteluser.zimmer z ON b.zimmernr = z.zinr
      LEFT JOIN proteluser.kat k2 ON b.katnr = k2.katnr
      LEFT JOIN proteluser.resstat rs ON b.resstatus = rs.resnr
      WHERE (@buchstatus IS NULL OR b.buchstatus = @buchstatus)
        AND (@fromDate IS NULL OR b.datumvon >= @fromDate)
        AND (@toDate IS NULL OR b.datumvon <= @toDate)
      ORDER BY b.datumvon DESC, b.buchnr DESC
    `,
    parametersSchema: {
      type: 'object',
      properties: {
        buchstatus: {
          type: 'number',
          description:
            'Booking status filter: 0=Arrival (not checked in), 1=In-House, 2=Checked-Out',
        },
        fromDate: {
          type: 'string',
          format: 'date',
          description: 'Filter by check-in date from (YYYY-MM-DD)',
        },
        toDate: {
          type: 'string',
          format: 'date',
          description: 'Filter by check-in date to (YYYY-MM-DD)',
        },
      },
    },
  },
  {
    name: 'get_reservation',
    title: 'Get Reservation by ID',
    description: 'Fetch a single reservation with full details',
    query: `
      SELECT
        b.buchnr AS reservation_id,
        b.kundennr AS guest_id,
        b.zimmernr AS room_id,
        z.ziname AS room_number,
        b.katnr AS category_id,
        k2.kat AS category_code,
        k2.bez AS category_name,
        b.datumvon AS check_in_date,
        b.datumbis AS check_out_date,
        b.buchstatus AS booking_status,
        b.resstatus AS reservation_status,
        rs.resbez AS reservation_status_name,
        b.anzahl AS guests,
        b.anzerw AS adults,
        b.anzkin1 AS children_cat1,
        b.anzkin2 AS children_cat2,
        b.anzkin3 AS children_cat3,
        b.anzkin4 AS children_cat4,
        b.preis AS rate,
        b.grundpreis AS base_rate,
        b.anzeit AS arrival_time,
        b.abzeit AS departure_time,
        k.kdnr AS guest_kdnr,
        k.name1 AS guest_name1,
        k.name2 AS guest_name2,
        k.vorname AS guest_firstname,
        k.email AS guest_email,
        k.telefonnr AS guest_phone,
        k.strasse AS guest_street,
        k.plz AS guest_postal_code,
        k.ort AS guest_city,
        k.land AS guest_country,
        b.crsnumber AS crs_number,
        b.resdatum AS reservation_date,
        b.resuser AS created_by,
        b.market,
        b.source,
        b.not1txt AS note1,
        b.not2txt AS note2,
        b.cctyp AS credit_card_type,
        b.firmennr AS company_id,
        b.gruppennr AS group_id,
        b.reisenr AS travel_agent_id
      FROM proteluser.buch b
      LEFT JOIN proteluser.kunden k ON b.kundennr = k.kdnr
      LEFT JOIN proteluser.zimmer z ON b.zimmernr = z.zinr
      LEFT JOIN proteluser.kat k2 ON b.katnr = k2.katnr
      LEFT JOIN proteluser.resstat rs ON b.resstatus = rs.resnr
      WHERE b.buchnr = @reservationId
    `,
    parametersSchema: {
      type: 'object',
      properties: {
        reservationId: {
          type: 'number',
          description: 'Reservation ID (buchnr)',
        },
      },
      required: ['reservationId'],
    },
  },
  {
    name: 'get_arrivals_today',
    title: "Get Today's Arrivals",
    description: 'Get all reservations arriving today (not yet checked in)',
    query: `
      SELECT
        b.buchnr AS reservation_id,
        b.kundennr AS guest_id,
        z.ziname AS room_number,
        k2.kat AS category_code,
        b.datumvon AS check_in_date,
        b.datumbis AS check_out_date,
        b.anzahl AS guests,
        b.anzeit AS arrival_time,
        k.name1 AS guest_name1,
        k.vorname AS guest_firstname,
        k.email AS guest_email,
        k.telefonnr AS guest_phone,
        rs.resbez AS reservation_status_name
      FROM proteluser.buch b
      LEFT JOIN proteluser.kunden k ON b.kundennr = k.kdnr
      LEFT JOIN proteluser.zimmer z ON b.zimmernr = z.zinr
      LEFT JOIN proteluser.kat k2 ON b.katnr = k2.katnr
      LEFT JOIN proteluser.resstat rs ON b.resstatus = rs.resnr
      WHERE b.buchstatus = 0
        AND CAST(b.datumvon AS DATE) = CAST(GETDATE() AS DATE)
      ORDER BY z.ziname
    `,
  },
  {
    name: 'get_departures_today',
    title: "Get Today's Departures",
    description: 'Get all reservations departing today (still in-house)',
    query: `
      SELECT
        b.buchnr AS reservation_id,
        b.kundennr AS guest_id,
        z.ziname AS room_number,
        k2.kat AS category_code,
        b.datumvon AS check_in_date,
        b.datumbis AS check_out_date,
        b.anzahl AS guests,
        b.abzeit AS departure_time,
        k.name1 AS guest_name1,
        k.vorname AS guest_firstname,
        k.email AS guest_email
      FROM proteluser.buch b
      LEFT JOIN proteluser.kunden k ON b.kundennr = k.kdnr
      LEFT JOIN proteluser.zimmer z ON b.zimmernr = z.zinr
      LEFT JOIN proteluser.kat k2 ON b.katnr = k2.katnr
      WHERE b.buchstatus = 1
        AND CAST(b.datumbis AS DATE) = CAST(GETDATE() AS DATE)
      ORDER BY z.ziname
    `,
  },
  {
    name: 'get_inhouse_guests',
    title: 'Get In-House Guests',
    description: 'Get all currently checked-in reservations',
    query: `
      SELECT
        b.buchnr AS reservation_id,
        b.kundennr AS guest_id,
        z.ziname AS room_number,
        k2.kat AS category_code,
        k2.bez AS category_name,
        b.datumvon AS check_in_date,
        b.datumbis AS check_out_date,
        b.anzahl AS guests,
        k.name1 AS guest_name1,
        k.vorname AS guest_firstname,
        k.email AS guest_email,
        k.telefonnr AS guest_phone,
        b.preis AS rate
      FROM proteluser.buch b
      LEFT JOIN proteluser.kunden k ON b.kundennr = k.kdnr
      LEFT JOIN proteluser.zimmer z ON b.zimmernr = z.zinr
      LEFT JOIN proteluser.kat k2 ON b.katnr = k2.katnr
      WHERE b.buchstatus = 1
      ORDER BY z.ziname
    `,
  },

  // ============================================
  // GUEST/PROFILE OPERATIONS
  // ============================================
  {
    name: 'list_guests',
    title: 'List Guest Profiles',
    description: 'Fetch guest profiles (typ=2) with optional search',
    query: `
      SELECT
        kdnr AS guest_id,
        name1 AS last_name,
        name2 AS name2,
        vorname AS first_name,
        email,
        telefonnr AS phone,
        funktel AS mobile,
        strasse AS street,
        plz AS postal_code,
        ort AS city,
        land AS country,
        landkz AS country_code,
        sprache AS language,
        vip AS vip_code,
        gebdat AS birth_date,
        anrede AS salutation,
        aufenth AS total_stays,
        naechte AS total_nights,
        noshows,
        stornos AS cancellations,
        letzterauf AS last_stay_date,
        firststay AS first_stay_date,
        logis AS room_revenue,
        fb AS fb_revenue,
        extras AS extras_revenue,
        erfasst AS created_date,
        changed AS modified_date
      FROM proteluser.kunden
      WHERE typ = 2
        AND (@searchName IS NULL OR name1 LIKE '%' + @searchName + '%' OR vorname LIKE '%' + @searchName + '%')
        AND (@email IS NULL OR email LIKE '%' + @email + '%')
      ORDER BY kdnr DESC
    `,
    parametersSchema: {
      type: 'object',
      properties: {
        searchName: {
          type: 'string',
          description: 'Search by guest name (partial match)',
        },
        email: {
          type: 'string',
          description: 'Search by email (partial match)',
        },
      },
    },
  },
  {
    name: 'get_guest',
    title: 'Get Guest Profile by ID',
    description: 'Fetch a single guest profile with full details',
    query: `
      SELECT
        kdnr AS guest_id,
        typ AS profile_type,
        name1 AS last_name,
        name2 AS name2,
        vorname AS first_name,
        email,
        telefonnr AS phone,
        funktel AS mobile,
        faxnr AS fax,
        strasse AS street,
        strasse2 AS street2,
        strasse3 AS street3,
        plz AS postal_code,
        ort AS city,
        land AS country,
        landkz AS country_code,
        regionkz AS region_code,
        sprache AS language,
        vip AS vip_code,
        gebdat AS birth_date,
        gebort AS birth_place,
        gender,
        anrede AS salutation,
        titel AS title,
        beruf AS profession,
        firmenname AS company_name,
        abteil AS department,
        aufenth AS total_stays,
        naechte AS total_nights,
        noshows,
        stornos AS cancellations,
        letzterauf AS last_stay_date,
        firststay AS first_stay_date,
        letzterpr AS last_rate,
        letzteszi AS last_room,
        logis AS room_revenue,
        fb AS fb_revenue,
        extras AS extras_revenue,
        passnr AS passport_number,
        issuedate AS passport_issue_date,
        docvalid AS document_valid_until,
        bemerkung AS remarks,
        bemrest AS reservation_remarks,
        erfasst AS created_date,
        erfasstusr AS created_by,
        changed AS modified_date,
        changedby AS modified_by
      FROM proteluser.kunden
      WHERE kdnr = @guestId
    `,
    parametersSchema: {
      type: 'object',
      properties: {
        guestId: {
          type: 'number',
          description: 'Guest ID (kdnr)',
        },
      },
      required: ['guestId'],
    },
  },
  {
    name: 'list_companies',
    title: 'List Company Profiles',
    description: 'Fetch company profiles (typ=1)',
    query: `
      SELECT
        kdnr AS company_id,
        name1 AS company_name,
        name2 AS name2,
        email,
        telefonnr AS phone,
        strasse AS street,
        plz AS postal_code,
        ort AS city,
        land AS country,
        vatno AS vat_number,
        iata AS iata_code,
        contract AS contract_code,
        comcode AS commission_code,
        aufenth AS total_bookings,
        naechte AS total_nights,
        logis AS room_revenue,
        fb AS fb_revenue,
        extras AS extras_revenue
      FROM proteluser.kunden
      WHERE typ = 1
      ORDER BY name1
    `,
  },
  {
    name: 'list_travel_agents',
    title: 'List Travel Agent Profiles',
    description: 'Fetch travel agent profiles (typ=0)',
    query: `
      SELECT
        kdnr AS agent_id,
        name1 AS agent_name,
        name2 AS name2,
        email,
        telefonnr AS phone,
        strasse AS street,
        plz AS postal_code,
        ort AS city,
        land AS country,
        iata AS iata_code,
        contract AS contract_code,
        comcode AS commission_code,
        aufenth AS total_bookings,
        naechte AS total_nights,
        logis AS room_revenue
      FROM proteluser.kunden
      WHERE typ = 0
      ORDER BY name1
    `,
  },

  // ============================================
  // ROOM OPERATIONS
  // ============================================
  {
    name: 'list_rooms',
    title: 'List All Rooms',
    description: 'Fetch all rooms with their categories',
    query: `
      SELECT
        z.zinr AS room_id,
        z.ziname AS room_number,
        z.kat AS category_id,
        k.kat AS category_code,
        k.bez AS category_name,
        z.beschr AS description,
        z.besonder AS features,
        z.floor,
        z.stdbel AS default_occupancy,
        z.hdabt AS housekeeping_section
      FROM proteluser.zimmer z
      LEFT JOIN proteluser.kat k ON z.kat = k.katnr
      ORDER BY z.ziname
    `,
  },
  {
    name: 'list_room_categories',
    title: 'List Room Categories',
    description: 'Fetch all room categories',
    query: `
      SELECT
        katnr AS category_id,
        kat AS category_code,
        bez AS category_name,
        zimmer AS room_count,
        stdpreis AS default_rate_type,
        stderw AS default_adults,
        erw AS max_adults,
        featdesc AS features,
        extdesc AS extended_description,
        issuite
      FROM proteluser.kat
      ORDER BY katnr
    `,
  },
  {
    name: 'get_room_availability',
    title: 'Get Room Availability',
    description: 'Check room availability for a date range by category',
    query: `
      SELECT
        k.katnr AS category_id,
        k.kat AS category_code,
        k.bez AS category_name,
        COUNT(z.zinr) AS total_rooms,
        COUNT(z.zinr) - COALESCE(occupied.cnt, 0) AS available_rooms
      FROM proteluser.kat k
      LEFT JOIN proteluser.zimmer z ON z.kat = k.katnr
      LEFT JOIN (
        SELECT b.katnr, COUNT(DISTINCT b.zimmernr) AS cnt
        FROM proteluser.buch b
        WHERE b.buchstatus IN (0, 1)
          AND b.datumvon <= @checkOut
          AND b.datumbis > @checkIn
        GROUP BY b.katnr
      ) occupied ON occupied.katnr = k.katnr
      WHERE k.zimmer > 0
      GROUP BY k.katnr, k.kat, k.bez, occupied.cnt
      ORDER BY k.katnr
    `,
    parametersSchema: {
      type: 'object',
      properties: {
        checkIn: {
          type: 'string',
          format: 'date',
          description: 'Check-in date (YYYY-MM-DD)',
        },
        checkOut: {
          type: 'string',
          format: 'date',
          description: 'Check-out date (YYYY-MM-DD)',
        },
      },
      required: ['checkIn', 'checkOut'],
    },
  },

  // ============================================
  // POSTING/FOLIO OPERATIONS
  // ============================================
  {
    name: 'get_reservation_postings',
    title: 'Get Reservation Postings',
    description: 'Fetch all postings/charges for a reservation',
    query: `
      SELECT
        l.tan AS posting_id,
        l.buchnr AS reservation_id,
        l.kundennr AS guest_id,
        l.datum AS posting_date,
        l.uhrzeit AS posting_time,
        l.text AS description,
        l.zustext AS additional_text,
        l.epreis AS amount,
        l.anzahl AS quantity,
        l.epreis * l.anzahl AS total,
        l.ukto AS revenue_code,
        u.bez AS revenue_description,
        l.mwstsatz AS vat_rate,
        l.rechnung AS invoice_number,
        l.bediener AS posted_by,
        l.zimmer AS room_number
      FROM proteluser.leist l
      LEFT JOIN proteluser.ukto u ON l.ukto = u.uktonr
      WHERE l.buchnr = @reservationId
      ORDER BY l.datum DESC, l.tan DESC
    `,
    parametersSchema: {
      type: 'object',
      properties: {
        reservationId: {
          type: 'number',
          description: 'Reservation ID (buchnr)',
        },
      },
      required: ['reservationId'],
    },
  },
  {
    name: 'get_daily_postings',
    title: 'Get Daily Postings',
    description: 'Fetch all postings for a specific date',
    query: `
      SELECT
        l.tan AS posting_id,
        l.buchnr AS reservation_id,
        l.datum AS posting_date,
        l.text AS description,
        l.epreis AS amount,
        l.anzahl AS quantity,
        l.epreis * l.anzahl AS total,
        l.ukto AS revenue_code,
        u.bez AS revenue_description,
        l.zimmer AS room_number,
        l.bediener AS posted_by
      FROM proteluser.leist l
      LEFT JOIN proteluser.ukto u ON l.ukto = u.uktonr
      WHERE CAST(l.datum AS DATE) = @postingDate
      ORDER BY l.ukto, l.tan
    `,
    parametersSchema: {
      type: 'object',
      properties: {
        postingDate: {
          type: 'string',
          format: 'date',
          description: 'Posting date (YYYY-MM-DD)',
        },
      },
      required: ['postingDate'],
    },
  },

  // ============================================
  // REVENUE/STATISTICS OPERATIONS
  // ============================================
  {
    name: 'list_revenue_codes',
    title: 'List Revenue Codes',
    description: 'Fetch all revenue/posting codes',
    query: `
      SELECT
        uktonr AS revenue_code_id,
        bez AS description,
        hotkto,
        vatno AS vat_code
      FROM proteluser.ukto
      ORDER BY uktonr
    `,
  },
  {
    name: 'get_daily_revenue_summary',
    title: 'Get Daily Revenue Summary',
    description: 'Get revenue summary by department for a date',
    query: `
      SELECT
        l.ukto AS revenue_code,
        u.bez AS revenue_description,
        COUNT(*) AS posting_count,
        SUM(l.epreis * l.anzahl) AS total_revenue
      FROM proteluser.leist l
      LEFT JOIN proteluser.ukto u ON l.ukto = u.uktonr
      WHERE CAST(l.datum AS DATE) = @reportDate
        AND l.epreis > 0
      GROUP BY l.ukto, u.bez
      ORDER BY total_revenue DESC
    `,
    parametersSchema: {
      type: 'object',
      properties: {
        reportDate: {
          type: 'string',
          format: 'date',
          description: 'Report date (YYYY-MM-DD)',
        },
      },
      required: ['reportDate'],
    },
  },
  {
    name: 'get_occupancy_statistics',
    title: 'Get Occupancy Statistics',
    description: 'Get occupancy statistics for a date range',
    query: `
      SELECT
        CAST(b.datumvon AS DATE) AS date,
        COUNT(DISTINCT b.buchnr) AS reservations,
        SUM(b.anzahl) AS guests,
        SUM(DATEDIFF(day,
          CASE WHEN b.datumvon < @fromDate THEN @fromDate ELSE b.datumvon END,
          CASE WHEN b.datumbis > @toDate THEN @toDate ELSE b.datumbis END
        )) AS room_nights
      FROM proteluser.buch b
      WHERE b.buchstatus IN (1, 2)
        AND b.datumvon <= @toDate
        AND b.datumbis >= @fromDate
      GROUP BY CAST(b.datumvon AS DATE)
      ORDER BY date
    `,
    parametersSchema: {
      type: 'object',
      properties: {
        fromDate: {
          type: 'string',
          format: 'date',
          description: 'Start date (YYYY-MM-DD)',
        },
        toDate: {
          type: 'string',
          format: 'date',
          description: 'End date (YYYY-MM-DD)',
        },
      },
      required: ['fromDate', 'toDate'],
    },
  },

  // ============================================
  // REFERENCE DATA OPERATIONS
  // ============================================
  {
    name: 'list_payment_methods',
    title: 'List Payment Methods',
    description: 'Fetch all payment methods',
    query: `
      SELECT
        zanr AS payment_id,
        za AS payment_code,
        bez AS description,
        typ AS type,
        cc AS is_credit_card,
        eft AS is_eft,
        hidden
      FROM proteluser.zahlart
      WHERE hidden = 0
      ORDER BY zanr
    `,
  },
  {
    name: 'list_reservation_statuses',
    title: 'List Reservation Statuses',
    description: 'Fetch all reservation status codes',
    query: `
      SELECT
        resnr AS status_id,
        resbez AS status_name,
        reschar AS status_type
      FROM proteluser.resstat
      ORDER BY resnr
    `,
  },
  {
    name: 'list_vip_codes',
    title: 'List VIP Codes',
    description: 'Fetch all VIP classification codes',
    query: `
      SELECT
        vipnr AS vip_id,
        vipcode AS vip_code,
        bez AS description
      FROM proteluser.vipcode
      ORDER BY vipnr
    `,
  },
  {
    name: 'list_market_codes',
    title: 'List Market Codes',
    description: 'Fetch all market segment codes',
    query: `
      SELECT
        marketnr AS market_id,
        market AS market_code,
        bez AS description
      FROM proteluser.market
      ORDER BY marketnr
    `,
  },
  {
    name: 'list_source_codes',
    title: 'List Source Codes',
    description: 'Fetch all booking source codes',
    query: `
      SELECT
        sourcenr AS source_id,
        source AS source_code,
        bez AS description
      FROM proteluser.source
      ORDER BY sourcenr
    `,
  },
];

/**
 * Database Schema Reference
 *
 * Main Tables in proteluser schema:
 *
 * buch (Reservations)
 * - buchnr: Reservation ID
 * - kundennr: Guest ID (FK to kunden.kdnr)
 * - zimmernr: Room ID (FK to zimmer.zinr)
 * - katnr: Room category ID (FK to kat.katnr)
 * - datumvon/datumbis: Check-in/Check-out dates
 * - buchstatus: 0=Arrival (not checked in), 1=In-House, 2=Checked-Out
 * - resstatus: Reservation status (FK to resstat.resnr)
 *   - 1=Confirmed, 2=Provisional, 3=Optional, 4=Waiting List, 5=Cancel, 6=No Show, 7=Banquet
 * - anzahl: Number of guests
 * - preis: Rate
 *
 * kunden (Profiles)
 * - kdnr: Profile ID
 * - typ: Profile type
 *   - 0 = Travel Agent
 *   - 1 = Company
 *   - 2 = Guest
 *   - 3 = Group
 * - name1/name2/vorname: Name fields
 * - email, telefonnr, strasse, plz, ort, land: Contact info
 * - aufenth/naechte: Total stays/nights statistics
 * - logis/fb/extras: Revenue statistics
 *
 * zimmer (Rooms)
 * - zinr: Room ID
 * - ziname: Room number/name
 * - kat: Category ID (FK to kat.katnr)
 *
 * kat (Room Categories)
 * - katnr: Category ID
 * - kat: Category code
 * - bez: Description
 *
 * leist (Postings/Charges)
 * - tan: Transaction ID
 * - buchnr: Reservation ID
 * - epreis: Unit price
 * - anzahl: Quantity
 * - ukto: Revenue code (FK to ukto.uktonr)
 *
 * resstat (Reservation Statuses)
 * - resnr: Status ID
 * - resbez: Status name
 */

/**
 * Protel PMS Integration Definition
 *
 * This is a SQL-type integration that connects directly to the Protel MS SQL Server database.
 * The SQL operations above are pre-configured and will be automatically available
 * when the integration is created.
 */
export const protelIntegration: PredefinedIntegration = {
  // Integration identity
  name: 'protel',
  title: 'Protel PMS',
  description:
    'Hotel Property Management System - Direct SQL Access for reservations, guest profiles, rooms, and postings',

  // Mark as SQL integration
  type: 'sql',

  // SQL integrations use basic_auth (username/password for database)
  defaultAuthMethod: 'basic_auth',

  // REST API connector is empty for SQL integrations
  connector: {
    code: '',
    version: 1,
    operations: [],
    secretBindings: [],
  },

  // SQL connection configuration template
  // User provides server, port, and database at setup time
  sqlConnectionConfig: {
    engine: 'mssql',
    port: 1433,
    readOnly: true,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      connectionTimeout: 30000,
      requestTimeout: 30000,
    },
    security: {
      maxResultRows: 10000,
      queryTimeoutMs: 30000,
      maxConnectionPoolSize: 5,
    },
  },

  // Pre-configured SQL operations for Protel
  sqlOperations: protelSqlOperations,

  // Default capabilities
  defaultCapabilities: {
    canSync: true,
    canPush: false, // Read-only by default for safety
    canWebhook: false,
  },
};
