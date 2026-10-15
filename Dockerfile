FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
COPY scripts ./scripts
COPY tsconfig.json ./
RUN npm run build

FROM node:22-bookworm-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY .env.example ./
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV DATABASE_PATH=/app/data/radar.sqlite
EXPOSE 8787
VOLUME ["/app/data"]

CMD ["node", "dist/src/index.js"]
