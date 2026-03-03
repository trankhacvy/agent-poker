# ── Stage 1: Install dependencies ──
FROM node:22-slim AS base

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

# Copy all package.json files for install
COPY apps/game-server/package.json apps/game-server/package.json
COPY packages/program-clients/package.json packages/program-clients/package.json

# Install all dependencies (including dev for tsx)
RUN pnpm install --frozen-lockfile

# ── Stage 2: Copy source & run ──
FROM base AS runner

WORKDIR /app

# Copy node_modules from install stage
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/apps/game-server/node_modules ./apps/game-server/node_modules
COPY --from=base /app/packages/program-clients/node_modules ./packages/program-clients/node_modules

# Copy source code
COPY packages/ packages/
COPY apps/game-server/ apps/game-server/

# Set working directory to game-server
WORKDIR /app/apps/game-server

ENV NODE_ENV=production

# Railway injects PORT at runtime; 3001 is the local default
EXPOSE ${PORT:-3001}

# Start server with tsx (no build step needed)
CMD ["node", "--import", "tsx/esm", "src/server.ts"]
