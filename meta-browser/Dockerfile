FROM node:24-bookworm-slim
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx --no-install playwright-core install --with-deps chromium && apt-get update && apt-get install -y --no-install-recommends gosu python3 python3-venv && rm -rf /var/lib/apt/lists/* && chmod -R a+rX /opt/browsers
# Same reviewed edge-tts version used by Prospector. Isolated virtualenv; no credentials baked in.
RUN python3 -m venv /opt/socio-tts && /opt/socio-tts/bin/pip install --no-cache-dir edge-tts==7.3.0
COPY . .
RUN chmod +x /app/meta-browser/entrypoint.sh
ENV NODE_ENV=production SOCIO_META_BROWSER_DIR=/data/meta-browser
ENTRYPOINT ["/app/meta-browser/entrypoint.sh"]
CMD ["node","server.mjs"]
