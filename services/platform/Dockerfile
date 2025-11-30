# ============================================================================
# Tale Platform Dockerfile
# ============================================================================
# This Dockerfile builds the Tale platform (Next.js + Convex Backend)
# It uses the official Convex backend image as the base to ensure compatibility
# Both Next.js and Convex backend run in the same container

# ============================================================================
# Stage 1: Dependencies
# ============================================================================
# Use the official Convex backend image as base - it already has Node.js and all binaries
FROM ghcr.io/get-convex/convex-backend:f132b187d9d884a97293517e1227b70d57f58d11 AS deps

# Install dependencies required for node-gyp and building
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files from services/platform directory
COPY services/platform/package.json services/platform/package-lock.json ./

# Install dependencies using npm (as per user preference)
RUN npm ci

# ============================================================================
# Stage 2: Builder
# ============================================================================
FROM ghcr.io/get-convex/convex-backend:f132b187d9d884a97293517e1227b70d57f58d11 AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source from services/platform directory
COPY services/platform/ .

# Copy .env file from project root for build-time environment variables
# This allows Next.js to access environment variables during build
COPY .env .env

# Set environment variables for build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Source env.sh to derive NEXT_PUBLIC_* variables from DOMAIN, then build
# This ensures client-side environment variables are embedded in the JavaScript bundle
# Use bash explicitly since env.sh uses bash-specific features like [[
RUN bash -c 'set -a && \
    source ./.env && \
    source ./env.sh && \
    env_normalize_common && \
    npm run build'

# Note: docker-entrypoint.sh is already copied as part of "COPY . ."

# ============================================================================
# Stage 3: Convex Dashboard
# ============================================================================
FROM ghcr.io/get-convex/convex-dashboard:f132b187d9d884a97293517e1227b70d57f58d11 AS convex-dashboard

# ============================================================================
# Stage 4: Runner
# ============================================================================
# Use the official Convex backend image as base - it already has everything we need
FROM ghcr.io/get-convex/convex-backend:f132b187d9d884a97293517e1227b70d57f58d11 AS runner

WORKDIR /app

# Install additional runtime dependencies
# - curl: for health checks
# - tini: for proper signal handling with multiple processes
# - postgresql-client: for database connectivity checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    tini \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Note: convex-local-backend and generate_key are already in the base image at /convex/
# We'll create symlinks to make them available in PATH and ensure they're executable
RUN chmod +x /convex/convex-local-backend /convex/generate_key && \
    ln -s /convex/convex-local-backend /usr/local/bin/convex-local-backend && \
    ln -s /convex/generate_key /usr/local/bin/generate_key

# Set environment variables
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create a non-root user (using groupadd/useradd for Ubuntu compatibility)
RUN groupadd --system --gid 1001 nodejs || true
RUN useradd --system --uid 1001 --gid nodejs nextjs || true

# Create and set permissions for nextjs home directory (needed for npm)
# Make it world-writable so both root and nextjs user can use it
RUN mkdir -p /home/nextjs && chmod 777 /home/nextjs

# Create Convex data directory with proper permissions
RUN mkdir -p /app/convex-data && chown -R nextjs:nodejs /app/convex-data

# Create dashboard directory with proper permissions
RUN mkdir -p /dashboard && chown -R nextjs:nodejs /dashboard

# Copy Convex dashboard from official image
COPY --from=convex-dashboard --chown=nextjs:nodejs /app /dashboard

# Copy necessary files from builder with correct ownership
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy Convex files and configuration with correct ownership
COPY --from=builder --chown=nextjs:nodejs /app/convex ./convex
# Copy shared application libraries used by Convex functions (e.g., lib/utils/toonify)
COPY --from=builder --chown=nextjs:nodejs /app/lib ./lib


COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

# Copy startup script with correct ownership and set execute permission
COPY --from=builder --chown=nextjs:nodejs /app/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Copy admin key generation script with correct ownership and set execute permission
COPY --from=builder --chown=nextjs:nodejs /app/generate_admin_key.sh /app/generate_admin_key.sh
RUN chmod +x /app/generate_admin_key.sh
# Copy shared env normalization script
COPY --from=builder --chown=nextjs:nodejs /app/env.sh /app/env.sh


# Switch to non-root user
USER nextjs

# Expose ports
# 3000: Next.js application
# 3210: Convex backend API
# 3211: Convex HTTP actions
# 6791: Convex dashboard
EXPOSE 3000 3210 3211 6791

# Set environment variables
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV CONVEX_PORT=3210
ENV INSTANCE_NAME=tale_platform

# Use tini as init system for proper signal handling
ENTRYPOINT ["/usr/bin/tini", "--"]

# Start both services
CMD ["/app/docker-entrypoint.sh"]

