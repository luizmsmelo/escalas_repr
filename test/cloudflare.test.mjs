// O adaptador do Cloudflare Pages: a mesma API, com a configuracao chegando em
// context.env em vez de process.env. Nao toca no banco - /api/health existe
// justamente para responder sem ele.
import { onRequest } from '../functions/api/[[path]].js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FALHA:', msg); } };

// Garante que o que chega ao app veio de context.env, e nao do ambiente do Node.
for (const k of ['DATABASE_URL', 'NETLIFY_DATABASE_URL', 'NETLIFY_DATABASE_URL_UNPOOLED']) {
  delete process.env[k];
}

const call = async (path, env) => {
  const res = await onRequest({ request: new Request(`https://x.test/api/${path}`), env });
  return { status: res.status, json: await res.json() };
};

console.log('--- adaptador do Cloudflare Pages ---');
const semBanco = await call('health', {});
ok(semBanco.status === 200, `health responde sem banco (${semBanco.status})`);
ok(semBanco.json.ok === false, 'e diz que o banco nao esta configurado');
ok(semBanco.json.plataforma === 'cloudflare', `identifica a plataforma (${semBanco.json.plataforma})`);

// Rota de verdade sem banco: mensagem legivel, nao um erro opaco.
const estado = await call('state', {});
ok(estado.status === 500 && /nao configurado/.test(estado.json.error),
   `state sem banco explica o que falta (${estado.status} ${estado.json.error})`);

const comBanco = await call('health', { DATABASE_URL: 'postgres://usuario:senha@host/banco' });
ok(comBanco.json.ok === true, 'DATABASE_URL de context.env e enxergada');
ok(comBanco.json.variaveisEsperadas.DATABASE_URL === 'definida', 'e reportada como definida');
ok(!JSON.stringify(comBanco.json).includes('senha'), 'o valor da variavel nunca e devolvido');

const rota = await call('inexistente', {});
ok(rota.status !== 200, `rota desconhecida nao responde 200 (${rota.status})`);

console.log(`\n${fails === 0 ? 'TODOS OS TESTES PASSARAM' : fails + ' FALHA(S)'}`);
process.exit(fails ? 1 : 0);
