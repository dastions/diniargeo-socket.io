FROM arm32v7/node:22-bookworm

WORKDIR /app

COPY package.json .
COPY src src
COPY .babelrc .

RUN ls -la

RUN npm install
RUN npm run build

RUN cp -r dist/* .
RUN mkdir /app/database

RUN rm -rf src

EXPOSE 3001

CMD ["npm", "run", "prod"]
