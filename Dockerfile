# syntax=docker/dockerfile:1

# Multi-stage build. The runtime image carries only Next's standalone server
# bundle, the static assets, and the example datasets - no dev dependencies,
# no source, no build cache.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    AWE_DATA_DIR=/data

# Run unprivileged. `node` (uid 1000) ships with the base image.
RUN mkdir -p /data && chown -R node:node /data

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
# Datasets, workflows and fixtures are read at runtime, so they ship with the image.
COPY --from=builder --chown=node:node /app/examples ./examples

USER node
EXPOSE 3000

# Runs are written to /data; mount a volume to keep them across restarts.
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
