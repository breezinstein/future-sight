# Build stage — compile frontend
FROM node:20-alpine AS builder

WORKDIR /app

# Install build deps. Python + build-base are required for better-sqlite3 native build.
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------------------------------------------------------------
# Production stage
# ---------------------------------------------------------------
FROM node:20-alpine AS production

WORKDIR /app

# Tools for graceful shutdown & permission fix
RUN apk add --no-cache dumb-init su-exec python3 make g++

# Create non-root user
RUN addgroup -g 1001 -S fsuser && \
    adduser -S fsuser -u 1001 -G fsuser

# Install production deps (recompile better-sqlite3 against this image's Node).
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled frontend and server source
COPY --from=builder /app/dist ./dist
COPY server ./server

# Drop build tools after npm rebuild is done.
RUN apk del python3 make g++

RUN mkdir -p /app/data && chown -R fsuser:fsuser /app

COPY entrypoint.sh /entrypoint.sh
# Defensive: strip CR characters in case the file was checked out on Windows
# (Git can convert LF -> CRLF without a .gitattributes file). The kernel
# refuses to exec "#!/bin/sh\r" with a "no such file or directory" error.
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3002

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3002/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1));"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server/index.js"]
