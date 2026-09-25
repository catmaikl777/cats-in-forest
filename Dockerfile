# Бэкенд Shadow Duel (монорепо без npm workspaces).
# Собирает ТОЛЬКО сервер (@sf/server + @sf/shared) — фронт живёт на GitHub Pages.
# Контекст очищен .dockerignore (без node_modules, dist, packages/client).

FROM node:22-alpine AS dependencies

WORKDIR /app
COPY packages/shared/package*.json packages/shared/
RUN npm ci --prefix packages/shared
COPY packages/server/package*.json packages/server/
RUN npm ci --prefix packages/server

FROM node:22-alpine AS runner

ENV NODE_ENV=production
# Colyseus слушает process.env.PORT (default 2567 у нас) — PaaS прокидывает свой
ENV PORT=2567
EXPOSE 2567

WORKDIR /app

# tsconfig сервера extends "../../tsconfig.base.json" — нужен для tsx paths
COPY tsconfig.base.json ./tsconfig.base.json

COPY --from=dependencies /app/packages/shared /app/packages/shared
COPY --from=dependencies /app/packages/server /app/packages/server
COPY packages/shared/src packages/shared/src
COPY packages/server/src packages/server/src
COPY packages/server/tsconfig.json packages/server/tsconfig.json

# Старт: tsx исполняет TS сервера; alias @sf/shared из tsconfig.paths.
CMD ["node", "packages/server/node_modules/tsx/dist/cli.mjs", "packages/server/src/main.ts"]