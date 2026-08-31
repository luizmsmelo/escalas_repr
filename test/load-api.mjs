// Monta uma copia de netlify/functions/ em test/.tmp/ trocando UNICAMENTE
// lib/driver.mjs pelo dublê PGlite. Todo o resto - api.mjs, db.mjs, schema.mjs,
// solver.mjs, dates.mjs - e o arquivo de producao, byte a byte.
//
// A copia existe porque os imports sao caminhos relativos fixos; trocar so o
// modulo da conexao garante que a logica de db.mjs (montagem de consultas,
// transacao, migracao) seja de fato exercitada pelos testes.
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FONTE = resolve(here, '../netlify/functions');
const DESTINO = resolve(here, '.tmp/functions');

export async function loadApi() {
  await rm(DESTINO, { recursive: true, force: true });
  await mkdir(dirname(DESTINO), { recursive: true });
  await cp(FONTE, DESTINO, { recursive: true });

  // O unico arquivo substituido.
  const stub = await readFile(resolve(here, 'driver-stub.mjs'), 'utf8');
  await writeFile(resolve(DESTINO, 'lib/driver.mjs'), stub);

  return (await import(pathToFileURL(resolve(DESTINO, 'api.mjs')).href)).default;
}
