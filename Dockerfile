# Stage 1: Build client
FROM node:20-alpine AS client-build
WORKDIR /build/client
COPY app/client/package*.json ./
RUN npm ci
COPY app/client/ ./
RUN npm run build

# Stage 2: Build server
FROM node:20-alpine AS server-build
WORKDIR /build/server
COPY app/server/package*.json ./
RUN npm ci
COPY app/shared/ /build/shared/
COPY app/server/ ./
RUN npm run build

# Stage 3: Production
FROM node:20-alpine AS production
WORKDIR /app
RUN apk add --no-cache tini

COPY app/server/package*.json ./
RUN npm ci --omit=dev
COPY --from=server-build /build/server/dist ./dist
COPY --from=server-build /build/server/prisma ./prisma
COPY --from=client-build /build/client/dist ./public

RUN npx prisma generate

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
