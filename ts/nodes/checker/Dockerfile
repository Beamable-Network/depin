# Builder: install, build, and deploy minimal app
FROM node:20-alpine AS builder

WORKDIR /ts

# Enable corepack and pin pnpm from workspace
RUN corepack enable

# Copy workspace manifests first (better layer caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY nodes/checker ./nodes/checker

# Install full deps to build TypeScript
RUN pnpm install --frozen-lockfile

# Build all required workspace packages (SDK + checker)
RUN pnpm -w -r --filter ./packages/beamable-depin --filter ./nodes/checker run build

# Create a lean, production-only deployment for the checker
WORKDIR /ts/nodes/checker
RUN pnpm --filter . deploy --prod --legacy /app


# Runner: copy deployed app only
FROM node:20-alpine AS runner

WORKDIR /app

# Install curl for simple health checks and create non-root user
RUN apk add --no-cache curl \
  && addgroup -g 1001 -S nodejs \
  && adduser -S checker -u 1001

# Copy prebuilt, production-only app from builder
COPY --from=builder /app .

USER checker

CMD ["node", "dist/src/index.js"]

