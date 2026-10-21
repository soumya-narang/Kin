FROM public.ecr.aws/docker/library/node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
ENV PORT=8080
EXPOSE 8080
CMD ["npx", "tsx", "src/index.ts"]
