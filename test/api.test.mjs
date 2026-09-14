// Testes da API inteira contra um Postgres de verdade (PGlite, em WASM).
import { loadApi } from './load-api.mjs';

const handler = await loadApi();

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, true) : (fail++, console.log('  ✗ ' + msg), false);

// O app so gera e publica escala desta semana ou da proxima. Os testes mexem em
// semanas de varias epocas, entao cada chamada vive "no dia" da semana que ela
// mexe (ESCALAS_HOJE = body.monday); `hoje` escolhe outro dia.
const call = async (method, path, body, hoje = body?.monday) => {
  if (hoje) process.env.ESCALAS_HOJE = hoje;
  try {
    const res = await handler(new Request(`https://x.test/api/${path}`, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
    }));
    return { status: res.status, json: await res.json() };
  } finally {
    delete process.env.ESCALAS_HOJE;
  }
};

// So escala publicada conta nos contadores.
const gerarEPublicar = async (monday) => {
  const g = await call('POST', 'generate', { monday });
  await call('POST', 'publish', { monday, published: true });
  return g;
};

const WEEK = '2026-03-02';      // março/2026 não tem feriado nenhum
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
const SEM_VOL = '2026-03-09';
for (const [i, n] of NOMES.entries()) {
  await call('POST', 'preferences', { monday: SEM_VOL, personId: ids[n], choices: TOP3[i] });
}
// Hugo se voluntaria colocando sexta como 1a opcao.
await call('POST', 'preferences',
  { monday: SEM_VOL, personId: ids['Hugo Dias'], choices: [5,1,2] });
const gv = (await call('POST', 'generate', { monday: SEM_VOL })).json;
ok(sexta(gv).personId === ids['Hugo Dias'], `voluntario levou (${sexta(gv).name})`);
ok(sexta(gv).via === 'voluntario', 'marcado como voluntario');
ok(sexta(gv).rank === 1, 'mantem a 1a opcao que ele pediu');

console.log('\n=== todos vetam a sexta ===');
const SEM_VETO = '2026-03-16';
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
const inicio = '2026-06-08';   // 12 semanas seguidas sem feriado em sexta
const donos = [];
for (let w = 0; w < 12; w++) {
  const monday = new Date(Date.UTC(2026, 5, 8) + w * 7 * 86400000).toISOString().slice(0, 10);
  for (const [i, n] of NOMES.entries()) {
    await call('POST', 'preferences', { monday, personId: ids[n], choices: TOP3[i] });
  }
  const g = (await gerarEPublicar(monday)).json;
  donos.push(sexta(g).name.split(' ')[0]);
}
console.log(`  sextas de ${inicio} em diante: ${donos.join(', ')}`);

// A propriedade que interessa nao e "9 nomes distintos nesta janela" - alguem
// pode ter pego a sexta antes dela comecar. E que o rodizio FECHE: ninguem pega
// a segunda sexta antes de todo mundo ter pego a primeira. Isso equivale a
// diferenca entre o maior e o menor contador nunca passar de 1.
const filaFinal = (await call('GET', 'stats?month=2026-07')).json.stats.fridayQueue;
const menor = filaFinal[0].fridays;
const maior = filaFinal[filaFinal.length - 1].fridays;
console.log(`  contadores no fim: ${filaFinal.map((q) => q.fridays).join(', ')}`);
ok(maior - menor <= 1, `rodizio fechado: diferenca entre maior e menor e ${maior - menor}`);
ok(filaFinal.every((q) => q.fridays >= 1), 'todas as 9 pessoas ja pegaram ao menos uma sexta');
ok(menor >= 1, `ninguem ficou zerado (menor contador: ${menor})`);

console.log('\n=== contadores nunca zeram por mes ===');
const antesReset = (await call('GET', 'stats?month=2026-07')).json.stats.counters;
ok(antesReset.since === null, 'sem zeramento, conta desde o inicio');
ok(antesReset.grandTotal > 0, `${antesReset.grandTotal} escalas acumuladas`);
ok(antesReset.perPerson.every((p) => 'total' in p && 'fridays' in p),
   'cada pessoa tem escalas e sextas acumuladas');

// O mes consultado nao muda os contadores: eles sao acumulados, nao mensais.
const outroMes = (await call('GET', 'stats?month=2026-03')).json.stats.counters;
ok(outroMes.grandTotal === antesReset.grandTotal,
   'contadores nao mudam conforme o mes consultado');
ok(Math.abs(outroMes.avgTotal - antesReset.avgTotal) < 0.001, 'media tambem nao muda');
console.log(`  ${antesReset.grandTotal} escalas / ${antesReset.grandFridays} sextas, ` +
            `media ${antesReset.avgTotal} e ${antesReset.avgFridays} por pessoa`);

// Zeramento manual: novo ponto de partida, sem apagar historico.
ok((await call('POST', 'reset', {})).status === 200, 'zeramento aceito');
const depoisReset = (await call('GET', 'stats?month=2026-07')).json.stats.counters;
ok(depoisReset.since !== null, `passa a contar desde ${depoisReset.since}`);
ok(depoisReset.grandTotal === 0, `contadores zerados (${depoisReset.grandTotal})`);
ok(depoisReset.perPerson.every((p) => p.total === 0 && p.fridays === 0), 'todos em zero');
const filaZerada = (await call('GET', 'stats?month=2026-07')).json.stats.fridayQueue;
ok(filaZerada.every((q) => q.fridays === 0), 'fila da sexta recomeca do zero');

// O historico continua no banco: as escalas geradas seguem la.
const aindaTem = (await call('GET', 'state?week=2026-06-08')).json;
ok(aindaTem.assignments.length > 0, 'historico das escalas nao foi apagado');
console.log(`  apos zerar: ${depoisReset.grandTotal} contabilizadas, ` +
            `mas a semana de 08/06 ainda tem ${aindaTem.assignments.length} escalas`);

// Zerar e so um marco, entao da para desfazer.
ok((await call('POST', 'reset', { undo: true })).status === 200, 'desfazer aceito');
const desfeito = (await call('GET', 'stats?month=2026-07')).json.stats.counters;
ok(desfeito.since === null, 'volta a contar desde o inicio');
ok(desfeito.grandTotal === antesReset.grandTotal,
   `contadores restaurados por inteiro (${desfeito.grandTotal})`);
console.log(`  desfazer devolveu as ${desfeito.grandTotal} escalas`);
// zera de novo, para o resto do teste seguir do mesmo ponto
await call('POST', 'reset', {});

// A rota de edicao por pessoa deixou de existir.
ok((await call('POST', 'counter', { id: 1, fridayOffset: 5 })).status === 404,
   'edicao manual do contador por pessoa foi removida');

console.log('\n=== edicao manual da escala ===');
const stM = (await call('GET', `state?week=${WEEK}`)).json;
ok(stM.assignments.length > 0, 'semana de 02/03 tem escala gerada');

// Tira uma pessoa do dia dela e coloca na quarta, deixando o resto como esta.
const alvo = stM.assignments.find((a) => a.day !== 3);
const semAlvo = stM.assignments
  .filter((a) => a.personId !== alvo.personId)
  .map((a) => ({ day: a.day, personId: a.personId }));
const edicao = await call('POST', 'assignments',
  { monday: WEEK, slots: [...semAlvo, { day: 3, personId: alvo.personId }] });
ok(edicao.status === 200, `edicao aceita: ${JSON.stringify(edicao.json.error ?? '')}`);

const movido = edicao.json.assignments.find((a) => a.personId === alvo.personId);
ok(movido.day === 3, `${alvo.name} passou da ${alvo.day}a para a quarta`);
ok(movido.via === 'manual', `a linha movida vira manual (via=${movido.via})`);
ok(movido.date === '2026-03-04', `com a data da quarta (${movido.date})`);

const escolhasAlvo = edicao.json.preferences.find((p) => p.personId === alvo.personId).choices;
const posicao = escolhasAlvo.indexOf(3);
ok(movido.rank === (posicao === -1 ? null : posicao + 1),
   `rank herdado da lista da propria pessoa (rank=${movido.rank})`);

const intocado = edicao.json.assignments.find((a) => a.personId !== alvo.personId);
ok(intocado.via !== 'manual', `quem nao foi mexido mantem a origem (via=${intocado.via})`);
console.log(`  ${alvo.name} movido para a quarta; ${intocado.name} segue via ${intocado.via}`);

// Duas linhas iguais nao existem: a chave da tabela e (semana, pessoa, dia).
ok((await call('POST', 'assignments', { monday: WEEK, slots: [
  { day: 1, personId: ids['Ana Souza'] }, { day: 1, personId: ids['Ana Souza'] },
] })).status === 400, 'rejeita a mesma pessoa duas vezes no mesmo dia');

// Mas a mesma pessoa em dois dias diferentes e legitimo - alguem cobrindo o
// colega que faltou. O solver evita; a mao pode.
const atual = (await call('GET', `state?week=${WEEK}`)).json.assignments
  .map((a) => ({ day: a.day, personId: a.personId }));
const dobra = await call('POST', 'assignments',
  { monday: WEEK, slots: [...atual, { day: 2, personId: alvo.personId }] });
ok(dobra.status === 200, 'aceita a mesma pessoa em dois dias diferentes');
ok(dobra.json.assignments.filter((a) => a.personId === alvo.personId).length === 2,
   'as duas escalas da pessoa ficam registradas');

// Dia sem expediente nao tem vaga nem para a mao.
const noRecesso = await call('POST', 'assignments',
  { monday: '2026-12-21', slots: [{ day: 1, personId: ids['Ana Souza'] }] });
ok(noRecesso.status === 400, 'rejeita escalar em dia sem expediente');
console.log(`  ${noRecesso.json.error}`);

// Quem esta inativo saiu da escala.
await call('PATCH', 'people', { id: ids['Bruno Lima'], active: false });
ok((await call('POST', 'assignments',
   { monday: WEEK, slots: [{ day: 1, personId: ids['Bruno Lima'] }] })).status === 400,
   'rejeita escalar pessoa inativa');
await call('PATCH', 'people', { id: ids['Bruno Lima'], active: true });

// Lista vazia limpa a semana, e os totais do mes acompanham.
const marCheio = (await call('GET', 'stats?month=2026-03')).json.stats.totals.assigned;
const limpa = await call('POST', 'assignments', { monday: WEEK, slots: [] });
ok(limpa.status === 200 && limpa.json.assignments.length === 0, 'lista vazia limpa a semana');
const marLimpo = (await call('GET', 'stats?month=2026-03')).json.stats.totals.assigned;
ok(marLimpo < marCheio, `os totais do mes acompanham (${marCheio} -> ${marLimpo})`);
ok((await call('POST', 'publish', { monday: WEEK, published: true })).status === 400,
   'semana sem escala nao pode ser publicada');

// Gerar de novo remonta tudo pelas preferencias e descarta os ajustes.
const regerada = await call('POST', 'generate', { monday: WEEK });
ok(regerada.status === 200, 'gerar de novo remonta a semana');
ok(regerada.json.assignments.every((a) => a.via !== 'manual'),
   'gerar de novo descarta os ajustes manuais');

console.log('\n=== publicacao e cascata ===');

await call('POST', 'publish', { monday: WEEK, published: true });
ok((await call('POST', 'preferences',
   { monday: WEEK, personId: ids['Ana Souza'], choices: [5,4,3] })).status === 409,
   'semana publicada trava preferencias');
ok((await call('POST', 'generate', { monday: WEEK })).status === 409, 'e trava a geracao');
ok((await call('POST', 'assignments', { monday: WEEK, slots: [] })).status === 409,
   'e trava a edicao manual');
await call('POST', 'publish', { monday: WEEK, published: false });

const antes = (await call('GET', 'stats?month=2026-07')).json.stats.totals.assigned;
await call('DELETE', `people?id=${ids['Gisele Pinto']}`);
const depois = (await call('GET', 'stats?month=2026-07')).json.stats;
ok(depois.counters.perPerson.length === 8, '8 pessoas restantes');
ok(depois.totals.assigned < antes, `escalas apagadas em cascata (${antes} -> ${depois.totals.assigned})`);
ok(depois.fridayQueue.length === 8, 'fila encolhe junto');

console.log('\n=== calendário oficial ===');
// 03/04/2026 é Paixão de Cristo (sexta). A semana de 30/03 não deve ter sexta.
const PASCOA = '2026-03-30';
for (const [i, n] of NOMES.entries()) {
  if (!ids[n]) continue;
  await call('POST', 'preferences', { monday: PASCOA, personId: ids[n], choices: TOP3[i] });
}
let stP = (await call('GET', `state?week=${PASCOA}`)).json;
const sexP = stP.week.dates.find((d) => d.day === 5);
ok(sexP.works === false, 'sexta 03/04 marcada como sem expediente');
ok(sexP.holiday?.name === 'Paixão de Cristo', `feriado identificado: ${sexP.holiday?.name}`);
const quiP = stP.week.dates.find((d) => d.day === 4);
ok(quiP.works === false, 'quinta 02/04 é ponto facultativo (véspera)');

const gP = (await call('POST', 'generate', { monday: PASCOA })).json;
ok(!gP.assignments.some((a) => a.day === 5), 'ninguém escalado na sexta feriado');
ok(!gP.assignments.some((a) => a.day === 4), 'ninguém escalado na quinta facultativa');
ok(gP.assignments.length === 6, `só as 6 vagas de seg/ter/qua (${gP.assignments.length})`);
ok(gP.generation.closedDays.length === 2, 'os 2 dias fechados são reportados');
console.log(`  semana de 30/03: ${gP.assignments.length} vagas; fechados: ` +
            gP.generation.closedDays.map((d) => `${d.date} ${d.name}`).join(', '));

// A fila da sexta não anda numa semana sem sexta.
const filaAntes = JSON.stringify((await call('GET', 'stats?month=2026-03')).json.stats.fridayQueue);
await call('POST', 'generate', { monday: PASCOA });
const filaDepois = JSON.stringify((await call('GET', 'stats?month=2026-03')).json.stats.fridayQueue);
ok(filaAntes === filaDepois, 'fila da sexta não anda quando a sexta é feriado');

// Semana inteira sem expediente: recesso de 21 a 25 de dezembro.
const RECESSO = '2026-12-21';
const gR = await call('POST', 'generate', { monday: RECESSO });
ok(gR.status === 400, `semana toda fechada é recusada com aviso (status ${gR.status})`);
console.log(`  semana de 21/12: ${gR.json.error}`);

// Meta do mês já nasce descontando feriados.
const dez = (await call('GET', 'stats?month=2026-12')).json.stats;
ok(dez.premise.monThuDays === 11 && dez.premise.fridayDays === 3,
   `dez/2026 pré-preenchido: ${dez.premise.monThuDays} seg-qui e ${dez.premise.fridayDays} sextas`);
ok(dez.totals.slots === 25, `dez/2026: ${dez.totals.slots} vagas (42 sem o recesso)`);
ok(dez.closedDays.length === 9, `9 dias fechados listados (${dez.closedDays.length})`);
ok(dez.hasCalendar === true, 'calendário de 2026 disponível');
console.log(`  dez/2026: ${dez.totals.slots} vagas, meta ${dez.totals.targetPerPerson}/pessoa`);

// Exceção manual: o setor decide trabalhar num ponto facultativo.
const exc = await call('POST', 'day', { date: '2026-06-05', works: true });
ok(exc.status === 200, 'exceção aceita para ponto facultativo');
const jun = (await call('GET', 'stats?month=2026-06')).json.stats;
ok(jun.premise.fridayDays === 4, `sexta 05/06 devolvida à conta (${jun.premise.fridayDays} sextas)`);
ok(!jun.closedDays.some((d) => d.date === '2026-06-05'), '05/06 saiu da lista de fechados');
// Desfazendo, volta ao calendário oficial.
await call('POST', 'day', { date: '2026-06-05', works: false });
const jun2 = (await call('GET', 'stats?month=2026-06')).json.stats;
ok(jun2.premise.fridayDays === 3, 'desfazer devolve o calendário oficial');

ok((await call('POST', 'day', { date: '2026-06-06', works: false })).status === 400,
   'rejeita exceção em sábado');

console.log('\n=== calendário dia a dia ===');
const mar = (await call('GET', 'stats?month=2026-03')).json.stats;
ok(mar.days.length === 31, `março tem 31 dias no calendário (${mar.days.length})`);
ok(mar.days.filter((d) => d.weekend).length === 9, 'com 9 dias de fim de semana');
ok(mar.days.every((d) => d.weekend || d.works), 'março não tem nenhum dia fechado');
ok(mar.days[0].dow === 0, 'o dia 1 de março de 2026 é domingo');

const abr = (await call('GET', 'stats?month=2026-04')).json.stats;
const natal = (await call('GET', 'stats?month=2026-12')).json.stats;
const d25 = natal.days.find((d) => d.date === '2026-12-25');
ok(d25.locked === true, 'Natal vem travado');
ok(abr.days.find((d) => d.date === '2026-04-02').locked === false,
   'ponto facultativo não vem travado');
ok((await call('POST', 'day', { date: '2026-12-25', works: true })).status === 400,
   'API recusa abrir expediente em feriado');
console.log(`  ${(await call('POST', 'day', { date: '2026-12-25', works: true })).json.error}`);

// Cadastrar um dia sem expediente que não está no decreto.
const custom = await call('POST', 'day',
  { date: '2026-03-10', works: false, note: 'Recesso do órgão' });
ok(custom.status === 200, 'cadastra dia sem expediente fora do decreto');
const mar2 = (await call('GET', 'stats?month=2026-03')).json.stats;
const d10 = mar2.days.find((d) => d.date === '2026-03-10');
ok(d10.works === false, '10/03 passa a não ter expediente');
ok(d10.holiday.name === 'Recesso do órgão', `com o motivo cadastrado: ${d10.holiday.name}`);
ok(d10.holiday.type === 'excecao', 'marcado como exceção');
ok(mar2.premise.monThuDays === 17, `março cai para 17 dias seg-qui (${mar2.premise.monThuDays})`);
ok(mar2.totals.slots === 38, `e para 38 vagas (${mar2.totals.slots})`);
console.log(`  10/03 fechado: março vai de 40 para ${mar2.totals.slots} vagas`);

// Ninguém é escalado nesse dia.
for (const [i, n] of NOMES.entries()) {
  if (!ids[n]) continue;
  await call('POST', 'preferences', { monday: '2026-03-09', personId: ids[n], choices: TOP3[i] });
}
const gC = (await call('POST', 'generate', { monday: '2026-03-09' })).json;
ok(!gC.assignments.some((a) => a.day === 2), 'ninguém escalado na terça 10/03');
ok(gC.generation.closedDays.some((d) => d.date === '2026-03-10'), 'dia reportado como fechado');

// Desfazendo, o dia volta ao normal.
await call('POST', 'day', { date: '2026-03-10', works: true });
const mar3 = (await call('GET', 'stats?month=2026-03')).json.stats;
ok(mar3.premise.monThuDays === 18, 'desfazer devolve o dia');
ok(mar3.days.find((d) => d.date === '2026-03-10').works === true, '10/03 volta a ter expediente');

// Semana encurtada: 30/03 tem só seg, ter e qua. Exigir 3 dias ainda funciona,
// mas escolher um dia fechado não pode passar.
const fechado = await call('POST', 'preferences',
  { monday: PASCOA, personId: ids['Luiz Melo'], choices: [1, 2, 5] });
ok(fechado.status === 400, 'rejeita preferência num dia sem expediente');
console.log(`  ${fechado.json.error}`);

// Semana do recesso: 3 dias fechados de 28/12, sobra só... nada.
// Use 14/12, que tem seg-qui normais e sexta 18/12 normal.
const curta = '2026-12-14';
ok((await call('POST', 'preferences',
   { monday: curta, personId: ids['Luiz Melo'], choices: [1, 2, 3] })).status === 200,
   'semana de 14/12 é normal e aceita 3 dias');

console.log('\n=== dia fixo ===');
// Maio/2026 tem 04, 11 e 18 como segundas cheias - nenhum feriado no meio.
const FIXA = '2026-05-04';
const fx = await call('PATCH', 'people', { id: ids['Luiz Melo'], fixedDay: 3 });
ok(fx.status === 200 && fx.json.person.fixedDay === 3, `dia fixo gravado: ${JSON.stringify(fx.json)}`);

let stF = (await call('GET', `state?week=${FIXA}`)).json;
ok(stF.people.find((p) => p.id === ids['Luiz Melo']).fixedDay === 3, 'dia fixo volta no estado');
ok(!stF.stats.fridayQueue.some((q) => q.personId === ids['Luiz Melo']),
   'quem tem dia fixo sai da fila da sexta');
ok(stF.stats.fridayQueue.length === 7, `fila cai de 8 para 7 (${stF.stats.fridayQueue.length})`);

// A quarta tem 2 vagas: cabe mais um fixo, mas nao um terceiro.
ok((await call('PATCH', 'people', { id: ids['Ana Souza'], fixedDay: 3 })).status === 200,
   'segunda pessoa fixa na quarta cabe');
const terceiro = await call('PATCH', 'people', { id: ids['Bruno Lima'], fixedDay: 3 });
ok(terceiro.status === 400, 'terceira pessoa na quarta e recusada');
ok(/2 vagas e ja tem 2 pessoas fixas/.test(terceiro.json.error),
   `o aviso diz a conta, sem "(s)": ${terceiro.json.error}`);
console.log(`  ${terceiro.json.error}`);
ok((await call('PATCH', 'people', { id: ids['Bruno Lima'], fixedDay: 9 })).status === 400,
   'rejeita dia fora de segunda a sexta');

// Quem tem dia fixo salva sem escolher nada; o resto escolhe como sempre.
ok((await call('POST', 'preferences',
   { monday: FIXA, personId: ids['Luiz Melo'], choices: [] })).status === 200,
   'fixo salva preferencia vazia');
for (const [i, n] of NOMES.entries()) {
  if (!ids[n] || n === 'Luiz Melo' || n === 'Ana Souza') continue;
  await call('POST', 'preferences', { monday: FIXA, personId: ids[n], choices: TOP3[i] });
}

const gF = (await call('POST', 'generate', { monday: FIXA })).json;
const dele = gF.assignments.filter((a) => a.personId === ids['Luiz Melo']);
ok(dele.length === 1 && dele[0].day === 3, `Luiz so na quarta (dias: ${dele.map((a) => a.day)})`);
ok(dele[0].via === 'fixo', `marcado como dia fixo (via=${dele[0].via})`);
ok(gF.assignments.filter((a) => a.day === 3).length === 2, 'a quarta ficou com os dois fixos');
ok(![ids['Luiz Melo'], ids['Ana Souza']].includes(sexta(gF).personId),
   `nenhum fixo pegou a sexta (levou ${sexta(gF).name})`);
ok(!gF.generation.missingPreferences.includes('Ana Souza'),
   'fixo sem preferencia nao e cobrado por isso');
ok(gF.generation.fixed.placed.length === 2, 'os 2 fixos sao reportados');
console.log(`  quarta: ${gF.assignments.filter((a) => a.day === 3).map((a) => a.name).join(' e ')}`);

console.log('\n=== dia fixo em semana sem aquele dia ===');
const FECHADA = '2026-05-11';
await call('POST', 'day', { date: '2026-05-13', works: false, note: 'Recesso do órgão' });
// Vagas de sobra para as 8 pessoas, para o teste medir a regra e nao a lotacao.
await call('POST', 'capacity', { monday: FECHADA, capWeekday: 3, capFriday: 1 });

const semDia = await call('POST', 'preferences',
  { monday: FECHADA, personId: ids['Luiz Melo'], choices: [] });
ok(semDia.status === 400, 'sem o dia fixo, escolher volta a ser obrigatorio');
console.log(`  ${semDia.json.error}`);
for (const n of NOMES) {
  if (!ids[n]) continue;
  await call('POST', 'preferences', { monday: FECHADA, personId: ids[n], choices: [1, 2, 4] });
}

const gFe = (await call('POST', 'generate', { monday: FECHADA })).json;
ok(gFe.generation.fixed.placed.length === 0, 'ninguem fixado num dia sem expediente');
ok(gFe.generation.fixed.spill.some(
     (f) => f.personId === ids['Luiz Melo'] && f.reason === 'sem-expediente'),
   'o app avisa que o dia fixo nao existia nesta semana');
ok(!gFe.assignments.some((a) => a.day === 3), 'ninguem na quarta fechada');
ok(gFe.assignments.some((a) => a.personId === ids['Luiz Melo'] && a.via !== 'fixo'),
   'e o fixo entra pela preferencia, como todo mundo');
ok(![ids['Luiz Melo'], ids['Ana Souza']].includes(sexta(gFe).personId),
   `mas segue fora da FILA da sexta (levou ${sexta(gFe).name})`);

// Tirar o dia fixo devolve a pessoa a fila.
ok((await call('PATCH', 'people', { id: ids['Luiz Melo'], fixedDay: null })).status === 200,
   'dia fixo removido');
await call('PATCH', 'people', { id: ids['Ana Souza'], fixedDay: null });
await call('POST', 'day', { date: '2026-05-13', works: true });
const volta = (await call('GET', `state?week=${FIXA}`)).json;
ok(volta.people.find((p) => p.id === ids['Luiz Melo']).fixedDay === null, 'sem dia fixo de novo');
ok(volta.stats.fridayQueue.length === 8, `fila volta a ter 8 (${volta.stats.fridayQueue.length})`);

console.log('\n=== a explicacao da escala fica gravada ===');
{
  // A explicacao e o registro de UMA geracao, com os contadores como estavam na
  // hora. Se fosse recalculada na hora de exibir, mudaria sozinha assim que
  // qualquer outra semana fosse gerada - e a tela passaria a explicar a escala
  // de marco com os contadores de junho.
  const SEM = '2026-10-05';   // semana que nenhum outro teste gera
  const zerada = (await call('GET', `state?week=${SEM}`)).json;
  ok(zerada.week.explain == null,
     `semana ainda nao gerada nao tem explicacao (${JSON.stringify(zerada.week.explain)})`);

  // Quem esta ativo AGORA - o cadastro mudou ao longo do arquivo de testes.
  const ativos = zerada.people.filter((p) => p.active);
  for (const [i, p] of ativos.entries()) {
    await call('POST', 'preferences',
      { monday: SEM, personId: p.id, choices: TOP3[i % TOP3.length] });
  }
  const g = (await call('POST', 'generate', { monday: SEM })).json;
  ok(g.generation.explain?.people?.length === ativos.length,
     `a geracao devolve a explicacao na hora (${g.generation.explain?.people?.length})`);

  const lido = (await call('GET', `state?week=${SEM}`)).json;
  const e = lido.week.explain;
  ok(e?.people?.length === ativos.length,
     `e ela volta do banco depois (${e?.people?.length} de ${ativos.length} pessoas)`);
  ok(e.totalSlots === 9 && typeof e.generatedAt === 'string', 'com as vagas e a hora');

  // O que a tela promete: para cada linha da escala ha a pessoa, o dia e como
  // ela chegou ali.
  for (const a of lido.assignments) {
    const p = e.people.find((x) => x.personId === a.personId);
    ok(p && p.days.some((d) => d.day === a.day && d.via === a.via),
       `${a.name} na ${a.day}: a explicacao bate com a escala`);
  }

  // Gerar de novo reescreve a explicacao - nunca deixa a antiga para tras.
  const antes = e.generatedAt;
  await new Promise((r) => setTimeout(r, 15));
  await call('POST', 'generate', { monday: SEM });
  const depois = (await call('GET', `state?week=${SEM}`)).json.week.explain;
  ok(depois.generatedAt !== antes, 'gerar de novo reescreve a explicacao');

  console.log(`  explicacao de ${SEM}: corte em ${depois.cut}, ` +
              `${depois.people.filter((p) => !p.days.length).length} fora da semana`);
}

console.log('\n=== prioridade ===');
// Junho/2026: 08, 15 e 22 sao segundas cheias.
const PRIO = '2026-06-08';
// Publicada no teste do rodizio; reaberta, volta a aceitar preferencia e geracao.
await call('POST', 'publish', { monday: PRIO, published: false });
const COM_FLAG = ['Luiz Melo', 'Ana Souza', 'Bruno Lima'];

for (const n of COM_FLAG) {
  const r = await call('PATCH', 'people', { id: ids[n], priority: true });
  ok(r.status === 200 && r.json.person.priority === true, `${n} passa a ter prioridade`);
}
const stP0 = (await call('GET', `state?week=${PRIO}`)).json;
ok(stP0.people.filter((p) => p.priority).length === 3, 'a flag chega na tela');
ok(!stP0.stats.fridayQueue.some((q) => COM_FLAG.includes(q.name)),
   'quem tem prioridade sai da fila da sexta');

// Prioridade e dia fixo respondem a mesma pergunta: ligar um desliga o outro.
const trocaFixo = await call('PATCH', 'people', { id: ids['Luiz Melo'], fixedDay: 1 });
ok(trocaFixo.status === 200 && trocaFixo.json.person.priority === false,
   'cadastrar dia fixo desliga a prioridade');
const trocaPrio = await call('PATCH', 'people', { id: ids['Luiz Melo'], priority: true });
ok(trocaPrio.status === 200 && trocaPrio.json.person.fixedDay === null,
   'e voltar a prioridade tira o dia fixo');

// Com a flag, tres dias nao servem mais: e um dia, exatamente.
const tres = await call('POST', 'preferences',
  { monday: PRIO, personId: ids['Luiz Melo'], choices: [1, 2, 3] });
ok(tres.status === 400, 'recusa 3 dias de quem tem prioridade');
console.log(`  ${tres.json.error}`);
ok((await call('POST', 'preferences',
   { monday: PRIO, personId: ids['Luiz Melo'], choices: [] })).status === 400,
   'e recusa nenhum dia');

// Os tres pedem a mesma terca, que so tem 2 vagas.
for (const n of COM_FLAG) {
  const r = await call('POST', 'preferences',
    { monday: PRIO, personId: ids[n], choices: [2], noFriday: true });
  ok(r.status === 200, `${n} escolhe a terca: ${JSON.stringify(r.json.error ?? '')}`);
}
const prefPrio = (await call('GET', `state?week=${PRIO}`)).json.preferences
  .find((p) => p.personId === ids['Luiz Melo']);
ok(prefPrio.choices.length === 1 && prefPrio.choices[0] === 2, 'fica gravado um dia so');
ok(prefPrio.noFriday === false,
   'o veto da sexta e ignorado: quem tem prioridade nem entra na fila');

for (const [i, n] of NOMES.entries()) {
  if (COM_FLAG.includes(n) || !ids[n]) continue;
  await call('POST', 'preferences', { monday: PRIO, personId: ids[n], choices: TOP3[i] });
}
const gPrio = (await call('POST', 'generate', { monday: PRIO })).json;
const naTerca = gPrio.assignments.filter((a) => a.day === 2);
const deFlag = naTerca.filter((a) => COM_FLAG.includes(a.name));
ok(deFlag.length === 2, `a terca ficou com 2 dos 3 com prioridade (${deFlag.length})`);
ok(deFlag.every((a) => a.via === 'prioridade'), 'marcados como prioridade');

const fora = gPrio.generation.priorityUnplaced;
ok(fora.length === 1, `sobrou um de fora da semana (${JSON.stringify(fora)})`);
ok(fora[0].day === 2, 'com o dia que ele tinha pedido');
ok(!gPrio.assignments.some((a) => a.personId === fora[0].personId),
   'e ele nao foi remanejado para nenhum outro dia');
ok(!gPrio.assignments.some((a) => a.day === 5 && COM_FLAG.includes(a.name)),
   'ninguem com prioridade caiu na sexta sem ter pedido');
ok(!gPrio.generation.missingPreferences.includes(fora[0].name),
   'quem ficou de fora nao e cobrado por "sem preferencia"');
console.log(`  terca: ${naTerca.map((a) => a.name).join(', ')}; fora: ${fora[0].name}`);

// A explicacao da semana precisa saber contar essa historia.
const quemFicouFora = gPrio.generation.explain.people.find((p) => p.personId === fora[0].personId);
ok(quemFicouFora.priority === true && quemFicouFora.priorityDay === 2,
   'a explicacao guarda a flag e o dia pedido');
ok(quemFicouFora.days.length === 0, 'e registra que ele nao ficou em dia nenhum');

// A sexta escolhida por quem tem prioridade e o dia dela, nao a fila.
await call('POST', 'preferences', { monday: PRIO, personId: ids['Ana Souza'], choices: [5] });
const gSex = (await call('POST', 'generate', { monday: PRIO })).json;
const sexPrio = gSex.assignments.find((a) => a.day === 5);
ok(sexPrio?.name === 'Ana Souza', `quem pediu a sexta com prioridade levou (${sexPrio?.name})`);
ok(sexPrio?.via === 'prioridade', `via=${sexPrio?.via}`);
ok(gSex.assignments.filter((a) => a.name === 'Ana Souza').length === 1,
   'e ficou so com a sexta');

// Tirar a flag devolve a pessoa as regras gerais.
for (const n of COM_FLAG) await call('PATCH', 'people', { id: ids[n], priority: false });
const filaVolta = (await call('GET', `state?week=${PRIO}`)).json.stats.fridayQueue;
ok(filaVolta.length === 8, `fila da sexta volta a ter todo mundo (${filaVolta.length})`);
ok((await call('POST', 'preferences',
   { monday: PRIO, personId: ids['Luiz Melo'], choices: [1, 2, 3] })).status === 200,
   'e a pessoa volta a escolher 3 dias');

console.log('\n=== ferias ===');
{
  // Conta desde sempre: assim o credito nao depende do dia em que o teste roda.
  await call('POST', 'reset', { undo: true });
  const iris = (await call('POST', 'people', { name: 'Iris Rocha' })).json.person.id;
  const contador = async (id) => (await call('GET', 'stats?month=2026-11')).json.stats
    .counters.perPerson.find((p) => p.personId === id);

  // Validacao.
  ok((await call('POST', 'vacations',
     { personId: iris, start: '2026-11-20', end: '2026-11-10' })).status === 400,
     'rejeita ferias que terminam antes de comecar');
  ok((await call('POST', 'vacations',
     { personId: iris, start: '2026-11-02', end: '2027-06-30' })).status === 400,
     'rejeita periodo longo demais');
  ok((await call('POST', 'vacations',
     { personId: iris, start: '2026-11-31', end: '2026-12-02' })).status === 400,
     'rejeita data inexistente');
  ok((await call('POST', 'vacations',
     { personId: 99999, start: '2026-11-09', end: '2026-11-10' })).status === 404,
     'rejeita pessoa inexistente');

  // Tres semanas inteiras de ferias.
  const SEMANAS = ['2026-11-09', '2026-11-16', '2026-11-23'];
  const criada = await call('POST', 'vacations',
    { monday: SEMANAS[0], personId: iris, start: '2026-11-09', end: '2026-11-27' });
  ok(criada.status === 200, `ferias cadastradas: ${JSON.stringify(criada.json.error ?? '')}`);
  const ferias = criada.json.vacations?.find((v) => v.personId === iris);
  ok(ferias?.start === '2026-11-09' && ferias?.end === '2026-11-27', 'e voltam no estado');

  ok((await call('POST', 'vacations',
     { personId: iris, start: '2026-11-20', end: '2026-12-04' })).status === 400,
     'rejeita periodo sobreposto');
  const escolheu = await call('POST', 'preferences',
    { monday: SEMANAS[0], personId: iris, choices: [1, 2, 3] });
  ok(escolheu.status === 400, 'de ferias a semana inteira, nao ha dia para escolher');
  console.log(`  ${escolheu.json.error}`);

  const antes = await contador(iris);
  // Iris e cadastrada com historico no banco, entao comeca na media do grupo.
  const inicio = antes.startTotal;
  const inicioSex = antes.startFridays;
  ok(antes.vacationTotal === 0 && antes.total === inicio,
     `nenhum credito antes de gerar (comeca com ${inicio})`);

  const ativos = (await call('GET', `state?week=${SEMANAS[0]}`)).json.people
    .filter((p) => p.active && p.id !== iris);
  const geradas = [];
  for (const monday of SEMANAS) {
    for (const [i, p] of ativos.entries()) {
      await call('POST', 'preferences', { monday, personId: p.id, choices: TOP3[i % TOP3.length] });
    }
    const g = (await gerarEPublicar(monday)).json;
    ok(!g.assignments.some((a) => a.personId === iris), `${monday}: Iris fora da escala`);
    ok(g.generation.explain.vacation?.some((v) => v.personId === iris),
       `${monday}: explicacao lista Iris como de ferias`);
    ok(!g.generation.explain.people.some((p) => p.personId === iris),
       `${monday}: e ela nao entra na conta das pessoas disponiveis`);
    ok(g.generation.vacationCount === 1, `${monday}: vacationCount = 1`);
    geradas.push(g);
  }

  // Credito = soma, semana a semana, das escalas / quem estava disponivel.
  const credito = (gs, so = () => true) => Math.round(gs.reduce((s, g) =>
    s + g.assignments.filter(so).length / g.generation.explain.headcount, 0));
  const esperado = credito(geradas);
  const esperadoSex = credito(geradas, (a) => a.day === 5);
  const depois = await contador(iris);
  ok(esperado >= 2, `tres semanas de ferias valem ao menos 2 escalas (${esperado})`);
  ok(depois.vacationTotal === esperado, `credito de escalas = ${esperado} (${depois.vacationTotal})`);
  ok(depois.total === inicio + esperado, `e entra no contador (${depois.total})`);
  ok(depois.vacationFridays === esperadoSex && depois.fridays === inicioSex + esperadoSex,
     `credito de sextas = ${esperadoSex} (${depois.vacationFridays})`);
  console.log(`  3 semanas de ferias: ${depois.vacationTotal} escalas e ` +
              `${depois.vacationFridays} sextas de credito`);

  // Escala real e credito nunca somam na mesma semana.
  const [, meio] = SEMANAS;
  const slots = geradas[1].assignments.map((a) => ({ day: a.day, personId: a.personId }));
  await call('POST', 'publish', { monday: meio, published: false });
  await call('POST', 'assignments', { monday: meio, slots: [...slots, { day: 1, personId: iris }] });
  await call('POST', 'publish', { monday: meio, published: true });
  const comEscala = await contador(iris);
  const semMeio = credito([geradas[0], geradas[2]]);
  ok(comEscala.vacationTotal === semMeio && comEscala.total === inicio + semMeio + 1,
     `semana trabalhada sai do credito (${comEscala.vacationTotal} + 1 real = ${comEscala.total})`);
  await call('POST', 'publish', { monday: meio, published: false });
  geradas[1] = (await gerarEPublicar(meio)).json;
  ok((await contador(iris)).vacationTotal === credito(geradas), 'gerar de novo devolve o credito');

  // Rascunho nao da credito: reaberta, a semana sai da conta.
  await call('POST', 'publish', { monday: meio, published: false });
  ok((await contador(iris)).vacationTotal === credito([geradas[0], geradas[2]]),
     'semana reaberta (rascunho) nao da credito');
  await call('POST', 'publish', { monday: meio, published: true });

  // Semana publicada trava as ferias que caem nela.
  ok((await call('DELETE', `vacations?id=${ferias.id}`)).status === 409,
     'nao apaga ferias que caem numa semana publicada');
  ok((await call('POST', 'vacations',
     { personId: ids['Diego Alves'], start: '2026-11-10', end: '2026-11-11' })).status === 409,
     'nem cadastra');
  for (const monday of SEMANAS) await call('POST', 'publish', { monday, published: false });

  // Semana parcial: bloqueia os dias, sem credito.
  const PARCIAL = '2026-11-30';
  const diego = ids['Diego Alves'];
  ok((await call('POST', 'vacations',
     { personId: diego, start: '2026-12-02', end: '2026-12-04' })).status === 200,
     'ferias de quarta a sexta cadastradas');
  ok((await call('POST', 'preferences',
     { monday: PARCIAL, personId: diego, choices: [3, 1, 2] })).status === 400,
     'rejeita escolher dia de ferias');
  const doisDias = await call('POST', 'preferences',
    { monday: PARCIAL, personId: diego, choices: [1, 2] });
  ok(doisDias.status === 200, `fora das ferias, bastam os 2 dias livres: ${doisDias.json.error ?? ''}`);
  for (const [i, p] of ativos.entries()) {
    if (p.id === diego) continue;
    await call('POST', 'preferences',
      { monday: PARCIAL, personId: p.id, choices: TOP3[i % TOP3.length] });
  }
  const gParcial = (await gerarEPublicar(PARCIAL)).json;
  ok(!gParcial.assignments.some((a) => a.personId === diego && a.day >= 3),
     'Diego nao cai em dia de ferias');
  const diegoExp = gParcial.generation.explain.people.find((p) => p.personId === diego);
  ok(JSON.stringify(diegoExp?.blockedDays) === '[3,4,5]',
     `explicacao guarda os dias bloqueados (${diegoExp?.blockedDays})`);
  ok(!gParcial.generation.explain.vacation.some((v) => v.personId === diego),
     'semana parcial nao conta como semana de ferias');
  ok((await contador(diego)).vacationTotal === 0, 'e nao da credito');

  // Apagar as ferias leva o credito junto.
  const apagada = await call('DELETE', `vacations?id=${ferias.id}&week=${SEMANAS[0]}`);
  ok(apagada.status === 200 && !apagada.json.vacations.some((v) => v.id === ferias.id),
     'ferias apagadas');
  const semFerias = await contador(iris);
  // Na semana parcial de Diego, Iris ja nao estava de ferias e foi escalada: o
  // que sobra no contador dela e so escala real.
  const reais = gParcial.assignments.filter((a) => a.personId === iris).length;
  ok(semFerias.vacationTotal === 0 && semFerias.total === inicio + reais,
     `o credito some junto (sobram ${semFerias.total}: ${inicio} de partida + ${reais} reais)`);
  ok((await call('DELETE', `vacations?id=${ferias.id}`)).status === 404, '404 ao apagar de novo');
}

console.log('\n=== pessoa nova comeca na media ===');
{
  // A secao anterior desfez o zeramento: ha historico acumulado.
  const contadores = async () => (await call('GET', 'stats?month=2026-11')).json.stats;
  const daPessoa = async (id) => (await contadores()).counters.perPerson
    .find((p) => p.personId === id);
  const media = (perPerson, campo) =>
    perPerson.reduce((s, p) => s + p[campo], 0) / perPerson.length;

  const antes = (await contadores()).counters;
  const esperado = {
    total: Math.round(media(antes.perPerson, 'total')),
    fridays: Math.round(media(antes.perPerson, 'fridays')),
  };
  ok(esperado.total > 0, `a media nao e zero neste ponto do teste (${esperado.total})`);

  const nova = await call('POST', 'people', { name: 'Julia Prado' });
  ok(nova.status === 200, `cadastro aceito: ${JSON.stringify(nova.json.error ?? '')}`);
  const julia = nova.json.person.id;
  ok(nova.json.start?.total === esperado.total && nova.json.start?.fridays === esperado.fridays,
     `o cadastro devolve o ponto de partida (${JSON.stringify(nova.json.start)})`);

  const dela = await daPessoa(julia);
  ok(dela.startTotal === esperado.total && dela.total === esperado.total,
     `comeca com a media de escalas (${dela.total}, esperado ${esperado.total})`);
  ok(dela.startFridays === esperado.fridays && dela.fridays === esperado.fridays,
     `e com a media de sextas (${dela.fridays}, esperado ${esperado.fridays})`);
  console.log(`  Julia comeca com ${dela.total} escalas e ${dela.fridays} sextas`);

  // Com a media de sextas, ela nao fura a fila so por ser nova.
  const fila = (await contadores()).fridayQueue;
  ok(fila.some((q) => q.personId !== julia && q.fridays <= dela.fridays),
     'na fila da sexta ha gente com tantas ou menos sextas do que ela');

  // Reativar nao mexe no ponto de partida.
  await call('PATCH', 'people', { id: julia, active: false });
  await call('PATCH', 'people', { id: julia, active: true });
  ok((await daPessoa(julia)).startTotal === esperado.total, 'reativar mantem o ponto de partida');

  // Zerar recomeca todo mundo do zero - inclusive quem entrou antes do zeramento.
  await call('POST', 'reset', {});
  const zerada = await daPessoa(julia);
  ok(zerada.startTotal === 0 && zerada.startFridays === 0,
     `depois de zerar, o ponto de partida sai (${zerada.startTotal}, ${zerada.startFridays})`);

  // Quem entra depois do zeramento comeca na media de depois do zeramento.
  const posReset = (await contadores()).counters;
  const esperadoPos = Math.round(media(posReset.perPerson, 'total'));
  const kaio = (await call('POST', 'people', { name: 'Kaio Lemos' })).json;
  const dele = await daPessoa(kaio.person.id);
  ok(kaio.start.total === esperadoPos && dele.startTotal === esperadoPos,
     `quem entra depois do zeramento mantem o seu ponto (${dele.startTotal}, esperado ${esperadoPos})`);

  // Desfazer o zeramento devolve o ponto de partida de quem entrou antes.
  await call('POST', 'reset', { undo: true });
  ok((await daPessoa(julia)).startTotal === esperado.total,
     'desfazer o zeramento devolve o ponto de partida');
  ok((await daPessoa(kaio.person.id)).startTotal === esperadoPos,
     'e quem entrou depois do zeramento continua com o dele');
}

console.log('\n=== rascunho nao conta, janela e registro ===');
{
  const SEM = '2026-12-07';   // semana cheia que nenhum teste acima usa
  const ativos = (await call('GET', `state?week=${SEM}`)).json.people.filter((p) => p.active);
  const autor = ativos[0];
  const totalDoGrupo = async () =>
    (await call('GET', 'stats?month=2026-12')).json.stats.counters.grandTotal;

  // Janela: gerar, so esta semana ou a proxima.
  const cedo = await call('POST', 'generate', { monday: SEM }, '2026-11-23');
  ok(cedo.status === 400 && /liberada a partir de 30\/11/.test(cedo.json.error),
     `recusa gerar semana adiantada: ${cedo.json.error}`);
  console.log(`  ${cedo.json.error}`);
  ok((await call('POST', 'generate', { monday: SEM }, '2026-12-14')).status === 400,
     'recusa gerar de novo semana que ja passou');

  const antes = await totalDoGrupo();
  const gerada = await call('POST', 'generate', { monday: SEM, byPersonId: autor.id }, '2026-12-01');
  ok(gerada.status === 200, `gera a proxima semana: ${JSON.stringify(gerada.json.error ?? '')}`);
  ok(await totalDoGrupo() === antes, 'rascunho nao mexe em contador nenhum');

  // Publicar tambem tem janela, e e o que faz a escala contar.
  ok((await call('POST', 'publish', { monday: SEM, published: true }, '2026-11-23')).status === 400,
     'recusa publicar semana adiantada');
  const pub = await call('POST', 'publish', { monday: SEM, published: true, byPersonId: autor.id },
    '2026-12-01');
  ok(pub.status === 200, 'publica a proxima semana');
  ok(await totalDoGrupo() === antes + gerada.json.assignments.length,
     `publicada, a escala passa a contar (+${gerada.json.assignments.length})`);

  // Registro: quem gerou e quem publicou, do mais recente para o mais antigo.
  let log = pub.json.log;
  ok(log.length === 2 && log[0].action === 'publicar' && log[1].action === 'gerar',
     `registro com gerar e publicar (${log.map((l) => l.action)})`);
  ok(log.every((l) => l.personName === autor.name), `com o nome de quem fez (${autor.name})`);
  ok(log.every((l) => !Number.isNaN(Date.parse(l.at))), 'e a hora');

  // Sem nome escolhido, a acao passa e o registro fica sem nome.
  const reaberta = await call('POST', 'publish', { monday: SEM, published: false }, '2026-12-01');
  log = reaberta.json.log;
  ok(log[0].action === 'reabrir' && log[0].personName === null, 'reabrir sem nome fica registrado');

  const slots = reaberta.json.assignments.map((a) => ({ day: a.day, personId: a.personId }));
  const editada = await call('POST', 'assignments',
    { monday: SEM, slots: slots.slice(1), byPersonId: autor.id }, '2026-12-01');
  ok(editada.json.log[0].action === 'editar' && editada.json.log[0].personName === autor.name,
     'edicao a mao fica registrada');
  ok(await totalDoGrupo() === antes, 'reaberta, a semana sai da conta de novo');
}

console.log('\n=== rotas invalidas ===');
ok((await call('GET', 'inexistente')).status === 404, '404 em rota desconhecida');
ok((await call('GET', 'state?week=2026-02-30')).status === 400, 'rejeita data inexistente');
ok((await call('GET', 'state?week=2026-09-08')).status === 400, 'rejeita semana fora da segunda');
ok((await call('GET', 'stats?month=2026-13')).status === 400, 'rejeita mes 13');

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
