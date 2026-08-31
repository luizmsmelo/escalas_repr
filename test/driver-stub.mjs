// Dublê da CONEXAO apenas (lib/driver.mjs), apoiado no PGlite - Postgres
// compilado para WASM. Todo o resto (db.mjs, schema.mjs, api.mjs) roda como em
// producao.
//
// Precisa imitar o contrato do neon() com fidelidade, porque foi justamente uma
// divergencia aqui que deixou um bug passar: aceitar as duas formas de chamada,
// nao expor um metodo .query, e devolver consultas PREGUICOSAS.
import { PGlite } from '@electric-sql/pglite';

const pg = new PGlite();

/** Consulta preguicosa: so vai ao banco quando aguardada. */
function lazyQuery(text, params) {
  let started = null;
  const run = () => (started ??= pg.query(text, params).then((r) => r.rows));
  return {
    then: (onOk, onErr) => run().then(onOk, onErr),
    catch: (onErr) => run().catch(onErr),
    finally: (fn) => run().finally(fn),
    // usado so pela transaction, para garantir a ordem
    __run: run,
  };
}

const isTemplate = (v) => Array.isArray(v) && Array.isArray(v.raw);

export function createDriver() {
  const driver = (first, ...rest) => {
    if (isTemplate(first)) {
      const text = first.reduce(
        (acc, part, i) => acc + part + (i < rest.length ? `$${i + 1}` : ''), '');
      return lazyQuery(text, rest);
    }
    return lazyQuery(first, rest[0] ?? []);
  };

  // Em ordem e de uma vez so, como o transaction() do neon.
  driver.transaction = async (queries) => {
    const out = [];
    for (const q of queries) out.push(await (q.__run ? q.__run() : q));
    return out;
  };

  return driver;
}
