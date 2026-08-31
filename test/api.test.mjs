// Testes da API inteira contra um Postgres de verdade (PGlite, em WASM).
import { loadApi } from './load-api.mjs';

const handler = await loadApi();

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, true) : (fail++, console.log('  ✗ ' + msg), false);

const call = async (method, path, body) => {
  const res = await handler(new Request(`https://x.test/api/${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() };
};

const WEEK = '2026-09-07';
const NOMES = ['Luiz Melo','Ana Souza','Bruno Lima','Carla Reis','Diego Alves',
               'Elisa Nunes','Fabio Costa','Gisele Pinto','Hugo Dias'];
const TOP3 = [[1,4,3],[2,1,3],[3,2,4],[4,1,2],[1,2,3],[2,3,4],[3,4,1],[4,2,3],[1,3,4]];
const sexta = (st) => st.assignments.find((a) => a.day === 5);

console.log('=== cadastro ===');
const ids = {};
for (const n of NOMES) {
  const r = await call('POST', 'people', { name: n });
  ok(r.status === 200, `criar ${n}: ${JSON.stringify(r.json)}`);
  ids[n] = r.json.person?.id;
}
ok((await call('POST', 'people', { name: 'luiz melo' })).status === 400, 'rejeita duplicado');
ok((await call('POST', 'people', { name: 'X' })).status === 400, 'rejeita nome curto');

console.log('\n=== preferencias e veto da sexta ===');
for (const [i, n] of NOMES.entries()) {
  await call('POST', 'preferences', { monday: WEEK, personId: ids[n], choices: TOP3[i] });
}
let st = (await call('GET', `state?week=${WEEK}`)).json;
ok(st.preferences.length === 9, '9 preferencias gravadas');
ok(st.preferences.every((p) => p.noFriday === false), 'ninguem vetou ainda');

const veto = await call('POST', 'preferences',
  { monday: WEEK, personId: ids['Luiz Melo'], choices: [1,4,3], noFriday: true });
ok(veto.status === 200, 'veto aceito');
ok(veto.json.preferences.find((p) => p.personId === ids['Luiz Melo']).noFriday === true,
   'veto persistido');

const contradicao = await call('POST', 'preferences',
  { monday: WEEK, personId: ids['Ana Souza'], choices: [5,1,2], noFriday: true });
ok(contradicao.status === 400, 'rejeita pedir sexta e vetar sexta ao mesmo tempo');

console.log('\n=== fila da sexta ===');
st = (await call('GET', `state?week=${WEEK}`)).json;
ok(st.stats.fridayQueue.length === 9, 'fila com as 9 pessoas');
ok(st.stats.fridayQueue.every((q) => q.fridays === 0), 'todos comecam em 0');

let gen = (await call('POST', 'generate', { monday: WEEK })).json;
ok(gen.assignments.length === 9, `9 vagas (${gen.assignments.length})`);
ok(sexta(gen).personId !== ids['Luiz Melo'], 'quem vetou nao pegou a sexta');
ok(gen.generation.friday.vetoed.includes('Luiz Melo'), 'veto reportado');
ok(sexta(gen).via === 'fila', `sexta veio da fila (via=${sexta(gen).via})`);
console.log(`  sexta ficou com ${sexta(gen).name} (via ${sexta(gen).via})`);

console.log('\n=== voluntario fura a fila ===');
const SEM_VOL = '2026-09-14';
for (const [i, n] of NOMES.entries()) {
  await call('POST', 'preferences', { monday: SEM_VOL, personId: ids[n], choices: TOP3[i] });
}
// Hugo ja tem sextas, mas se voluntaria: deve levar mesmo assim.
await call('POST', 'counter', { id: ids['Hugo Dias'], fridayOffset: 20 });
await call('POST', 'preferences',
  { monday: SEM_VOL, personId: ids['Hugo Dias'], choices: [5,1,2] });
const gv = (await call('POST', 'generate', { monday: SEM_VOL })).json;
ok(sexta(gv).personId === ids['Hugo Dias'], `voluntario levou (${sexta(gv).name})`);
ok(sexta(gv).via === 'voluntario', 'marcado como voluntario');
ok(sexta(gv).rank === 1, 'mantem a 1a opcao que ele pediu');
await call('POST', 'counter', { id: ids['Hugo Dias'], fridayOffset: 0 });

console.log('\n=== todos vetam a sexta ===');
const SEM_VETO = '2026-09-21';
for (const [i, n] of NOMES.entries()) {
  await call('POST', 'preferences',
    { monday: SEM_VETO, personId: ids[n], choices: TOP3[i], noFriday: true });
}
const gvet = (await call('POST', 'generate', { monday: SEM_VETO })).json;
ok(sexta(gvet) === undefined, 'ninguem escalado na sexta');
ok(gvet.generation.friday.allVetoed === true, 'app sinaliza que todos recusaram');
ok(gvet.generation.unfilledSlots.includes(5), 'sexta listada como vaga aberta');
ok(gvet.assignments.length === 8, `as 8 vagas de seg-qui saem normalmente (${gvet.assignments.length})`);

console.log('\n=== contador GERAL faz o rodizio fechar ===');
// 12 semanas seguidas, atravessando 3 meses. Com contador mensal, so metade do
// grupo pegaria sexta; com contador geral, todos devem passar.
const inicio = '2026-10-05';
const donos = [];
for (let w = 0; w < 12; w++) {
  const monday = new Date(Date.UTC(2026, 9, 5) + w * 7 * 86400000).toISOString().slice(0, 10);
  for (const [i, n] of NOMES.entries()) {
    await call('POST', 'preferences', { monday, personId: ids[n], choices: TOP3[i] });
  }
  const g = (await call('POST', 'generate', { monday })).json;
  donos.push(sexta(g).name.split(' ')[0]);
}
console.log(`  sextas de ${inicio} em diante: ${donos.join(', ')}`);

// A propriedade que interessa nao e "9 nomes distintos nesta janela" - alguem
// pode ter pego a sexta antes dela comecar. E que o rodizio FECHE: ninguem pega
// a segunda sexta antes de todo mundo ter pego a primeira. Isso equivale a
// diferenca entre o maior e o menor contador nunca passar de 1.
const filaFinal = (await call('GET', 'stats?month=2026-10')).json.stats.fridayQueue;
const menor = filaFinal[0].fridays;
const maior = filaFinal[filaFinal.length - 1].fridays;
console.log(`  contadores no fim: ${filaFinal.map((q) => q.fridays).join(', ')}`);
ok(maior - menor <= 1, `rodizio fechado: diferenca entre maior e menor e ${maior - menor}`);
ok(filaFinal.every((q) => q.fridays >= 1), 'todas as 9 pessoas ja pegaram ao menos uma sexta');
ok(menor >= 1, `ninguem ficou zerado (menor contador: ${menor})`);

console.log('\n=== ajuste manual do contador ===');
await call('POST', 'counter', { id: ids['Carla Reis'], fridayOffset: 7 });
let fila = (await call('GET', 'stats?month=2026-10')).json.stats.fridayQueue;
ok(fila.find((q) => q.personId === ids['Carla Reis']).fridays === 7, 'contador ajustado para 7');
ok(fila[fila.length - 1].personId === ids['Carla Reis'], 'e ela foi para o fim da fila');
ok((await call('POST', 'counter', { id: ids['Carla Reis'], fridayOffset: -1 })).status === 400,
   'rejeita contador negativo');

console.log('\n=== contadores mensais continuam existindo ===');
const s10 = (await call('GET', 'stats?month=2026-10')).json.stats;
ok(s10.perPerson.every((p) => 'fridays' in p && 'allTimeFridays' in p),
   'contador do mes e contador geral convivem');
ok(s10.perPerson.some((p) => p.allTimeFridays >= p.fridays), 'geral nunca e menor que o do mes');
console.log(`  out/2026: ${s10.totals.assigned} escalas, meta ${s10.totals.targetPerPerson}/pessoa`);

console.log('\n=== premissa, publicacao e cascata ===');
let prem = (await call('POST', 'premise', { ym: '2026-09', monThuDays: 15, fridayDays: 3 })).json;
ok(prem.stats.totals.slots === 33, `premissa recalcula vagas (${prem.stats.totals.slots})`);
ok(prem.stats.premise.custom === true, 'marcada como ajustada');
const cal = prem.stats.calendar;
prem = (await call('POST', 'premise',
  { ym: '2026-09', monThuDays: cal.monThu, fridayDays: cal.fridays })).json;
ok(prem.stats.premise.custom === false, 'voltar ao calendario limpa a marca');

await call('POST', 'publish', { monday: WEEK, published: true });
ok((await call('POST', 'preferences',
   { monday: WEEK, personId: ids['Ana Souza'], choices: [5,4,3] })).status === 409,
   'semana publicada trava preferencias');
ok((await call('POST', 'generate', { monday: WEEK })).status === 409, 'e trava a geracao');
await call('POST', 'publish', { monday: WEEK, published: false });

const antes = (await call('GET', 'stats?month=2026-10')).json.stats.totals.assigned;
await call('DELETE', `people?id=${ids['Gisele Pinto']}`);
const depois = (await call('GET', 'stats?month=2026-10')).json.stats;
ok(depois.perPerson.length === 8, '8 pessoas restantes');
ok(depois.totals.assigned < antes, `escalas apagadas em cascata (${antes} -> ${depois.totals.assigned})`);
ok(depois.fridayQueue.length === 8, 'fila encolhe junto');

console.log('\n=== rotas invalidas ===');
ok((await call('GET', 'inexistente')).status === 404, '404 em rota desconhecida');
ok((await call('GET', 'state?week=2026-02-30')).status === 400, 'rejeita data inexistente');
ok((await call('GET', 'state?week=2026-09-08')).status === 400, 'rejeita semana fora da segunda');
ok((await call('GET', 'stats?month=2026-13')).status === 400, 'rejeita mes 13');

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
