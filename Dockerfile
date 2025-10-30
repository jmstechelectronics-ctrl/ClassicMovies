# ---- build a tiny, reliable Node image
FROM node:18-alpine

# app dir
WORKDIR /app

# install only what we need
COPY package*.json ./
RUN npm install --production

# copy source
COPY . .

# env (Koyeb injects PORT; we default to 8080)
ENV NODE_ENV=production
ENV PORT=8080

# start the addon
CMD ["node", "index.js"]
