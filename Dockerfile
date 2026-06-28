FROM node:22-alpine AS build

RUN apk add --no-cache build-base python3

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json vite.config.ts ./
COPY src/ ./src/
RUN npm run build

RUN npm prune --omit=dev

FROM node:22-alpine

RUN apk add --no-cache dumb-init

WORKDIR /app

COPY --from=build /app/node_modules/ ./node_modules/
COPY --from=build /app/dist/ ./dist/

RUN mkdir -p /app/data/uploads

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server/index.js"]
