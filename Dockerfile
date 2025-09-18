# Stage 1
FROM guergeiro/pnpm:lts-latest-alpine AS build
WORKDIR /build
COPY . .
RUN pnpm i && pnpm build

# Stage 2
FROM nginx:stable-alpine AS run
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /build/deployment/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK CMD curl -f http://localhost/ || exit 1