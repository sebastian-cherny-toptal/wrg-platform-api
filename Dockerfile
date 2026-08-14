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
# Railway pre-deploy containers cannot access mounted volumes, so keep the
# explicitly committed production seed inputs in the runtime image.
COPY secure ./secure
USER node
CMD ["node", "--max-old-space-size=3000", "dist/main.js"]
