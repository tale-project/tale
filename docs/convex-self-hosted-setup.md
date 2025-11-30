# Convex Self-Hosted Setup Guide

This guide explains how to configure and use Convex self-hosted backend with PostgreSQL in the Tale platform.

## Overview

The Tale platform uses Convex self-hosted backend for real-time data synchronization and serverless functions. The backend is configured to use PostgreSQL as the persistence layer.

## Configuration

### Environment Variables

The following environment variables are required in your `.env` file:

```bash
# PostgreSQL connection for Convex backend
# IMPORTANT: Do NOT include database name or query parameters
POSTGRES_URL=postgresql://tale:tale_password_change_me@db:5432

# Instance name (also used as database name)
INSTANCE_NAME=tale_platform

# Optional: Disable SSL requirement for local development
DO_NOT_REQUIRE_SSL=1
```

### Key Points

1. **POSTGRES_URL Format**:

   - ✅ **Correct**: `postgresql://user:password@host:port`
   - ❌ **Wrong**: `postgresql://user:password@host:port/database_name`
   - Do NOT include database name or query parameters

2. **Database Name**:

   - The database name is specified by `INSTANCE_NAME`
   - Default: `tale_platform`

3. **Database Creation**:
   - The database is automatically created by the init script using the `INSTANCE_NAME` variable
   - Default database name: `tale_platform`
   - Location: `services/db/init-scripts/02-create-convex-database.sql`
   - To use a different database name, set `INSTANCE_NAME` in your `.env` file

## Docker Compose Configuration

The `compose.yml` file is configured to pass the correct environment variables to the platform service:

```yaml
environment:
  # PostgreSQL connection (without database name)
  POSTGRES_URL: ${POSTGRES_URL:-postgresql://tale:tale_password_change_me@db:5432}

  # Instance configuration
  INSTANCE_NAME: ${INSTANCE_NAME:-tale_platform}
  INSTANCE_SECRET: ${INSTANCE_SECRET}

  # Convex URLs
  CONVEX_CLOUD_ORIGIN: ${CONVEX_CLOUD_ORIGIN:-http://127.0.0.1:3210}
  CONVEX_SITE_ORIGIN: ${CONVEX_SITE_ORIGIN:-http://127.0.0.1:3211}

  # Security
  DO_NOT_REQUIRE_SSL: ${DO_NOT_REQUIRE_SSL:-false}
```

## Verification

### 1. Check Database Creation

After starting the services, verify the database was created:

```bash
# Connect to PostgreSQL
docker compose exec db psql -U tale -d tale_platform

# List tables (should show Convex tables after first deployment)
\dt
```

### 2. Check Convex Backend Logs

```bash
# View platform service logs
docker compose logs platform

# Look for successful database connection
# Expected log: "Connected to Postgres"
```

### 3. Generate Admin Key

```bash
# Generate an admin key for CLI access
docker compose exec platform ./generate_admin_key.sh
```

## Usage

### Deploy Convex Functions

```bash
# In your project directory
npx convex dev
```

### Environment Variables for Development

Create a `.env.local` file in your project root:

```bash
CONVEX_SELF_HOSTED_URL='http://localhost:3210'
CONVEX_SELF_HOSTED_ADMIN_KEY='<your-admin-key>'
```

## Troubleshooting

### Issue: "Failed to connect to database"

**Solution**: Verify that:

1. `POSTGRES_URL` does NOT include the database name
2. The database `tale_platform` exists
3. The PostgreSQL service is running

### Issue: "Database not found"

**Solution**:

1. Check that `INSTANCE_NAME` matches the database name (with `-` → `_`)
2. Verify the init script ran successfully:
   ```bash
   docker compose logs db | grep "Convex database"
   ```

### Issue: "SSL connection required"

**Solution**: Set `DO_NOT_REQUIRE_SSL=1` in your `.env` file for local development

## Migration from SQLite

If you're migrating from SQLite to PostgreSQL:

1. Export your data:

   ```bash
   npx convex export --path backup.zip
   ```

2. Update environment variables to use PostgreSQL

3. Restart the backend:

   ```bash
   docker compose down
   docker compose up -d
   ```

4. Import your data:
   ```bash
   npx convex import --replace-all backup.zip
   ```

## References

- [Convex Self-Hosted Documentation](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md)
- [Convex PostgreSQL Setup](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md#connecting-to-postgres-on-neon)
- [Convex Environment Variables](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md#optional-configurations)

## Production Considerations

For production deployments:

1. **Use a managed PostgreSQL service** (e.g., AWS RDS, Google Cloud SQL, Neon)
2. **Enable SSL**: Remove `DO_NOT_REQUIRE_SSL` and configure SSL certificates
3. **Set a strong `INSTANCE_SECRET`**: Generate with `openssl rand -hex 32`
4. **Configure proper backup strategy**: Use PostgreSQL backup tools
5. **Monitor database performance**: Ensure backend and database are in the same region
6. **Set up proper authentication**: Configure admin keys securely

## Database Schema

Convex manages its own schema automatically. You don't need to create tables manually. The backend will create the necessary tables on first run:

- `_tables`: Metadata about Convex tables
- `_documents`: Document storage
- `_indexes`: Index definitions
- `_modules`: Convex function modules
- And other internal tables

## Performance Tips

1. **Co-locate backend and database**: Deploy in the same region/datacenter
2. **Monitor query performance**: Use PostgreSQL's `pg_stat_statements`
3. **Adjust connection pool**: Configure based on your workload
4. **Regular maintenance**: Run `VACUUM` and `ANALYZE` periodically

## Support

For issues and questions:

- [Convex Discord](https://discord.gg/convex) - `#self-hosted` channel
- [GitHub Issues](https://github.com/get-convex/convex-backend/issues)
