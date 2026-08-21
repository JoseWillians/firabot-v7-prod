FROM node:lts-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:lts-alpine AS production

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node documentos ./documentos

RUN mkdir -p /app/auth /app/documentos && chown -R node:node /app

USER node

CMD ["node", "dist/index.js"]
