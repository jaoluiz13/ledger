# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json tsconfig.build.json ./
RUN npm ci --ignore-scripts

COPY src/ ./src/
RUN npm run build

# Remove dev dependencies
RUN npm prune --omit=dev

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

# Copy only what's needed to run
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

CMD ["node", "--max-old-space-size=768", "dist/server.js"]
