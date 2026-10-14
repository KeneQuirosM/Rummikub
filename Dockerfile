# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --no-audit --no-fund
COPY shared shared
COPY server server
COPY client client
# Si SERVE_CLIENT=true el contenedor también sirve el cliente (un solo despliegue)
ARG SERVE_CLIENT=true
RUN npm run build -w server && if [ "$SERVE_CLIENT" = "true" ]; then npm run build -w client; else mkdir -p client/dist; fi

# ---------- runtime ----------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
RUN npm init -y >/dev/null && npm pkg set type=module && npm install --omit=dev --no-audit --no-fund socket.io@^4.8.1 && npm cache clean --force
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/client/dist ./public
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node", "dist/index.js"]
