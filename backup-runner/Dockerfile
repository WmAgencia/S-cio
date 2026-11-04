# A PostgreSQL 18 client is required: production Railway Postgres runs v18.
# Node remains a separate build stage so we do not rely on mutable apt repos.
FROM node:22-bookworm-slim AS node_runtime
FROM postgres:18-bookworm
COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node_runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
WORKDIR /srv
COPY package.json ./package.json
RUN npm install --omit=dev --ignore-scripts --no-fund --no-audit
COPY backup-runner/run.mjs ./backup-runner/run.mjs
COPY backup-runner/restore.mjs ./backup-runner/restore.mjs
USER postgres
CMD ["node","backup-runner/run.mjs"]
