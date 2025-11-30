#!/usr/bin/env node

/**
 * Script to generate a secure password hash for the admin user
 * Usage: node scripts/generate-admin-password.mjs [password]
 */

import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

function generateSecurePassword(length = 16) {
  const charset =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';

  for (let i = 0; i < length; i++) {
    const randomIndex = randomBytes(1)[0] % charset.length;
    password += charset[randomIndex];
  }

  return password;
}

async function main() {
  const args = process.argv.slice(2);
  let password = args[0];

  // If no password provided, generate a secure one
  if (!password) {
    password = generateSecurePassword();
    console.log('Generated secure password:', password);
  } else {
    console.log('Using provided password:', password);
  }

  // Validate password strength
  if (password.length < 8) {
    console.error('Error: Password must be at least 8 characters long');
    process.exit(1);
  }

  try {
    // Generate hash with cost 12 (same as in the application)
    const hash = await bcrypt.hash(password, 12);

    console.log('\n=== Admin User Setup ===');
    console.log('Password:', password);
    console.log('Hash:', hash);
    console.log('\n=== Environment Variable ===');
    console.log(`Add this to your .env.local file:`);
    console.log(`ADMIN_PASSWORD_HASH="${hash}"`);
    console.log(`ADMIN_EMAIL="admin@yourdomain.com"`);
    console.log(`ADMIN_NAME="System Administrator"`);

    console.log('\n=== Security Notice ===');
    console.log('⚠️  IMPORTANT: Change this password after first login!');
    console.log(
      '⚠️  Store the password securely and do not commit it to version control.',
    );
  } catch (error) {
    console.error('Error generating password hash:', error);
    process.exit(1);
  }
}

main().catch(console.error);
