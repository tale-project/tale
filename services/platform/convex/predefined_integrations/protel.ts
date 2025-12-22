/**
 * Protel PMS SQL Integration Definition
 *
 * Predefined integration for Protel Property Management System via direct SQL access.
 * This is a SQL-type integration that connects directly to the Protel MS SQL Server database.
 */

import type { PredefinedIntegration } from './types';

export const protelIntegration: PredefinedIntegration = {
  // Integration identity
  name: 'protel',
  title: 'Protel PMS',
  description:
    'Hotel Property Management System - Direct SQL Access for reservations, guest profiles, and room availability',

  // SQL integrations use basic_auth (username/password for database)
  defaultAuthMethod: 'basic_auth',

  // SQL integrations don't use connector code - they use SQL operations
  connector: {
    code: '',
    version: 1,
    operations: [],
    secretBindings: [],
  },

  // SQL-specific configuration
  defaultConnectionConfig: {
    // These would be filled in by the user when creating the integration
    // server: 'protel.hotel.local',
    // port: 1433,
    // database: 'protel_db',
  },

  defaultCapabilities: {
    canSync: true,
    canPush: false, // Read-only by default
    canWebhook: false,
  },
};

/**
 * SQL Operations for Protel PMS
 *
 * These are the pre-configured SQL queries that users can use with this integration.
 * Users can also add custom queries when creating their integration instance.
 */
export const protelSqlOperations = [
  {
    name: 'get_reservations',
    title: 'Get Reservations',
    description: 'Fetch reservations by status and date',
    query: `
      SELECT
        buchNr,
        gastNr,
        datum,
        buchstatus,
        von,
        bis,
        anzPers,
        zimmerNr
      FROM proteluser.buch
      WHERE buchstatus = @status
        AND datum >= @fromDate
      ORDER BY datum, buchNr
    `,
    parametersSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'number',
          description:
            'Reservation status (0=arrival, 1=in-house, 2=checked-out)',
        },
        fromDate: {
          type: 'string',
          format: 'date',
          description: 'Start date (YYYY-MM-DD)',
        },
      },
      required: ['status'],
    },
  },
  {
    name: 'get_guest_profile',
    title: 'Get Guest Profile',
    description: 'Fetch guest/company profile by type',
    query: `
      SELECT
        gastNr,
        typ,
        name1,
        name2,
        strasse,
        plz,
        ort,
        land,
        email,
        telefon
      FROM proteluser.kunden
      WHERE typ = @profileType
        AND gastNr = @guestNumber
    `,
    parametersSchema: {
      type: 'object',
      properties: {
        profileType: {
          type: 'number',
          description: 'Profile type (0=guest, 1=agent, 2=company, 3=group)',
        },
        guestNumber: {
          type: 'number',
          description: 'Guest number',
        },
      },
      required: ['profileType', 'guestNumber'],
    },
  },
  {
    name: 'get_arrivals_today',
    title: "Get Today's Arrivals",
    description: 'Get all arrivals for today',
    query: `
      SELECT
        buchNr,
        gastNr,
        zimmerNr,
        von,
        bis,
        anzPers
      FROM proteluser.buch
      WHERE buchstatus = 0
        AND von = CAST(GETDATE() AS DATE)
      ORDER BY zimmerNr
    `,
  },
  {
    name: 'get_availability',
    title: 'Get Room Availability',
    description: 'Check room availability for date range',
    query: `
      SELECT
        COUNT(*) as availableRooms
      FROM proteluser.zimmer z
      WHERE NOT EXISTS (
        SELECT 1
        FROM proteluser.buch b
        WHERE b.zimmerNr = z.zimmerNr
          AND b.buchstatus IN (0, 1)
          AND (
            (b.von <= @checkIn AND b.bis > @checkIn)
            OR (b.von < @checkOut AND b.bis >= @checkOut)
            OR (b.von >= @checkIn AND b.bis <= @checkOut)
          )
      )
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
];

/**
 * Database Field Reference (from Panagiotis)
 *
 * Table: proteluser.buch (Reservations)
 * - buchstatus: 0=arrival, 1=in-house, 2=checked-out
 *
 * Table: proteluser.kunden (Profiles)
 * - typ: Profile type
 *   - 0 = agent
 *   - 1 = company
 *   - 2 = guest
 *   - 3 = group profile
 */
