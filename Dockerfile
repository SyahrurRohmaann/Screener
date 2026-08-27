FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start", "--", "-p", "3000"]

# Optional runtime config:
# SCREENER_COINS=BTC,ETH,SOL,XRP
# SCREENER_MIN_SCORE=3
# BINANCE_FAPI_URL=https://fapi.binance.com

# Do not put credentials in this image or repository.

