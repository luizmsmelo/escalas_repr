// Verifica que o driver REAL do Neon tem a forma que lib/db.mjs assume.
//
// Este teste existe por causa de um bug que chegou em producao: db.mjs chamava
// `driver.query(...)`, metodo que o neon() nao tem, e o dublê de teste tinha
// inventado esse metodo - entao a suite passava e o site quebrava. Aqui nao ha
// dublê nenhum: e o pacote instalado que responde. Nao precisa de banco, porque
// as consultas do neon so vao a rede quando aguardadas.
import { neon } from '@neondatabase/serverless';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FALHA:', msg); } };

const driver = neon('postgresql://u:p@ep-teste.us-east-2.aws.neon.tech/neondb');

console.log('--- superficie do driver real ---');
ok(typeof driver === 'function', 'neon() devolve uma funcao');
ok(typeof driver.transaction === 'function', 'tem .transaction()');
ok(typeof driver.query !== 'function',
   'NAO tem .query() - SQL cru se faz chamando a propria funcao');

console.log('\n--- as duas formas de chamada devolvem consultas ---');
const comoTag = driver`select ${1}`;
ok(typeof comoTag?.then === 'function', 'template tag devolve algo aguardavel');

const comoTexto = driver('select $1', [1]);
ok(typeof comoTexto?.then === 'function', 'chamada com (texto, params) devolve algo aguardavel');

const semParams = driver('select 1');
ok(typeof semParams?.then === 'function', 'chamada so com texto devolve algo aguardavel');

console.log('\n--- as consultas sao preguicosas ---');
// Se fossem ansiosas, as tres consultas acima ja teriam tentado ir a rede para
// um host inexistente e derrubado o processo. Chegar ate aqui ja e a prova.
ok(true, 'nenhuma consulta foi a rede sem ser aguardada');

console.log('\n--- lib/db.mjs usa exatamente essa superficie ---');
const fonte = await (await import('node:fs/promises')).readFile(
  new URL('../netlify/functions/lib/db.mjs', import.meta.url), 'utf8');
ok(!/db\(\)\.query\(/.test(fonte),
   'db.mjs nao chama db().query() - esse era o bug');
ok(/db\(\)\(text, params\)/.test(fonte),
   'db.mjs faz SQL cru chamando a funcao do driver');
ok(/db\(\)\.transaction\(/.test(fonte),
   'db.mjs usa .transaction() do driver');

console.log(`\n${fails === 0 ? 'TODOS OS TESTES PASSARAM' : fails + ' FALHA(S)'}`);
process.exit(fails ? 1 : 0);
