# A PostgreSQL 18 client is required: production Railway Postgres runs v18.
# Node remains a separate build stage so we do not rely on mutable apt repos.
FROM node:22-bookworm-slim AS node_runtime
FROM postgres:18-bookworm
COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node_runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends default-mysql-client && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY package.json package-lock.json ./
# Reproducible, lockfile-pinned dependencies: npm install without a lockfile
# occasionally resolves unreleased AWS SDK transitive versions in CI.
RUN npm ci --omit=dev --ignore-scripts --no-fund --no-audit
COPY backup-runner/watchdog.mjs ./backup-runner/watchdog.mjs
COPY backup-runner/run.mjs ./backup-runner/run.mjs
COPY backup-runner/restore.mjs ./backup-runner/restore.mjs
COPY backup-runner/media.mjs ./backup-runner/media.mjs
COPY backup-runner/mysql.mjs ./backup-runner/mysql.mjs
USER postgres
CMD ["node","backup-runner/run.mjs"]
