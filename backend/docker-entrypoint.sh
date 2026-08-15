#!/bin/sh
set -e

# Corrige o dono dos diretórios de dados em tempo de execução. Como volumes
# nomeados são montados por cima do diretório da imagem, o chown do Dockerfile
# não os alcança; sem isso o usuário 'node' não consegue gravar a sessão
# do WhatsApp nem os uploads.
chown -R node:node /app/.wwebjs_auth /app/uploads

# Baixa privilégios para o usuário 'node' (não-root) e executa o comando real.
# HOME precisa apontar para o diretório do usuário (e não /root) para que
# ferramentas como o Puppeteer/Chromium não tentem gravar em /root.
export HOME=/home/node
exec setpriv --reuid=1000 --regid=1000 --init-groups "$@"