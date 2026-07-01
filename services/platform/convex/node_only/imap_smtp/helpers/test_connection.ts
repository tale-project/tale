'use node';

/**
 * Verify IMAP (and optionally SMTP) credentials by establishing a live
 * connection — the IMAP/SMTP analogue of the SQL `SELECT 1` ping.
 */

import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';

import type { TestConnectionParams, TestConnectionResult } from '../types';

const CONNECT_TIMEOUT_MS = 10000;

export async function testConnection(
  params: TestConnectionParams,
): Promise<TestConnectionResult> {
  // 1. IMAP: connect + logout proves host/port/TLS/credentials for receiving.
  const client = new ImapFlow({
    host: params.imap.host,
    port: params.imap.port,
    secure: params.imap.secure,
    auth: { user: params.imap.user, pass: params.imap.password },
    logger: false,
    socketTimeout: CONNECT_TIMEOUT_MS,
  });

  try {
    await client.connect();
  } catch (error) {
    return {
      success: false,
      error: `IMAP: ${error instanceof Error ? error.message : 'connection failed'}`,
    };
  }
  try {
    await client.logout();
  } catch (error) {
    console.warn(
      '[imap_smtp] IMAP logout failed during test:',
      error instanceof Error ? error.message : error,
    );
  }

  // 2. SMTP (optional): verify proves host/port/TLS/credentials for sending.
  if (params.smtp) {
    const transport = nodemailer.createTransport({
      host: params.smtp.host,
      port: params.smtp.port,
      secure: params.smtp.secure,
      auth: { user: params.smtp.user, pass: params.smtp.password },
      connectionTimeout: CONNECT_TIMEOUT_MS,
    });
    try {
      await transport.verify();
    } catch (error) {
      return {
        success: false,
        error: `SMTP: ${error instanceof Error ? error.message : 'verification failed'}`,
      };
    } finally {
      transport.close();
    }
  }

  return { success: true };
}
