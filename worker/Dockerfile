# syntax=docker/dockerfile:1.7
FROM node:20-alpine

WORKDIR /app

# Install deps first so the layer caches across source changes.
COPY package.json package-lock.json ./
RUN npm ci

# Source is volume-mounted in dev (see docker-compose.yml); for prod builds the
# COPY below makes the image self-contained.
COPY src ./src
COPY tsconfig.json ./

EXPOSE 8080

# tsx runs TypeScript directly — no separate build step needed.
CMD ["npx", "tsx", "src/index.ts"]
