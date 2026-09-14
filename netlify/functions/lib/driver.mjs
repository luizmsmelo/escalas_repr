import { neon } from '@neondatabase/serverless';
import { env } from './env.mjs';

// Unico ponto do codigo que fala com o driver do Neon. Fica isolado aqui para
// que os testes possam trocar SO a conexao, deixando toda a logica de db.mjs
// (montagem de consultas, transacao, migracao) rodando de verdade.
//
// Contrato do que `createDriver()` devolve - e exatamente o do `neon()`:
//   driver`select ... ${valor}`     -> template tag, com parametros ligados
//   driver(texto, params)           -> SQL cru (nao ha metodo .query)
//   driver.transaction([q1, q2])    -> varias consultas num round-trip so
// As consultas sao PREGUICOSAS: so vao ao banco quando aguardadas ou quando
// entregues a transaction().
//
// O neon() fala com o banco por HTTP (fetch), e por isso roda igual no Node e
// no Cloudflare.

export function createDriver() {
  const vars = env();
  // NETLIFY_* ficam por compatibilidade com o deploy antigo; no Cloudflare a
  // variavel e DATABASE_URL.
  const url =
    vars.DATABASE_URL ||
    vars.NETLIFY_DATABASE_URL ||
    vars.NETLIFY_DATABASE_URL_UNPOOLED;

  if (!url) {
    throw new Error(
      'Banco de dados nao configurado. Abra /api/health neste mesmo site para ver ' +
        'exatamente qual variavel de ambiente esta faltando.',
    );
  }
  return neon(url);
}
