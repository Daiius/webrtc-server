FROM node:20

WORKDIR /mediasoup

COPY server.ts .

RUN npm -g install pnpm

RUN pnpm install mediasoup socket.io tsx

CMD ["pnpm", "tsx", "server.ts"]

