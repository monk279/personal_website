FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

FROM oven/bun:1 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run assets:generate
RUN bun run build

FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
EXPOSE 3000
CMD ["bun", "run", "src/server/index.ts"]

FROM caddy:2 AS caddy
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile

FROM postgres:17-alpine AS backup
RUN apk add --no-cache tar gzip
COPY --from=build /app/dist /site
COPY scripts/backup.sh /backup.sh
RUN chmod +x /backup.sh
CMD ["/bin/sh", "-c", "while true; do /backup.sh; sleep 86400; done"]
