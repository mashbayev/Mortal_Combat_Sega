FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY tools ./tools
COPY games.json ./
ENV PORT=8080 ROMS_DIR=/roms
EXPOSE 8080
USER node
CMD ["node", "server/index.js"]
