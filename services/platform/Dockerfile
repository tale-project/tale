# ============================================================================
# Tale Platform Dockerfile
# ============================================================================
# This Dockerfile builds the Tale platform (Next.js + Convex Backend)
# It uses the official Convex backend image as the base to ensure compatibility
# Both Next.js and Convex backend run in the same container

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

# ============================================================================
# Stage 1: Dependencies
# ============================================================================
# Use the official Convex backend image as base - it already has Node.js and all binaries
FROM ghcr.io/get-convex/convex-backend:272e7f4d46f0a9189d6e167f39f07d152b409fed AS deps

# Install dependencies required for node-gyp and building
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files for npm workspace installation
# The lock file was generated with workspaces, so we need the workspace structure
COPY package.json package-lock.json ./
COPY services/platform/package.json ./services/platform/package.json

# Install platform workspace dependencies (including devDependencies for TypeScript build)
RUN npm ci --fetch-timeout=600000 --fetch-retries=10 -w @tale/platform

# ============================================================================
# Stage 2: Builder
# ============================================================================
FROM ghcr.io/get-convex/convex-backend:272e7f4d46f0a9189d6e167f39f07d152b409fed AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source from services/platform directory
COPY services/platform/ .

# Set environment variables for build
ENV NEXT_TELEMETRY_DISABLED=1

# Note: convex/_generated/* files are committed to git and maintained by the dev workflow.
# Developers must run `npx convex codegen` locally after schema/function changes.
# The convex deploy at runtime will also regenerate these if needed.

# Ensure TypeScript and platform-specific binaries are available
# TypeScript is needed for next.config.ts transpilation (workspace resolution differs from isolated context)
# Native binaries needed for Linux: @next/swc, @swc/core, @parcel/watcher, lightningcss, @tailwindcss/oxide
# These are platform-specific and must be installed for Linux since package-lock.json was generated on macOS
# Remove ALL platform-specific binaries first (macOS, Windows, wrong Linux arch), then install correct Linux variant
RUN rm -rf ./node_modules/@next/swc-* 2>/dev/null || true && \
    rm -rf ./node_modules/@swc/core-* 2>/dev/null || true && \
    rm -rf ./node_modules/lightningcss-* 2>/dev/null || true && \
    rm -rf ./node_modules/@parcel/watcher-* 2>/dev/null || true && \
    rm -rf ./node_modules/@tailwindcss/oxide-* 2>/dev/null || true && \
    ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then \
      npm install --no-save typescript \
        @parcel/watcher-linux-x64-glibc \
        lightningcss-linux-x64-gnu \
        @tailwindcss/oxide-linux-x64-gnu \
        @swc/core-linux-x64-gnu \
        next@16.1.1; \
    elif [ "$ARCH" = "aarch64" ]; then \
      npm install --no-save typescript \
        @parcel/watcher-linux-arm64-glibc \
        lightningcss-linux-arm64-gnu \
        @tailwindcss/oxide-linux-arm64-gnu \
        @swc/core-linux-arm64-gnu \
        next@16.1.1; \
    fi

# Set NODE_ENV=production for the build step (after npm install to preserve devDependencies)
ENV NODE_ENV=production

# Build Next.js application
# Note: NEXT_PUBLIC_* variables are set at runtime via env.sh in docker-entrypoint.sh
# The build uses default/placeholder values; actual values are injected at container start
RUN npm run build

# Prune unnecessary files from node_modules to reduce image size (~460MB savings)
# This must be done in the builder stage before copying to runner, because Docker
# layers are immutable - deleting files in a later layer doesn't reduce image size.
# 1. musl binaries: Convex base image uses Ubuntu/glibc, musl binaries are not needed
# 2. SWC compilers: Next.js standalone already includes runtime, build-time compilers not needed
# 3. TypeScript: Convex deploy uses --typecheck disable, so tsc is not needed
# 4. Type definitions: Runtime doesn't need .d.ts files
# 5. Other: test files, source maps, legacy browser fallbacks
RUN find ./node_modules -type d \( -name "*-musl*" -o -name "*linuxmusl*" \) -exec rm -rf {} + 2>/dev/null || true && \
    rm -rf ./node_modules/@next/swc-linux-x64-gnu 2>/dev/null || true && \
    rm -rf ./node_modules/@swc/core-linux-x64-gnu 2>/dev/null || true && \
    rm -rf ./node_modules/typescript 2>/dev/null || true && \
    rm -rf ./node_modules/@types 2>/dev/null || true && \
    rm -rf ./node_modules/pdfjs-dist/legacy 2>/dev/null || true && \
    find ./node_modules -type f -name "*.map" -delete 2>/dev/null || true && \
    find ./node_modules -type d \( -name "test" -o -name "tests" -o -name "__tests__" \) -exec rm -rf {} + 2>/dev/null || true

# Note: docker-entrypoint.sh is already copied as part of "COPY . ."

# ============================================================================
# Stage 3: Convex Dashboard
# ============================================================================
FROM ghcr.io/get-convex/convex-dashboard:272e7f4d46f0a9189d6e167f39f07d152b409fed AS convex-dashboard

# ============================================================================
# Stage 4: Runner
# ============================================================================
# Use the official Convex backend image as base - it already has everything we need
FROM ghcr.io/get-convex/convex-backend:272e7f4d46f0a9189d6e167f39f07d152b409fed AS runner

WORKDIR /app

# Install additional runtime dependencies
# - curl: for health checks
# - tini: for proper signal handling with multiple processes
# - postgresql-client: for database connectivity checks
# - ca-certificates: for trusting custom CA certificates (e.g., Caddy's self-signed CA)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    tini \
    postgresql-client \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /usr/local/share/ca-certificates \
    && chmod 755 /usr/local/share/ca-certificates

# Note: convex-local-backend and generate_key are already in the base image at /convex/
# We'll create symlinks to make them available in PATH and ensure they're executable
RUN chmod +x /convex/convex-local-backend /convex/generate_key && \
    ln -s /convex/convex-local-backend /usr/local/bin/convex-local-backend && \
    ln -s /convex/generate_key /usr/local/bin/generate_key

# Re-declare VERSION arg for this stage (ARGs don't persist across stages)
ARG VERSION=dev

# Set environment variables
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TALE_VERSION=${VERSION}

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


# Copy pruned node_modules for Convex deploy (includes all transitive dependencies)
# The @convex-dev/* packages require many dependencies (zod, ai, better-auth, etc.)
# Note: node_modules was already pruned in the builder stage to remove unnecessary files
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

