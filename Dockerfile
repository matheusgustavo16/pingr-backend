FROM node:20-bookworm-slim

# ffmpeg: pipeline de transcrição (spawn direto do binário, sem lib npm).
# python3/build-essential/pkg-config/ninja-build: mediasoup compila um
# worker nativo em C++ no install (node-gyp/meson) e precisa disso.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      build-essential \
      pkg-config \
      ninja-build \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia tudo antes do install: o postinstall roda `prisma generate`, que
# precisa de prisma/schema.prisma já presente no diretório.
COPY . .
RUN npm ci

EXPOSE 3001
CMD ["npm", "start"]
