FROM node:20 as builder

WORKDIR /app

COPY ./ ./

COPY ./ ./

RUN npm install

RUN npx tsc

FROM ghcr.io/joepbuhre/boilerplate-puppeteer-docker as target

WORKDIR /app

COPY --from=builder /app/dist ./
COPY --from=builder /app/package* ./
COPY --from=builder /app/src/index.html ./src/index.html

RUN mkdir tmp

RUN npm install --omit=dev

ENV NODE_ENV=production

ENTRYPOINT ["node", "/app"]