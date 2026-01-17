# ============================================================================
# Tale Platform Dockerfile (Optimized 5-Stage Build)
# ============================================================================
# This Dockerfile builds the Tale platform (Vite SPA + Convex Backend)
# Optimized for performance, size, and reliability with proper monorepo support
#
# Architecture:
#   Stage 1: workspace-deps - Install dependencies with workspace context
#   Stage 2: builder - Build Vite SPA with all devDependencies available
#   Stage 3: pruner - Aggressive post-build cleanup (~160MB savings)
#   Stage 4: convex-dashboard - Copy Convex dashboard
#   Stage 5: runner - Minimal runtime image with security hardening
#
# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

# ============================================================================
# Stage 1: workspace-deps (Dependency Installation with Workspace Context)
# ============================================================================
# Install all dependencies in proper workspace context with architecture-specific binaries
FROM ghcr.io/get-convex/convex-backend:272e7f4d46f0a9189d6e167f39f07d152b409fed AS workspace-deps

# Install build tools for native compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Layer 1: Root workspace context (changes infrequently)
# CRITICAL: Copy root package.json FIRST to establish monorepo workspace structure
COPY package.json package-lock.json ./

# Layer 2: All workspace package.json files
# npm workspaces requires visibility of ALL workspace packages to resolve dependencies correctly
COPY services/platform/package.json ./services/platform/
COPY services/crawler/package.json ./services/crawler/
COPY services/rag/package.json ./services/rag/
COPY services/graph-db/package.json ./services/graph-db/
COPY services/db/package.json ./services/db/
COPY services/proxy/package.json ./services/proxy/
COPY services/search/package.json ./services/search/

# Layer 3: Install ALL workspace dependencies
# CRITICAL: Use npm ci to install all workspaces with proper dependency resolution
# This ensures Vite can resolve all modules correctly including package.json exports
RUN npm ci \
    --legacy-peer-deps \
    --fetch-timeout=600000 \
    --fetch-retries=10

# Verify critical packages were installed
RUN test -d /app/node_modules/convex && echo "✓ convex installed" && \
    test -d /app/node_modules/vite-tsconfig-paths && echo "✓ vite-tsconfig-paths installed" && \
    test -d /app/node_modules/vite && echo "✓ vite installed" && \
    echo "✓ All critical packages verified"

# ============================================================================
# Stage 2: builder (Build Vite SPA)
# ============================================================================
# Build the Vite application with all source code and devDependencies available
# Strategy: Flatten the structure to /app root for simpler module resolution
FROM ghcr.io/get-convex/convex-backend:272e7f4d46f0a9189d6e167f39f07d152b409fed AS builder

WORKDIR /app

# Copy installed dependencies from workspace-deps stage
COPY --from=workspace-deps /app/node_modules ./node_modules

# Copy platform source code directly to /app root (flattened structure)
# This simplifies Vite's module resolution
COPY services/platform/vite.config.ts ./
COPY services/platform/tsconfig.json ./
COPY services/platform/postcss.config.mjs ./
COPY services/platform/tailwind.config.ts ./
COPY services/platform/index.html ./
COPY services/platform/vite-env.d.ts ./
COPY services/platform/tsr.config.json ./
COPY services/platform/components.json ./
COPY services/platform/package.json ./

# Copy source directories
COPY services/platform/app ./app
COPY services/platform/lib ./lib
COPY services/platform/convex ./convex
COPY services/platform/public ./public
COPY services/platform/types ./types
COPY services/platform/messages ./messages
COPY services/platform/vite-plugins ./vite-plugins

# Copy runtime scripts
COPY services/platform/server.js ./
COPY services/platform/docker-entrypoint.sh ./
COPY services/platform/generate_admin_key.sh ./
COPY services/platform/env.sh ./

# Set build environment
ENV NODE_ENV=production

# Build Vite application
# With flattened structure, Vite can resolve all modules correctly
RUN npx vite build

# Verify build succeeded
RUN test -d ./dist && test -f ./dist/index.html || (echo "ERROR: Vite build failed!" && exit 1)

# ============================================================================
# Stage 3: pruner (Aggressive Post-Build Cleanup)
# ============================================================================
# Remove all build-time dependencies and artifacts to minimize image size
FROM builder AS pruner

WORKDIR /app

# Verify build artifacts exist before pruning
RUN test -d ./dist && test -f ./dist/index.html || \
    (echo "ERROR: Build artifacts missing!" && exit 1)

# HIGH-VALUE REMOVALS: Remove all devDependencies (~120MB savings)
# This is safe because build is complete and only runtime deps are needed
RUN npm prune --omit=dev --legacy-peer-deps 2>/dev/null || true

# Remove architecture-specific build-time binaries no longer needed at runtime
RUN rm -rf ./node_modules/@swc/core* 2>/dev/null || true && \
    rm -rf ./node_modules/lightningcss* 2>/dev/null || true && \
    rm -rf ./node_modules/@parcel/watcher* 2>/dev/null || true

# Remove TypeScript compiler and type definitions
# Convex deploy uses --typecheck disable, so TypeScript not needed at runtime
RUN rm -rf ./node_modules/typescript 2>/dev/null || true && \
    rm -rf ./node_modules/@types 2>/dev/null || true

# Remove Storybook packages (build-time only)
RUN rm -rf ./node_modules/@storybook 2>/dev/null || true && \
    rm -rf ./node_modules/storybook 2>/dev/null || true

# MEDIUM-VALUE REMOVALS: Remove musl binaries (~10MB savings)
# Ubuntu/glibc system doesn't need musl variants
RUN find ./node_modules -type d \( -name "*-musl*" -o -name "*linuxmusl*" \) \
    -exec rm -rf {} + 2>/dev/null || true

# Remove source maps (~15MB savings)
RUN find ./node_modules -type f -name "*.map" -delete 2>/dev/null || true

# Remove test files and directories (~10MB savings)
RUN find ./node_modules -type d \( \
      -name "test" -o \
      -name "tests" -o \
      -name "__tests__" -o \
      -name "__mocks__" -o \
      -name "coverage" \
    \) -exec rm -rf {} + 2>/dev/null || true

# LOW-VALUE REMOVALS: Remove documentation (~5MB savings)
RUN find ./node_modules -type f \( \
      -name "*.md" -o \
      -name "*.markdown" -o \
      -name "CHANGELOG*" -o \
      -name "LICENSE*" -o \
      -name "README*" \
    \) -delete 2>/dev/null || true

# Remove legacy browser support (pdfjs-dist legacy builds)
RUN rm -rf ./node_modules/pdfjs-dist/legacy 2>/dev/null || true

# Final verification
RUN echo "Pruning complete. Final node_modules size:" && \
    du -sh ./node_modules && \
    echo "Build artifacts verified:" && \
    ls -lh ./dist/index.html

# ============================================================================
# Stage 4: convex-dashboard (Convex Dashboard)
# ============================================================================
# Unchanged - provides official Convex dashboard
FROM ghcr.io/get-convex/convex-dashboard:272e7f4d46f0a9189d6e167f39f07d152b409fed AS convex-dashboard

# ============================================================================
# Stage 5: runner (Minimal Runtime Image)
# ============================================================================
# Create secure, minimal runtime image with only necessary files
FROM ghcr.io/get-convex/convex-backend:272e7f4d46f0a9189d6e167f39f07d152b409fed AS runner

WORKDIR /app

# Install ONLY runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    tini \
    postgresql-client \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /usr/local/share/ca-certificates \
    && chmod 755 /usr/local/share/ca-certificates

# Setup Convex binaries (symlinks from base image)
RUN chmod +x /convex/convex-local-backend /convex/generate_key && \
    ln -s /convex/convex-local-backend /usr/local/bin/convex-local-backend && \
    ln -s /convex/generate_key /usr/local/bin/generate_key

# Re-declare VERSION arg for this stage (ARGs don't persist across stages)
ARG VERSION=dev

# Set environment variables
ENV NODE_ENV=production
ENV TALE_VERSION=${VERSION}

# Create non-root user (using groupadd/useradd for Ubuntu compatibility)
RUN groupadd --system --gid 1001 nodejs || true && \
    useradd --system --uid 1001 --gid nodejs nextjs || true && \
    mkdir -p /home/nextjs && chmod 777 /home/nextjs

# Create directories with proper permissions
RUN mkdir -p /app/convex-data && chown -R nextjs:nodejs /app/convex-data && \
    mkdir -p /dashboard && chown -R nextjs:nodejs /dashboard

# Copy Convex dashboard from official image
COPY --from=convex-dashboard --chown=nextjs:nodejs /app /dashboard

# Copy pruned application from pruner stage (flattened structure, smaller node_modules)
COPY --from=pruner --chown=nextjs:nodejs /app/dist ./dist
COPY --from=pruner --chown=nextjs:nodejs /app/server.js ./server.js
COPY --from=pruner --chown=nextjs:nodejs /app/convex ./convex
COPY --from=pruner --chown=nextjs:nodejs /app/lib ./lib
COPY --from=pruner --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=pruner --chown=nextjs:nodejs /app/package.json ./package.json

# Copy startup scripts with correct ownership and set execute permissions
COPY --from=pruner --chown=nextjs:nodejs /app/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --from=pruner --chown=nextjs:nodejs /app/generate_admin_key.sh ./generate_admin_key.sh
COPY --from=pruner --chown=nextjs:nodejs /app/env.sh ./env.sh
RUN chmod +x ./docker-entrypoint.sh ./generate_admin_key.sh

# Switch to non-root user for security
USER nextjs

# Expose ports
# 3000: Vite application (served by Node.js static server)
# 3210: Convex backend API
# 3211: Convex HTTP actions
# 6791: Convex dashboard
EXPOSE 3000 3210 3211 6791

# Set runtime environment variables
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV CONVEX_PORT=3210
ENV INSTANCE_NAME=tale_platform

# Use tini as init system for proper signal handling (critical for blue-green deployments)
ENTRYPOINT ["/usr/bin/tini", "--"]

# Start services via docker-entrypoint.sh (orchestrates Vite, Convex, Dashboard)
CMD ["/app/docker-entrypoint.sh"]
