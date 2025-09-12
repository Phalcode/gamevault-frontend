# Stage 1
FROM node:lts-alpine AS build
WORKDIR /build
COPY . .
RUN npm i -g pnpm && pnpm i && npm run build

# Stage 2
FROM nginx:stable-alpine AS run
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /build/deployment/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK CMD curl -f http://localhost/ || exit 1