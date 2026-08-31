// api.mjs importa o banco por caminho fixo. Para o teste, geramos uma copia do
// arquivo com esse unico import redirecionado para o dublê PGlite - assim o
// codigo exercitado e byte a byte o mesmo que roda em producao, menos a conexao.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export async function loadApi() {
  const source = resolve(here, '../netlify/functions/api.mjs');
  const patched = (await readFile(source, 'utf8')).replace(
    "from './lib/db.mjs'",
    `from '${pathToFileURL(resolve(here, 'db-stub.mjs')).href}'`,
  ).replace(
    /from '\.\/lib\/(solver|dates)\.mjs'/g,
    (_m, name) =>
      `from '${pathToFileURL(resolve(here, `../netlify/functions/lib/${name}.mjs`)).href}'`,
  );
  const out = resolve(here, '.tmp/api.generated.mjs');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, patched);
  return (await import(pathToFileURL(out).href)).default;
}
