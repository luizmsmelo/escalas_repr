import { neon } from '@neondatabase/serverless';

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

export function createDriver() {
  const url =
    process.env.NETLIFY_DATABASE_URL ||
    process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
    process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      'Banco de dados nao configurado. Abra /api/health neste mesmo site para ver ' +
        'exatamente qual variavel de ambiente esta faltando.',
    );
  }
  return neon(url);
}
