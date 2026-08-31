// Dublê de lib/db.mjs apoiado no PGlite (Postgres compilado para WASM).
// Usa o MESMO lib/schema.mjs de producao, entao teste e producao nao podem
// divergir de schema.
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA } from '../netlify/functions/lib/schema.mjs';

const pg = new PGlite();

export const sql = (strings, ...values) => {
  const text = strings.reduce(
    (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''),
    '',
  );
  return pg.query(text, values).then((r) => r.rows);
};
sql.query = (text, params = []) => pg.query(text, params).then((r) => r.rows);
sql.transaction = (queries) => Promise.all(queries);

let ready = null;
export function ensureSchema() {
  if (!ready) ready = (async () => { for (const s of SCHEMA) await pg.exec(s); })();
  return ready;
}
