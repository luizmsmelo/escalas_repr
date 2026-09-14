// Cloudflare Pages: toda requisicao em /api/* chega aqui e segue para a mesma
// API de sempre. A unica diferenca para o Node e de onde vem a configuracao -
// no Cloudflare ela chega em `context.env`, e nao em process.env.
//
// So /api/* executa funcao. Os arquivos de public/ sao servidos direto, sem
// contar na cota de requisicoes das funcoes.
import handler from '../../netlify/functions/api.mjs';
import { bindEnv } from '../../netlify/functions/lib/env.mjs';

export function onRequest(context) {
  bindEnv(context.env);
  return handler(context.request);
}
