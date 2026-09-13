FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ARG VITE_SUPPORT_WHATSAPP_URL=https://wa.me/5586999696897?text=Ol%C3%A1!%20Preciso%20de%20ajuda%20com%20o%20LanceZap.
ENV VITE_SUPPORT_WHATSAPP_URL=${VITE_SUPPORT_WHATSAPP_URL}

RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
