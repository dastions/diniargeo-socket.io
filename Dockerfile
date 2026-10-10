# Multi-arch base: the platform decides the image (see README).
#   RevPi / Raspberry:      --platform linux/arm/v7
#   Windows x64 (WSL2/Linux containers): --platform linux/amd64
FROM node:22-bookworm

WORKDIR /app

COPY package.json package-lock.json ./
COPY src src
COPY .babelrc .

RUN ls -la

RUN npm ci
RUN npm run build

RUN cp -r dist/* .
RUN mkdir /app/database

RUN rm -rf src

EXPOSE 3001

CMD ["npm", "run", "prod"]
