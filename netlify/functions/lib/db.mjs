import { neon } from '@neondatabase/serverless';
import { SCHEMA } from './schema.mjs';

function connectionString() {
  const url =
    process.env.NETLIFY_DATABASE_URL ||
    process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
    process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'Banco de dados nao configurado. Instale a extensao Neon no Netlify ou defina ' +
        'DATABASE_URL nas variaveis de ambiente do projeto.',
    );
  }
  return url;
}

// A conexao e criada na primeira consulta, e nao no import: assim uma variavel
// de ambiente faltando vira uma mensagem legivel na tela, e nao um 500 opaco.
let client = null;
const db = () => (client ??= neon(connectionString()));

/** Template tag: sql`select ... ${valor}` */
export const sql = (...args) => db()(...args);
/** SQL cru, sem interpolacao (usado so para o schema). */
sql.query = (text, params) => db().query(text, params);
/** Varias consultas num unico round-trip, de forma atomica. */
sql.transaction = (queries) => db().transaction(queries);

// O schema e criado sob demanda, uma vez por instancia da funcao. Assim nao
// existe passo manual de migracao: o primeiro acesso ja deixa o banco pronto.
let ready = null;

export function ensureSchema() {
  if (!ready) {
    ready = sql
      .transaction(SCHEMA.map((stmt) => sql.query(stmt)))
      .catch((err) => {
        ready = null; // permite nova tentativa na proxima requisicao
        throw err;
      });
  }
  return ready;
}
