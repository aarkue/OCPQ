FROM node:24-alpine

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app-frontend

COPY package.json .

RUN pnpm install

COPY . .

RUN pnpm run build
CMD [ "pnpm", "run", "preview", "--host", "--port", "4567" ]
