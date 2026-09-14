// Variaveis de ambiente, de onde quer que a plataforma as entregue.
//
// No Cloudflare Pages elas nao ficam em process.env: chegam a cada requisicao,
// em `context.env`, e o adaptador (functions/api/[[path]].js) as registra aqui
// antes de chamar a API. No Node - testes, ou o Netlify - nada e registrado e
// vale process.env. Assim o resto do codigo le a configuracao de um lugar so.

let bound = null;

/** Chamado pelo adaptador do Cloudflare, uma vez por requisicao. */
export function bindEnv(vars) {
  bound = vars ?? {};
}

export function env() {
  if (bound) return bound;
  return typeof process !== 'undefined' ? process.env : {};
}

/** Onde a API esta rodando, para o diagnostico em /api/health. */
export const platform = () => (bound ? 'cloudflare' : 'node');
