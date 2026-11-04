# Dedicated, private Sócio WA-AKG gateway. No voice / broadcast extension.
# Source pinned to the upstream commit already tested with Prospector.
FROM node:22-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates openssl libc6 libstdc++6 libnss3 libglib2.0-0 libx11-6 libxext6 libasound2 libgbm1 && rm -rf /var/lib/apt/lists/*
RUN git init /app && cd /app && git remote add origin https://github.com/mrifqidaffaaditya/WA-AKG.git && git -c protocol.version=2 fetch --depth=1 origin 40dc3f14b51bdc9e7b0ad96003594adeabb85b34 && git checkout --detach FETCH_HEAD && test "$(git rev-parse HEAD)" = "40dc3f14b51bdc9e7b0ad96003594adeabb85b34"
WORKDIR /app
COPY waakg-socio/patch_readonly.py /tmp/patch_readonly.py
RUN python3 /tmp/patch_readonly.py
COPY waakg-socio/patch_interactive.py /tmp/patch_interactive.py
RUN python3 /tmp/patch_interactive.py
RUN npm ci --legacy-peer-deps && npx prisma generate && npm run build && npm prune --omit=dev && npm install --no-save tsx typescript
FROM node:22-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl libnss3 libglib2.0-0 libx11-6 libxext6 libasound2 libgbm1 libstdc++6 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/tsconfig.json ./
COPY waakg-socio/bootstrap.cjs ./scripts/socio-bootstrap.cjs
RUN mkdir -p /app/data/media /app/data/auth && chown -R node:node /app/data
USER node
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV SOCIO_GATEWAY_READ_ONLY=true
EXPOSE 3000
CMD ["sh", "-ec", "npx prisma db push && node scripts/socio-bootstrap.cjs && exec node node_modules/tsx/dist/cli.mjs src/server/index.ts"]
