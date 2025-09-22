# Builder: install, build, and deploy minimal app
FROM node:20-alpine AS builder

WORKDIR /ts

# Enable corepack and pin pnpm from workspace
RUN corepack enable

# Copy workspace manifests first (better layer caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY nodes/worker ./nodes/worker

# Install full deps to build TypeScript
RUN pnpm install --frozen-lockfile

# Build all required workspace packages (SDK + worker)
RUN pnpm -w -r --filter ./packages/beamable-depin --filter ./nodes/worker run build

# Create a lean, production-only deployment for the worker
# Run deploy from the worker package directory to target only this project
WORKDIR /ts/nodes/worker
RUN pnpm --filter . deploy --prod --legacy /app


# Runner: copy deployed app only
FROM node:20-alpine AS runner

WORKDIR /app

# Install curl for healthcheck and create non-root user
RUN apk add --no-cache curl \
  && addgroup -g 1001 -S nodejs \
  && adduser -S worker -u 1001

# Copy prebuilt, production-only app from builder
COPY --from=builder /app .

USER worker

EXPOSE 3000

CMD ["node", "dist/index.js"]