FROM oven/bun:1.4.2

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ARG RAILWAY_GIT_COMMIT_SHA
RUN bun run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "src/server/main.ts"]
