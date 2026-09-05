# --- build stage ---
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime stage ---
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Copy production deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# Copy built app + public assets + next static
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
# Persistent data directory (mount a volume here in production)
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["npm", "start"]
