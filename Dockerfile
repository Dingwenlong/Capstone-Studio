FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit

FROM node:24-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 BIND_ADDRESS=0.0.0.0 PORT=3410
WORKDIR /app
COPY --from=builder --chown=node:node /app /app
USER node
CMD ["node","--import","tsx","server.ts"]
