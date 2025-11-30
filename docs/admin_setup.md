# Admin User Setup Guide

This guide explains how to set up the initial admin user for the Lanserhof application.

## 🚀 Quick Start (Development)

For local development, the system automatically creates a default admin user:

- **Email**: `admin@lanserhof.local`
- **Password**: `admin123`
- **Role**: `Admin`

⚠️ **IMPORTANT**: Change this password after first login!

## 🔐 Production Setup

For production environments, you should create a secure admin user:

### Step 1: Generate Secure Password

```bash
# Generate a random secure password and hash
pnpm admin:generate-password

# Or use your own password
pnpm admin:generate-password "YourSecurePassword123!"
```

This will output:

- The password (store this securely!)
- The bcrypt hash
- Environment variables to set

### Step 2: Set Environment Variables

Add these to your production environment:

```bash
ADMIN_EMAIL="admin@yourdomain.com"
ADMIN_NAME="System Administrator"
ADMIN_PASSWORD_HASH="$2b$12$..."
```

### Step 3: Deploy and Reset Database

When you deploy with these environment variables, the seed script will create the admin user with your secure credentials.

## 🛠️ Manual Admin User Creation

If you need to manually create an admin user, you can use SQL:

```sql
-- Generate a password hash first using the script
-- Then insert the user
INSERT INTO next_auth.users (
  id,
  name,
  email,
  "emailVerified",
  password_hash,
  role,
  created_at,
  updated_at
) VALUES (
  gen_random_uuid(),
  'Your Name',
  'your-email@domain.com',
  NOW(),
  'your-bcrypt-hash-here',
  'Admin',
  NOW(),
  NOW()
);
```

## 🔄 Changing Admin Password

### Method 1: Through the Application (Recommended)

1. Log in with current admin credentials
2. Go to Profile/Settings
3. Change password through the UI

### Method 2: Database Update

```sql
-- Generate new hash using the script first
UPDATE next_auth.users
SET password_hash = 'new-bcrypt-hash-here',
    updated_at = NOW()
WHERE email = 'admin@yourdomain.com' AND role = 'Admin';
```

## 🔍 Verifying Admin User

To check if the admin user exists:

```sql
SELECT id, name, email, role, created_at
FROM next_auth.users
WHERE role = 'Admin';
```

## 🏗️ Role Hierarchy

The system uses a hierarchical role system:

- **Member** (Level 1) - Basic access
- **Editor** (Level 2) - Can edit content + Member permissions
- **Developer** (Level 3) - Can access dev tools + Editor permissions
- **Admin** (Level 4) - Full system access + Developer permissions

## 🔒 Security Best Practices

1. **Use Strong Passwords**: Minimum 12 characters with mixed case, numbers, and symbols
2. **Change Default Passwords**: Always change the default `admin123` password
3. **Limit Admin Users**: Only create admin users when necessary
4. **Regular Password Updates**: Update admin passwords regularly
5. **Monitor Admin Activity**: Keep track of admin user actions

## 🚨 Troubleshooting

### Admin User Not Created

If the admin user isn't created during database initialization:

1. Check the seed.sql file is present
2. Verify environment variables are set correctly
3. Check database logs for errors
4. Manually run the seed script

### Can't Log In

1. Verify the email and password are correct
2. Check if the user exists in the database
3. Ensure the password hash is valid
4. Check Auth.js configuration

### Password Hash Issues

If you're having issues with password hashes:

```bash
# Test password hashing
node -e "
const bcrypt = require('bcryptjs');
bcrypt.hash('your-password', 12).then(hash => {
  console.log('Hash:', hash);
  bcrypt.compare('your-password', hash).then(valid => {
    console.log('Valid:', valid);
  });
});
"
```

## 📞 Support

If you encounter issues with admin user setup, check:

1. Database migration logs
2. Supabase dashboard for user data
3. Application logs for authentication errors
4. Environment variable configuration
