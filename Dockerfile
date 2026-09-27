# Crash Test: one image with the web app, the API and the worker.
# Needs a PostgreSQL database (DATABASE_URL). Build: docker build -t crash-test .
# Run:   docker run -p 3000:3000 --env-file .env.production crash-test
# Only port 3000 (or $PORT) is served; the API stays on loopback inside the container.

FROM node:24-bookworm-slim AS base
# openssl: Prisma's query engine. ca-certificates: HTTPS to graph8. tini: PID 1 that
# forwards stop signals to the app and reaps exited child processes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- build: install, generate the Prisma client, build the web app
FROM base AS build
# Manifests first, so the dependency layer is cached until they change.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY apps/worker/package.json apps/worker/
COPY packages/ai/package.json packages/ai/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund
COPY . .
# Where the web app forwards /api and /socket.io (baked in at build time).
ARG INTERNAL_API_URL=http://127.0.0.1:4000
ENV INTERNAL_API_URL=${INTERNAL_API_URL}
RUN npm run build && rm -rf apps/web/.next/cache

# ---- runtime
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/start.mjs"]
