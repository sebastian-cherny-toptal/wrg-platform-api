FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV LEGACY_COMPAT=true
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY ["Default_Questions_and_Answers.xlsx", "./Default_Questions_and_Answers.xlsx"]
RUN mkdir -p var/historical-imports && chown -R node:node var
USER node
CMD ["node", "--max-old-space-size=3000", "dist/main.js"]
