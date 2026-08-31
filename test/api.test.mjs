// Testes da API inteira contra um Postgres de verdade (PGlite, em WASM).
import { loadApi } from './load-api.mjs';

const handler = await loadApi();

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, true)
  : (fail++, console.log('  ✗ ' + msg), false);

const call = async (method, path, body) => {
  const res = await handler(new Request(`https://x.test/api/${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() };
};

const WEEK = '2026-09-07'; // uma segunda-feira
const NOMES = ['Luiz Melo','Ana Souza','Bruno Lima','Carla Reis','Diego Alves',
               'Elisa Nunes','Fabio Costa','Gisele Pinto','Hugo Dias'];

console.log('=== cadastro de pessoas ===');
const ids = {};
for (const n of NOMES) {
  const r = await call('POST', 'people', { name: n });
  ok(r.status === 200, `criar ${n}: ${JSON.stringify(r.json)}`);
  ids[n] = r.json.person?.id;
}
ok(Object.keys(ids).length === 9, '9 pessoas cadastradas');

const dup = await call('POST', 'people', { name: 'luiz melo' });
ok(dup.status === 400, 'rejeita nome duplicado ignorando maiusculas');
const curto = await call('POST', 'people', { name: 'X' });
ok(curto.status === 400, 'rejeita nome de 1 caractere');

console.log('\n=== estado inicial ===');
let st = (await call('GET', `state?week=${WEEK}`)).json;
ok(st.week.monday === WEEK, 'semana correta');
ok(st.week.capWeekday === 2 && st.week.capFriday === 1, 'capacidade padrao 2/1');
ok(st.people.length === 9, '9 pessoas no estado');
ok(st.assignments.length === 0, 'sem escala ainda');
ok(st.settings.fridayFairness === false, 'rodizio desligado por padrao');
ok(st.stats.month === '2026-09', `mes das estatisticas: ${st.stats.month}`);
console.log(`  set/2026 no calendario: ${st.stats.calendar.monThu} dias seg-qui + ${st.stats.calendar.fridays} sextas`);
console.log(`  vagas no mes: ${st.stats.totals.slots}, meta por pessoa: ${st.stats.totals.targetPerPerson}`);
ok(st.stats.totals.slots === st.stats.calendar.monThu * 2 + st.stats.calendar.fridays, 'total de vagas confere');

console.log('\n=== preferencias ===');
const prefs = {
  'Luiz Melo': [1,4,3], 'Ana Souza': [2,1,3],   'Bruno Lima': [3,2,4],
  'Carla Reis': [4,5,1], 'Diego Alves': [1,2,5], 'Elisa Nunes': [5,3,2],
  'Fabio Costa': [2,3,1], 'Gisele Pinto': [3,4,5], 'Hugo Dias': [4,1,2],
};
for (const [n, choices] of Object.entries(prefs)) {
  const r = await call('POST', 'preferences', { monday: WEEK, personId: ids[n], choices });
  ok(r.status === 200, `preferencia de ${n}`);
}
const invalida = await call('POST', 'preferences', { monday: WEEK, personId: ids['Luiz Melo'], choices: [1,1,2] });
ok(invalida.status === 400, 'rejeita 3 dias com repeticao');
const doisDias = await call('POST', 'preferences', { monday: WEEK, personId: ids['Luiz Melo'], choices: [1,2] });
ok(doisDias.status === 400, 'rejeita menos de 3 dias');
const diaMau = await call('POST', 'preferences', { monday: WEEK, personId: ids['Luiz Melo'], choices: [1,2,6] });
ok(diaMau.status === 400, 'rejeita sabado');
const naoSegunda = await call('POST', 'preferences', { monday: '2026-09-08', personId: ids['Luiz Melo'], choices: [1,2,3] });
ok(naoSegunda.status === 400, 'rejeita semana que nao comeca na segunda');

st = (await call('GET', `state?week=${WEEK}`)).json;
ok(st.preferences.length === 9, 'todas as 9 preferencias gravadas');

console.log('\n=== gerar escala ===');
let gen = (await call('POST', 'generate', { monday: WEEK })).json;
ok(gen.assignments.length === 9, `9 vagas preenchidas (veio ${gen.assignments.length})`);
ok(new Set(gen.assignments.map(a=>a.personId)).size === 9, 'ninguem repetido');
const porDia = {};
gen.assignments.forEach(a => porDia[a.day] = (porDia[a.day]||0)+1);
ok(JSON.stringify(porDia) === '{"1":2,"2":2,"3":2,"4":2,"5":1}', `capacidade respeitada: ${JSON.stringify(porDia)}`);
console.log(`  ${gen.generation.firstChoice} na 1a opcao, ${gen.generation.secondChoice} na 2a, ${gen.generation.thirdChoice} na 3a`);
const nomesDia = {1:'SEG',2:'TER',3:'QUA',4:'QUI',5:'SEX'};
for (const d of [1,2,3,4,5]) {
  const quem = gen.assignments.filter(a=>a.day===d).map(a=>`${a.name.split(' ')[0]} (${a.rank}a)`);
  console.log(`  ${nomesDia[d]} ${gen.week.dates.find(x=>x.day===d).date}: ${quem.join(', ')}`);
}
ok(gen.assignments.every(a => a.date === gen.week.dates.find(d=>d.day===a.day).date), 'data de trabalho bate com o dia');

console.log('\n=== contadores ===');
ok(gen.stats.totals.assigned === 9, `9 escalas contabilizadas no mes (veio ${gen.stats.totals.assigned})`);
ok(gen.stats.perPerson.every(p => p.total === 1), 'cada pessoa com 1 escala');
ok(gen.stats.perPerson.filter(p => p.fridays === 1).length === 1, 'exatamente 1 pessoa com sexta');

console.log('\n=== premissa do mes ===');
let prem = (await call('POST', 'premise', { ym: '2026-09', monThuDays: 15, fridayDays: 3 })).json;
ok(prem.stats.premise.custom === true, 'premissa marcada como ajustada');
ok(prem.stats.totals.slots === 15*2 + 3, `vagas recalculadas: ${prem.stats.totals.slots}`);
console.log(`  15 x 2 + 3 x 1 = ${prem.stats.totals.slots} vagas, meta ${prem.stats.totals.targetPerPerson}/pessoa`);
const cal = prem.stats.calendar;
prem = (await call('POST', 'premise', { ym: '2026-09', monThuDays: cal.monThu, fridayDays: cal.fridays })).json;
ok(prem.stats.premise.custom === false, 'voltar ao calendario limpa a marca de ajuste');
const premMau = await call('POST', 'premise', { ym: '2026-09', monThuDays: -1, fridayDays: 3 });
ok(premMau.status === 400, 'rejeita dias uteis negativos');

console.log('\n=== publicar e travar ===');
let pub = (await call('POST', 'publish', { monday: WEEK, published: true })).json;
ok(pub.week.published === true, 'semana publicada');
const travada = await call('POST', 'preferences', { monday: WEEK, personId: ids['Ana Souza'], choices: [5,4,3] });
ok(travada.status === 409, `preferencia bloqueada apos publicar (status ${travada.status})`);
const genTravado = await call('POST', 'generate', { monday: WEEK });
ok(genTravado.status === 409, 'nao regera escala publicada');
pub = (await call('POST', 'publish', { monday: WEEK, published: false })).json;
ok(pub.week.published === false, 'semana reaberta');
const reaberta = await call('POST', 'preferences', { monday: WEEK, personId: ids['Ana Souza'], choices: [5,4,3] });
ok(reaberta.status === 200, 'preferencia aceita apos reabrir');

console.log('\n=== ausencias ===');
const SEM2 = '2026-09-14';
for (const [n, choices] of Object.entries(prefs)) {
  await call('POST', 'preferences', { monday: SEM2, personId: ids[n], choices });
}
await call('POST', 'preferences', { monday: SEM2, personId: ids['Luiz Melo'], unavailable: true });
await call('POST', 'preferences', { monday: SEM2, personId: ids['Ana Souza'], unavailable: true });
const g2 = (await call('POST', 'generate', { monday: SEM2 })).json;
ok(g2.assignments.length === 9, `9 vagas preenchidas com 7 pessoas (veio ${g2.assignments.length})`);
ok(!g2.assignments.some(a => a.personId === ids['Luiz Melo']), 'Luiz ausente nao foi escalado');
ok(!g2.assignments.some(a => a.personId === ids['Ana Souza']), 'Ana ausente nao foi escalada');
const c2 = {};
g2.assignments.forEach(a => c2[a.name] = (c2[a.name]||0)+1);
console.log(`  dias por pessoa: ${JSON.stringify(c2)}`);
ok(Math.max(...Object.values(c2)) === 2, 'no maximo 2 dias por pessoa');
ok(g2.generation.awayCount === 2, `2 ausentes detectados (veio ${g2.generation.awayCount})`);

console.log('\n=== capacidade da semana ===');
const cap = (await call('POST', 'capacity', { monday: '2026-09-21', capWeekday: 3, capFriday: 2 })).json;
ok(cap.week.capWeekday === 3 && cap.week.capFriday === 2, 'capacidade alterada');
const capMau = await call('POST', 'capacity', { monday: '2026-09-21', capWeekday: 99, capFriday: 1 });
ok(capMau.status === 400, 'rejeita capacidade fora do intervalo');

console.log('\n=== rodizio de sextas ===');
await call('POST', 'settings', { fridayFairness: true });
st = (await call('GET', `state?week=${WEEK}`)).json;
ok(st.settings.fridayFairness === true, 'configuracao persistida');
await call('POST', 'settings', { fridayFairness: false });

console.log('\n=== remocao em cascata ===');
const antes = (await call('GET', `stats?month=2026-09`)).json.stats.totals.assigned;
await call('DELETE', `people?id=${ids['Hugo Dias']}`);
const depois = (await call('GET', `stats?month=2026-09`)).json.stats;
ok(depois.perPerson.length === 8, '8 pessoas restantes');
ok(depois.totals.assigned < antes, `escalas do Hugo apagadas junto (${antes} -> ${depois.totals.assigned})`);

console.log('\n=== rotas invalidas ===');
ok((await call('GET', 'inexistente')).status === 404, '404 em rota desconhecida');
ok((await call('GET', 'state?week=2026-02-30')).status === 400, 'rejeita data inexistente');
ok((await call('GET', 'stats?month=2026-13')).status === 400, 'rejeita mes 13');

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
