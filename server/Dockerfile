# Node vastgezet op één versie: de ingebouwde SQLite is in Node 22 nog
# experimenteel, dus we willen niet dat een update daar iets aan verandert.
FROM node:22.22-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src

RUN mkdir -p /app/data
ENV DATA_MAP=/app/data
ENV NODE_OPTIONS=--no-warnings

EXPOSE 3000
CMD ["node", "src/cli.js", "status"]
