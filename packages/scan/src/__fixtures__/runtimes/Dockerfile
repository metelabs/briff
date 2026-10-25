# syntax=docker/dockerfile:1
ARG PHP_VERSION=8.3
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS assets
RUN npm ci

FROM php:8.3-fpm-alpine AS app
COPY --from=assets /app/public /var/www/public

FROM php:${PHP_VERSION}-cli AS cli
FROM app AS final
FROM \
  docker.io/library/nginx:1.27.2-alpine
FROM scratch
FROM ghcr.io/acme/tools:2.1 AS tools
FROM mcr.microsoft.com/dotnet/aspnet:8.0
FROM denoland/deno:alpine-2.0.6
FROM golang@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
FROM node:22@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210
FROM node
