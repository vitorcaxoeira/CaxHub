FROM node:22-alpine

# chromium + fontes: o relatório do 5S vira PDF num Chromium headless (src/lib/relatorioPdf.ts).
# font-noto-emoji cobre os emojis (🏆🥇) e font-noto os acentos/símbolos; sem fontes o PDF sai com quadrados.
RUN apk add --no-cache openssl chromium font-noto font-noto-emoji
ENV CHROME_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate
RUN npm run build

EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
