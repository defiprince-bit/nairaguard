# NairaGuard agent (loop + API). Build context: repo root.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY agent/package.json agent/
COPY dashboard/package.json dashboard/
RUN pnpm install --frozen-lockfile --filter ./agent
COPY agent agent
RUN pnpm --filter ./agent build && pnpm --filter ./agent deploy --prod /out

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out ./
# Email templates (welcome sender loads ../templates relative to dist/).
COPY --from=build /app/agent/templates ./templates
USER node
CMD ["node", "dist/index.js"]
