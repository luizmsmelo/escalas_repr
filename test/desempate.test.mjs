// Testes das proporcoes de 1a opcao: a API grava o que o app decidiu, soma o
// historico das semanas publicadas e o entrega ao solver. Roda em processo
// proprio, com banco novo (PGlite) - nenhuma outra suite deixa semana publicada
// aqui para entrar nas contas.
import { loadApi } from './load-api.mjs';

const handler = await loadApi();

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, true) : (fail++, console.log('  ✗ ' + msg), false);

// As operacoes de administrador pedem senha: o passe vai em toda chamada.
const SENHA_ADMIN = 'senha de teste bem longa';
process.env.ADMIN_PASSWORD = SENHA_ADMIN;
let passeAdmin = null;
// A publicacao automatica fica desligada: com "hoje" na semana mexida, ela
// publicaria cada semana antes de o teste chegar nela.
process.env.ESCALAS_SEM_PUBLICACAO_AUTOMATICA = '1';

// Cada chamada vive "no dia" da semana que ela mexe (ESCALAS_HOJE = body.monday);
// `hoje` escolhe outro dia.
const call = async (method, path, body, hoje = body?.monday) => {
  if (hoje) process.env.ESCALAS_HOJE = hoje;
  try {
    const headers = passeAdmin ? { 'x-admin-token': passeAdmin } : {};
    const res = await handler(new Request(`https://x.test/api/${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }));
    return { status: res.status, json: await res.json() };
  } finally {
    delete process.env.ESCALAS_HOJE;
  }
};
passeAdmin = (await call('POST', 'admin/login', { password: SENHA_ADMIN })).json.token;

// A previa sai pronta na leitura do estado, montada na hora.
const previa = (monday, hoje = monday) => call('GET', `state?week=${monday}`, undefined, hoje);

const NOMES = ['Luiz Melo','Ana Souza','Bruno Lima','Carla Reis','Diego Alves',
               'Elisa Nunes','Fabio Costa','Gisele Pinto','Hugo Dias'];
const TOP3 = [[1,4,3],[2,1,3],[3,2,4],[4,1,2],[1,2,3],[2,3,4],[3,4,1],[4,2,3],[1,3,4]];
const SEM1 = '2026-03-02';   // marco/2026 nao tem feriado nenhum
const SEM2 = '2026-03-09';
const SEM3 = '2026-03-16';

const ids = {};
for (const n of NOMES) ids[n] = (await call('POST', 'people', { name: n })).json.person?.id;
const nomeDe = (id) => NOMES.find((n) => ids[n] === id);

const marcar = async (monday, choices = TOP3) => {
  for (const [i, n] of NOMES.entries()) {
    await call('POST', 'preferences', { monday, personId: ids[n], choices: choices[i] });
  }
};

// O que o app deveria ter contado de uma semana: as escalas de quem tinha opcoes
// marcadas e que vieram por preferencia, voluntario ou fila. Posicao 1..3 e a
// da lista da pessoa; sexta pela fila e dia fora das opcoes sao a 4a ("abaixo
// da 3a"). Escrito aqui por conta propria, sem usar o codigo que o teste confere.
const esperado = (state) => {
  const comOpcoes = new Set(state.preferences.filter((p) => p.choices.length).map((p) => p.personId));
  const out = new Map();
  for (const a of state.assignments) {
    if (!comOpcoes.has(a.personId)) continue;
    if (!['preferencia', 'voluntario', 'fila'].includes(a.via)) continue;
    const posicao = a.via === 'fila' || a.rank == null ? 4 : a.rank;
    const c = out.get(a.personId) ?? { n: 0, c1: 0, c2: 0, c3: 0 };
    c.n++;
    if (posicao <= 3) c[`c${posicao}`]++;
    out.set(a.personId, c);
  }
  return out;
};

const somar = (...mapas) => {
  const out = new Map();
  for (const m of mapas) {
    for (const [id, c] of m) {
      const t = out.get(id) ?? { n: 0, c1: 0, c2: 0, c3: 0 };
      for (const k of ['n', 'c1', 'c2', 'c3']) t[k] += c[k];
      out.set(id, t);
    }
  }
  return out;
};

const ZERO = { n: 0, c1: 0, c2: 0, c3: 0 };
const forma = (c) => (c ? JSON.stringify([c.n, c.c1, c.c2, c.c3]) : 'ausente');
const dePessoas = (counters) => new Map(counters.perPerson.map((p) => [p.personId, p.pref]));

// Confere o `pref` de todo mundo contra um mapa esperado (ausente = zeros).
const confere = (msg, counters, esp) => {
  const reais = dePessoas(counters);
  const erros = [...reais].filter(([id, pref]) => forma(pref) !== forma(esp.get(id) ?? ZERO))
    .map(([id, pref]) => `${nomeDe(id)}: veio ${forma(pref)}, esperado ${forma(esp.get(id) ?? ZERO)}`);
  return ok(reais.size === NOMES.length && erros.length === 0,
    `${msg}${erros.length ? ' - ' + erros.join('; ') : ` (${reais.size} pessoas)`}`);
};

const stats = async () => (await call('GET', 'stats?month=2026-03', undefined, SEM1)).json.stats;
const media = (esp, ids_) => {
  const razoes = ids_.map((id) => esp.get(id)).filter((c) => c?.n > 0).map((c) => c.c1 / c.n);
  return razoes.length ? Math.round(razoes.reduce((s, x) => s + x, 0) / razoes.length * 100) / 100 : null;
};

console.log('=== 1. publicar grava as decisoes do app ===');
await marcar(SEM1);
const p1 = (await previa(SEM1)).json;
ok(p1.assignments.length === 9, `previa de 02/03 com 9 vagas (${p1.assignments.length})`);
await call('POST', 'publish', { monday: SEM1, published: true });
const pub1 = (await previa(SEM1)).json;
ok(pub1.week.published === true, 'semana de 02/03 publicada');
const esp1 = esperado(pub1);
ok([...esp1.values()].reduce((s, c) => s + c.n, 0) > 0, 'a semana tem escalas que contam');
const st1 = await stats();
confere('stats: pref de cada pessoa e o que o app decidiu na semana publicada', st1.counters, esp1);
confere('state.stats traz o mesmo pref', pub1.stats.counters, esp1);
const base = dePessoas(st1.counters);

console.log('\n=== 2. ajuste manual da semana publicada nao mexe nos contadores ===');
{
  const atuais = pub1.assignments.map((a) => ({ day: a.day, personId: a.personId }));
  const [mover, tirar, dobrar] = pub1.assignments.filter((a, i, todas) =>
    todas.findIndex((b) => b.personId === a.personId) === i);
  const diaLivre = (id, dias) => [1, 2, 3, 4, 5].find((d) =>
    !dias.some((x) => x.personId === id && x.day === d));
  // Move uma pessoa para outro dia, tira outra, e poe uma terceira num segundo dia.
  const slots = atuais
    .filter((s) => s.personId !== tirar.personId)
    .map((s) => (s.personId === mover.personId ? { ...s, day: diaLivre(mover.personId, atuais) } : s));
  slots.push({ day: diaLivre(dobrar.personId, atuais), personId: dobrar.personId });
  const edicao = await call('POST', 'assignments', { monday: SEM1, slots });
  if (ok(edicao.status === 200, `edicao aceita (${edicao.json.error ?? ''})`)) {
    ok(edicao.json.assignments.some((a) => a.via === 'manual'), 'a escala ganhou linhas manuais');
    ok(!edicao.json.assignments.some((a) => a.personId === tirar.personId),
       `${nomeDe(tirar.personId)} saiu da escala`);
    ok(edicao.json.assignments.filter((a) => a.personId === dobrar.personId).length === 2,
       `${nomeDe(dobrar.personId)} ficou com dois dias`);
    confere('state.stats depois da edicao: pref identico ao do passo 1', edicao.json.stats.counters, base);
    confere('stats depois da edicao: pref identico ao do passo 1', (await stats()).counters, base);
  }
}

console.log('\n=== 3. a proxima previa recebe o historico e o desempate roda ===');
await marcar(SEM2);
const p2 = (await previa(SEM2)).json;
ok(p2.week.explain?.tieBreak === 1, `explain.tieBreak === 1 (${p2.week.explain?.tieBreak})`);
{
  const pessoas = p2.week.explain?.people ?? [];
  ok(pessoas.length === 9, `explain com as 9 pessoas (${pessoas.length})`);
  const erros = pessoas.filter((p) => forma(p.prefBefore) !== forma(base.get(p.personId) ?? ZERO))
    .map((p) => `${p.name}: ${forma(p.prefBefore)} contra ${forma(base.get(p.personId) ?? ZERO)}`);
  ok(pessoas.some((p) => p.prefBefore?.n > 0), 'o historico chegou ao solver (alguem com prefBefore.n > 0)');
  ok(erros.length === 0, `prefBefore de cada pessoa e o pref do passo 1${erros.length ? ' - ' + erros.join('; ') : ''}`);
}
// Previa nao conta: o contador continua o do passo 1.
confere('previa de 09/03 nao mexe no pref', (await stats()).counters, base);

console.log('\n=== 4. reabrir tira a semana da conta; publicar de novo devolve ===');
{
  const r = await call('POST', 'publish', { monday: SEM1, published: false });
  ok(r.status === 200 && r.json.week.published === false, 'semana de 02/03 reaberta');
  const s = await stats();
  ok(s.counters.perPerson.every((p) => p.pref?.n === 0), 'todo pref.n === 0 com a semana reaberta');
  ok(s.counters.avgFirstChoice === null, `avgFirstChoice nulo sem historico (${s.counters.avgFirstChoice})`);
  await call('POST', 'publish', { monday: SEM1, published: true });
  confere('publicada de novo: volta ao passo 1', (await stats()).counters, base);
}

console.log('\n=== 5. zerar os contadores zera estes tambem; desfazer devolve ===');
{
  const z = await call('POST', 'reset', {}, '2026-03-20');
  ok(z.status === 200 && z.json.since === '2026-03-20', `contadores zerados em ${z.json.since}`);
  const s = await stats();
  ok(s.counters.perPerson.every((p) => p.pref?.n === 0), 'todo pref.n === 0 depois de zerar');
  ok(s.counters.avgFirstChoice === null, 'avgFirstChoice nulo depois de zerar');
  await call('POST', 'reset', { undo: true }, '2026-03-20');
  confere('desfazer o zeramento devolve o pref', (await stats()).counters, base);
}

let espFinal = esp1;
console.log('\n=== 6. descartar a previa editada: so conta o que foi publicado ===');
{
  await marcar(SEM3);
  const pv = (await previa(SEM3)).json;
  const slots = pv.assignments.map((a) => ({ day: a.day, personId: a.personId }));
  // Editar a partir da previa congela a semana e grava as decisoes dela.
  const ed = await call('POST', 'assignments', { monday: SEM3, slots });
  ok(ed.status === 200 && ed.json.preview === null, 'edicao a partir da previa congela a semana');
  const velho = esperado(ed.json);

  // Troca a resposta de quem estava na 1a opcao: ela vira ausente, e o que a
  // edicao gravou (uma escala na 1a opcao) deixa de descrever essa pessoa. Com
  // outra lista de dias a posicao poderia sair igual, e o teste nao enxergaria
  // linha velha nenhuma.
  const alvo = ed.json.assignments.find((a) => a.rank === 1 && a.via === 'preferencia');
  const salvou = await call('POST', 'preferences', { monday: SEM3, personId: alvo.personId, unavailable: true });
  ok(salvou.status === 200, `${nomeDe(alvo.personId)} passou a ausente (${salvou.json.error ?? ''})`);

  const d = await call('DELETE', `assignments?monday=${SEM3}`, undefined, SEM3);
  ok(d.status === 200 && d.json.preview != null, 'descartar devolve a previa');
  await call('POST', 'publish', { monday: SEM3, published: true });
  const pub3 = (await previa(SEM3)).json;
  ok(pub3.week.published === true, 'semana de 16/03 publicada');
  const novo = esperado(pub3);
  ok(forma(novo.get(alvo.personId) ?? ZERO) !== forma(velho.get(alvo.personId) ?? ZERO),
     `a troca de resposta de ${nomeDe(alvo.personId)} muda o que conta (${forma(velho.get(alvo.personId) ?? ZERO)} -> ${forma(novo.get(alvo.personId) ?? ZERO)})`);
  espFinal = somar(esp1, novo);
  confere('pref reflete so a escala publicada, sem a linha da edicao antiga',
    (await stats()).counters, espFinal);
}

console.log('\n=== 7. proporcao media na 1a opcao ===');
{
  const s = await stats();
  const esp = espFinal;
  const ativos = s.counters.perPerson.map((p) => p.personId);
  const m = media(esp, ativos);
  ok(m !== null && s.counters.avgFirstChoice === m,
     `avgFirstChoice e a media de c1/n entre quem tem n > 0 (${s.counters.avgFirstChoice} contra ${m})`);
  ok(Math.round(s.counters.avgFirstChoice * 100) / 100 === s.counters.avgFirstChoice,
     'arredondada em 2 casas');
  ok(s.counters.perPerson.every((p) => p.pref && Object.values(p.pref).every(Number.isInteger)),
     'n, c1, c2 e c3 sao inteiros');

  // Quem sai da lista de ativos sai da media.
  const fora = [...esp.keys()][0];
  await call('PATCH', 'people', { id: fora, active: false });
  const s2 = await stats();
  const m2 = media(esp, ativos.filter((id) => id !== fora));
  ok(s2.counters.avgFirstChoice === m2, `pessoa inativa sai da media (${s2.counters.avgFirstChoice} contra ${m2})`);
  ok(!s2.counters.perPerson.some((p) => p.personId === fora), 'e sai da lista do contador');
  await call('PATCH', 'people', { id: fora, active: true });
}

console.log('\n=== 8. publicar direto uma previa editada: conta o que o app decidiu ===');
{
  // A semana sai da previa com um ajuste a mao e e publicada como esta, sem
  // descartar nem regerar: as linhas de app_decisions so existem se a propria
  // edicao a partir da previa as gravou.
  const SEM4 = '2026-03-23';
  await marcar(SEM4);
  const pv = (await previa(SEM4)).json;
  const decidido = esperado(pv);
  const slots = pv.assignments.map((a) => ({ day: a.day, personId: a.personId }));
  const mover = pv.assignments.find((a) => a.rank === 1 && a.via === 'preferencia');
  const dia = [1, 2, 3, 4, 5].find((d) => !slots.some((x) => x.personId === mover.personId && x.day === d));
  const editados = slots.map((x) => (x.personId === mover.personId && x.day === mover.day ? { ...x, day: dia } : x));
  const ed = await call('POST', 'assignments', { monday: SEM4, slots: editados });
  if (ok(ed.status === 200 && ed.json.preview === null, `edicao a partir da previa congela a semana (${ed.json.error ?? ''})`)) {
    ok(ed.json.assignments.some((a) => a.personId === mover.personId && a.day === dia && a.via === 'manual'),
       `${nomeDe(mover.personId)} foi levado a mao para outro dia`);
    ok(forma(esperado(ed.json).get(mover.personId)) !== forma(decidido.get(mover.personId)),
       'a mao muda o que a escala diz, mas nao o que o app decidiu');
    const pb = await call('POST', 'publish', { monday: SEM4, published: true });
    ok(pb.status === 200 && pb.json.week.published === true, `publicada direto, sem regerar (${pb.json.error ?? ''})`);
    ok(pb.json.assignments.some((a) => a.personId === mover.personId && a.day === dia && a.via === 'manual'),
       'e a escala publicada e a editada');
    confere('pref soma o historico e o que o app decidiu (sem o ajuste a mao)',
      (await stats()).counters, somar(espFinal, decidido));
  }
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
