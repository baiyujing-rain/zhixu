# syntax=docker/dockerfile:1

# ---------- Build stage ----------
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies first for layer caching. `postinstall` (copy-monaco)
# needs `scripts/` to be present, so copy it before `npm ci`.
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci

# Bake the compose service name into the Next rewrites manifest at build time.
# `next start` reads the baked destination and does not re-evaluate runtime env,
# so BACKEND_URL must be present during `npm run build`, not only at runtime.
ARG BACKEND_URL=http://backend:8000
ENV BACKEND_URL=${BACKEND_URL}

COPY . .
RUN npm run build

# ---------- Runtime stage ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/package.json ./package.json

EXPOSE 3000
# Override the 127.0.0.1 binding from package.json's "start" script:
# the container must listen on 0.0.0.0 so the compose network can reach it.
CMD ["npx", "next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
