// Teste do preenchimento de app_decisions a partir das semanas antigas, direto
// no SQL (PGlite), sem passar pela API.
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA, BACKFILL_APP_DECISIONS } from '../netlify/functions/lib/schema.mjs';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FALHA:', msg); } };

const novoBanco = async () => {
  const pg = new PGlite();
  for (const s of SCHEMA) await pg.query(s);
  return pg;
};
const lerLinhas = async (pg) => (await pg.query(`select monday::text m, person_id p, day d,
  work_date::text w, position pos from app_decisions order by 1, 2, 3`)).rows;
const resumo = (rows) => rows.map((r) => `${r.m}:${r.p}:${r.d}:${r.pos}`);

console.log('--- preenchimento a partir do explain e das escalas gravadas ---');
{
  const pg = await novoBanco();
  await pg.query(`insert into people (id, name) values (1, 'Ana'), (2, 'Bia'), (3, 'Caio')`);

  // Semana A: tem explain. Pessoa 99 nao existe em people; 3 tem prioridade.
  const explain = { people: [
    { personId: 1, choices: [2, 1], priority: false, days: [{ day: 2, rank: 1, via: 'preferencia' }] },
    { personId: 2, choices: [2, 1], priority: false, days: [{ day: 1, rank: 2, via: 'preferencia' }] },
    { personId: 99, choices: [1], priority: false, days: [{ day: 1, rank: 1, via: 'preferencia' }] },
    { personId: 3, choices: [2], priority: true, days: [{ day: 2, rank: 1, via: 'prioridade' }] },
  ] };
  await pg.query(`insert into weeks (monday, published, explain) values ('2026-09-21', true, $1)`,
    [JSON.stringify(explain)]);

  // Semana B: sem explain, so escalas gravadas e as preferencias da semana.
  await pg.query(`insert into weeks (monday, published) values ('2026-08-31', true)`);
  await pg.query(`insert into preferences (monday, person_id, choice1) values
    ('2026-08-31', 1, 3), ('2026-08-31', 2, 5)`);
  await pg.query(`insert into assignments (monday, person_id, day, rank, via, work_date) values
    ('2026-08-31', 1, 3, 3, 'preferencia', '2026-09-02'),
    ('2026-08-31', 2, 5, 4, 'fila', '2026-09-04'),
    ('2026-08-31', 3, 2, 1, 'manual', '2026-09-01'),
    ('2026-08-31', 1, 4, 2, null, '2026-09-03'),
    ('2026-08-31', 2, 4, null, null, '2026-09-03')`);

  // O proprio SCHEMA ja deixou a marca; sem apagar, nada seria preenchido.
  await pg.query(`delete from settings where key = 'app_decisions_backfill'`);
  for (const s of BACKFILL_APP_DECISIONS) await pg.query(s);

  const rows = await lerLinhas(pg);
  const linhas = resumo(rows);
  ok(JSON.stringify(linhas) === JSON.stringify([
    '2026-08-31:1:3:3', '2026-08-31:1:4:2', '2026-08-31:2:5:4',
    '2026-09-21:1:2:1', '2026-09-21:2:1:2']), `linhas do backfill (${linhas})`);
  ok(rows.map((r) => r.w).join() === '2026-09-02,2026-09-03,2026-09-04,2026-09-22,2026-09-21',
    `work_date = segunda + (dia - 1) (${rows.map((r) => r.w)})`);

  // Marca gravada: rodar de novo, mesmo apagando as linhas, nao refaz nada.
  await pg.query('delete from app_decisions');
  for (const s of BACKFILL_APP_DECISIONS) await pg.query(s);
  ok((await pg.query('select count(*)::int n from app_decisions')).rows[0].n === 0, 'roda uma vez so');
}

console.log('\n--- explain antigo e incompleto ---');
{
  const pg = await novoBanco();
  await pg.query(`insert into people (id, name) values (1, 'Ana'), (2, 'Bia'), (3, 'Caio'), (4, 'Davi')`);
  const explain = { people: [
    // sem priority: conta como falso; rank nulo e abaixo da 3a
    { personId: 1, choices: [1], days: [{ day: 1, rank: null, via: 'preferencia' }] },
    // sem choices ou com choices nulo: conta como vazio
    { personId: 2, days: [{ day: 2, rank: 1, via: 'preferencia' }] },
    { personId: 3, choices: null, priority: false, days: [{ day: 3, rank: 1, via: 'preferencia' }] },
    // sem days: nao ha o que contar; dia fixo e inclusao manual ficam de fora
    { personId: 4, choices: [4], priority: false },
    { personId: 4, choices: [4], priority: false, days: [
      { day: 5, rank: 2, via: 'fixo' }, { day: 4, rank: 4, via: 'voluntario' }] },
  ] };
  await pg.query(`insert into weeks (monday, published, explain) values ('2026-09-21', true, $1)`,
    [JSON.stringify(explain)]);
  // semana sem a chave people
  await pg.query(`insert into weeks (monday, published, explain) values ('2026-09-14', true, '{}')`);
  await pg.query(`delete from settings where key = 'app_decisions_backfill'`);
  for (const s of BACKFILL_APP_DECISIONS) await pg.query(s);
  const linhas = resumo(await lerLinhas(pg));
  ok(JSON.stringify(linhas) === JSON.stringify(['2026-09-21:1:1:4', '2026-09-21:4:4:4']),
    `linhas do explain incompleto (${linhas})`);
}

console.log(`\n${fails === 0 ? 'TODOS OS TESTES PASSARAM' : fails + ' FALHA(S)'}`);
process.exit(fails ? 1 : 0);
