import { createDriver } from './driver.mjs';
import { SCHEMA } from './schema.mjs';

// A conexao e criada na primeira consulta, e nao no import: assim uma variavel
// de ambiente faltando vira uma mensagem legivel na tela, e nao um 500 opaco.
let driver = null;
const db = () => (driver ??= createDriver());

/** Template tag com parametros ligados: sql`select ... ${valor}` */
export const sql = (...args) => db()(...args);

/**
 * SQL cru, sem interpolacao de parametros. Usado so para o schema - nunca
 * passe entrada de usuario por aqui.
 */
sql.query = (text, params = []) => db()(text, params);

/** Varias consultas num unico round-trip, na ordem dada e de forma atomica. */
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
