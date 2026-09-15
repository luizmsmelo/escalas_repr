// Testes do solver (duas fases) e da aritmetica de datas.
import { solveWeek, rankOf, FRIDAY } from '../netlify/functions/lib/solver.mjs';
import * as D from '../netlify/functions/lib/dates.mjs';
import { workingDaysInMonth, dayStatus } from '../netlify/functions/lib/holidays.mjs';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FALHA:', msg); } };

console.log('--- datas ---');
ok(D.mondayOf('2026-09-09') === '2026-09-07', 'mondayOf de uma quarta');
ok(D.mondayOf('2026-09-13') === '2026-09-07', 'mondayOf de um domingo');
ok(D.addDays('2026-12-31', 1) === '2027-01-01', 'virada de ano');
ok(D.addDays('2028-02-28', 1) === '2028-02-29', 'ano bissexto');
ok(D.isValidISO('2026-02-30') === false, 'rejeita 30 de fevereiro');
ok(D.isValidMonth('2026-13') === false, 'rejeita mes 13');

console.log('\n--- calendário oficial de 2026 ---');
const ago = workingDaysInMonth('2026-08');
ok(ago.monThu === 17 && ago.fridays === 4, `ago/2026 sem feriado: ${ago.monThu} seg-qui, ${ago.fridays} sextas`);

// Dezembro é o mês mais afetado: recesso de 21 a 31.
const dez = workingDaysInMonth('2026-12');
ok(dez.monThu === 11 && dez.fridays === 3, `dez/2026: ${dez.monThu} seg-qui, ${dez.fridays} sextas`);
// 21,22,23,24 (recesso) + 25 (Natal) + 28,29,30,31 (recesso) = 9 dias úteis
ok(dez.closed.length === 9, `dez/2026 tem 9 dias úteis fechados (${dez.closed.length})`);
ok(dez.closed.filter((d) => d.type === 'feriado').length === 1, 'sendo 1 feriado (Natal)');
ok(dez.closed.filter((d) => d.type === 'recesso').length === 8, 'e 8 de recesso');
console.log(`  dez/2026: ${dez.monThu} dias seg-qui + ${dez.fridays} sextas = ` +
            `${dez.monThu * 2 + dez.fridays} vagas (seriam 42 sem o recesso)`);

// Fevereiro perde o Carnaval.
const fev = workingDaysInMonth('2026-02');
ok(fev.monThu === 13 && fev.fridays === 4, `fev/2026: ${fev.monThu} seg-qui, ${fev.fridays} sextas`);

// Março não tem nada.
const mar = workingDaysInMonth('2026-03');
ok(mar.closed.length === 0, 'mar/2026 não tem dia fechado');

ok(dayStatus('2026-12-25').works === false, '25/12 é feriado');
ok(dayStatus('2026-02-16').works === false, '16/02 é Carnaval');
ok(dayStatus('2026-03-10').works === true, '10/03 é dia normal');
// `overrides` chega no formato que loadOverrides() monta: { works, note }.
ok(dayStatus('2026-02-16', { '2026-02-16': { works: true } }).works === true,
   'exceção manual devolve o expediente a um facultativo');
ok(dayStatus('2026-03-10', { '2026-03-10': { works: false, note: 'Recesso do órgão' } }).works === false,
   'exceção manual tira o expediente de um dia comum');

// Ano sem calendário carregado: assume expediente normal, mas sinaliza.
const sem = workingDaysInMonth('2030-03');
ok(sem.hasCalendar === false, '2030 não tem calendário carregado');
ok(sem.closed.length === 0, 'ano sem calendário não inventa feriado');

const CAP = { 1: 2, 2: 2, 3: 2, 4: 2, 5: 1 };
const NOMES = ['Luiz','Ana','Bruno','Carla','Diego','Elisa','Fabio','Gisele','Hugo'];
const mk = (i, extra = {}) => ({
  id: i + 1, name: NOMES[i], choices: [1, 2, 3],
  fridayCount: 0, totalCount: 0, noFriday: false, ...extra,
});
const sexta = (r) => r.assignments.find((a) => a.day === FRIDAY);

// 12 pessoas para as 9 vagas da semana: e o caso em que alguem fica de fora, e
// portanto o unico em que o contador consegue escolher quem entra.
const DOZE = [...NOMES, 'Ivo', 'Joana', 'Kaue'];
const DOZE_PESSOAS = (excecoes = {}, padrao = {}) => DOZE.map((name, i) => ({
  id: i + 1, name, choices: [1, 2, 3],
  fridayCount: 0, totalCount: 0, noFriday: false, ...padrao, ...(excecoes[i] ?? {}),
}));

console.log('\n--- fase 1: a fila da sexta ---');
{
  // Contadores diferentes, ninguem pede sexta: leva quem tem menos.
  const povo = NOMES.map((_, i) => mk(i, { fridayCount: 9 - i }));
  const r = solveWeek(povo, CAP);
  ok(sexta(r).name === 'Hugo', `menor contador leva a sexta (levou ${sexta(r).name})`);
  ok(sexta(r).via === 'fila', 'marcado como vindo da fila');
  ok(sexta(r).rank === 4, 'registrado como 4a opcao automatica');
}
{
  // Empatado nos dois contadores, o voluntario passa na frente: ele queria a
  // sexta, e quem estava na fila foi poupado.
  const povo = NOMES.map((_, i) =>
    i === 0 ? mk(i, { choices: [FRIDAY, 1, 2] }) : mk(i));
  const r = solveWeek(povo, CAP);
  ok(sexta(r).name === 'Luiz', `voluntario passa na frente (levou ${sexta(r).name})`);
  ok(sexta(r).via === 'voluntario', 'marcado como voluntario');
  ok(sexta(r).rank === 1, 'mantem a posicao que ele mesmo deu (1a opcao)');
}
{
  // ... mas voluntariar-se NAO fura a fila. Senao, colocar sexta no top 3 toda
  // semana seria o mesmo que ter sexta como dia fixo, sem passar pelo cadastro.
  const povo = NOMES.map((_, i) =>
    i === 0 ? mk(i, { choices: [FRIDAY, 1, 2], fridayCount: 50 }) : mk(i, { fridayCount: 0 }));
  const r = solveWeek(povo, CAP);
  ok(sexta(r).name !== 'Luiz',
     `quem ja tem 50 sextas nao leva mais uma so por pedir (levou ${sexta(r).name})`);
}
{
  // ... e nem entra na semana, se o contador GERAL dele estiver alto e houver
  // mais gente do que vagas: 5 escalas contra 3, e ninguem mais quer a sexta.
  const povo = DOZE_PESSOAS({ 0: { choices: [FRIDAY, 1, 2], totalCount: 5 } }, { totalCount: 3 });
  const r = solveWeek(povo, CAP);
  ok(sexta(r).name !== 'Luiz',
     `voluntario com o contador alto nao leva a sexta (levou ${sexta(r).name})`);
  ok(!r.assignments.some((a) => a.name === 'Luiz'),
     'e fica de fora da semana inteira, ate os contadores se equilibrarem');
}
{
  // Com tanta vaga quanto gente todo mundo trabalha, inclusive quem esta a
  // frente no contador: tirar essa pessoa exigiria dobrar outra, e ninguem faz
  // duas escalas na mesma semana. A defasagem fecha quando sobra gente.
  const povo = NOMES.map((_, i) =>
    i === 0 ? mk(i, { totalCount: 5 }) : mk(i, { totalCount: 3 }));
  const r = solveWeek(povo, CAP);
  ok(r.assignments.length === 9, `as 9 vagas continuam preenchidas (${r.assignments.length})`);
  ok(new Set(r.assignments.map((a) => a.personId)).size === 9,
     '9 pessoas distintas - ninguem duas vezes');
  ok(r.assignments.some((a) => a.name === 'Luiz'),
     'quem esta a frente entra, porque nao ha como tira-lo sem dobrar alguem');
}
{
  // O corte NAO vira uma ordenacao dentro da semana. Quem ficou uma escala
  // atras nao pode virar o primeiro da fila da sexta para sempre - foi o que
  // aconteceu quando o contador geral ordenava a fila: com 9 vagas para 9
  // pessoas a defasagem nunca fecha, e a pessoa levava todas as sextas.
  const total = new Map(NOMES.map((_, i) => [i + 1, i === 0 ? 2 : 3]));
  const sextas = new Map(NOMES.map((_, i) => [i + 1, 0]));
  const donos = [];

  for (let semana = 0; semana < 6; semana++) {
    const povo = NOMES.map((name, i) => ({
      id: i + 1, name, choices: [(i % 4) + 1, ((i + 1) % 4) + 1, ((i + 2) % 4) + 1],
      noFriday: false, totalCount: total.get(i + 1), fridayCount: sextas.get(i + 1),
    }));
    for (const a of solveWeek(povo, CAP).assignments) {
      total.set(a.personId, total.get(a.personId) + 1);
      if (a.day === FRIDAY) { sextas.set(a.personId, sextas.get(a.personId) + 1); donos.push(a.name); }
    }
  }

  ok(new Set(donos).size === 6, `6 semanas, 6 pessoas diferentes na sexta (${new Set(donos).size})`);
  ok(donos.filter((n) => n === 'Luiz').length <= 1,
     `quem estava uma escala atras nao levou todas as sextas (levou ${donos.filter((n) => n === 'Luiz').length})`);
}
{
  // Dois voluntarios: quem colocou sexta em posicao melhor leva.
  const povo = NOMES.map((_, i) =>
    i === 0 ? mk(i, { choices: [1, 2, FRIDAY] })
    : i === 1 ? mk(i, { choices: [FRIDAY, 1, 2] })
    : mk(i));
  const r = solveWeek(povo, CAP);
  ok(sexta(r).name === 'Ana', `1a opcao ganha de 3a opcao (levou ${sexta(r).name})`);
}
{
  // Veto tira da conta, mesmo sendo quem tem menos sextas.
  const povo = NOMES.map((_, i) => mk(i, { fridayCount: i === 0 ? 0 : 5, noFriday: i === 0 }));
  const r = solveWeek(povo, CAP);
  ok(sexta(r).name !== 'Luiz', 'quem vetou nao pega a sexta');
  ok(r.friday.vetoed.includes('Luiz'), 'veto registrado para a tela');
}
{
  // Todos vetam: a vaga fica vazia, o app nao forca ninguem.
  const povo = NOMES.map((_, i) => mk(i, { noFriday: true }));
  const r = solveWeek(povo, CAP);
  ok(sexta(r) === undefined, 'ninguem escalado na sexta');
  ok(r.unfilledSlots.includes(FRIDAY), 'sexta listada como vaga em aberto');
  ok(r.friday.allVetoed === true, 'sinalizado que todos recusaram');
  ok(r.assignments.length === 8, `as 8 vagas de seg-qui continuam preenchidas (${r.assignments.length})`);
}
{
  // Empate no contador: desempata por menos escalas, depois por id - estavel.
  const povo = NOMES.map((_, i) => mk(i, { fridayCount: 3, totalCount: i === 4 ? 0 : 10 }));
  const a = solveWeek(povo, CAP);
  const b = solveWeek([...povo].reverse(), CAP);
  ok(sexta(a).name === 'Diego', `empate vai para quem tem menos escalas (${sexta(a).name})`);
  ok(sexta(a).name === sexta(b).name, 'resultado nao depende da ordem de entrada');
}

console.log('\n--- fase 2: segunda a quinta ---');
{
  const povo = NOMES.map((_, i) => mk(i, { choices: [(i % 4) + 1, ((i + 1) % 4) + 1, ((i + 2) % 4) + 1] }));
  const r = solveWeek(povo, CAP);
  ok(r.assignments.length === 9, `9 vagas preenchidas (${r.assignments.length})`);
  ok(new Set(r.assignments.map((a) => a.personId)).size === 9, 'ninguem repetido');
  const porDia = {};
  r.assignments.forEach((a) => { porDia[a.day] = (porDia[a.day] || 0) + 1; });
  ok(JSON.stringify(porDia) === '{"1":2,"2":2,"3":2,"4":2,"5":1}', `capacidade: ${JSON.stringify(porDia)}`);
  console.log(`  ${r.summary.firstChoice} na 1a, ${r.summary.secondChoice} na 2a, ` +
              `${r.summary.thirdChoice} na 3a, ${r.summary.automaticFriday} na sexta automatica`);
}
{
  // Conflito maximo: todos querem os mesmos 3 dias.
  const r = solveWeek(NOMES.map((_, i) => mk(i)), CAP);
  ok(r.assignments.length === 9, 'preenche tudo mesmo com todos pedindo o mesmo');
  ok(r.unfilledSlots.length === 0, 'nenhuma vaga vazia');
  console.log(`  todos pedem [seg,ter,qua]: ${r.summary.firstChoice}x 1a, ` +
              `${r.summary.secondChoice}x 2a, ${r.summary.thirdChoice}x 3a, ` +
              `${r.summary.automaticFriday}x sexta, ${r.summary.outsidePreferences}x fora`);
}
{
  // Menos gente que vagas: toda vaga e preenchida, e para isso alguem dobra -
  // o MINIMO de gente possivel, e nunca quem ja esta na sexta enquanto houver
  // outra pessoa no mesmo pe do contador.
  const povo = NOMES.slice(0, 7).map((_, i) => mk(i));
  const r = solveWeek(povo, CAP);
  const cont = {};
  r.assignments.forEach((a) => { cont[a.name] = (cont[a.name] || 0) + 1; });
  ok(r.assignments.length === 9, `9 vagas preenchidas com 7 pessoas (${r.assignments.length})`);
  ok(r.unfilledSlots.length === 0, 'nenhuma vaga em aberto');
  ok(Object.values(cont).filter((n) => n === 2).length === 2, 'exatamente 2 pessoas dobram');
  ok(Math.max(...Object.values(cont)) === 2, 'ninguem faz tres');
  ok(cont[sexta(r).name] === 1, 'quem pegou a sexta e o ultimo a dobrar - aqui nao dobrou');
  console.log(`  dias por pessoa: ${JSON.stringify(cont)}`);
}
{
  // Antes de alguem dobrar, TODA pessoa disponivel ja esta na semana - inclusive
  // quem esta la na frente no contador e numa semana normal ficaria de fora.
  // A primeira escala de qualquer um custa menos do que a segunda de qualquer
  // outro; o corte so tira gente quando sobra gente.
  const povo = NOMES.slice(0, 8).map((_, i) => mk(i, { totalCount: i === 7 ? 20 : 0 }));
  const r = solveWeek(povo, CAP);
  const cont = {};
  r.assignments.forEach((a) => { cont[a.name] = (cont[a.name] || 0) + 1; });
  ok(r.assignments.length === 9, `9 vagas com 8 pessoas (${r.assignments.length})`);
  ok(cont.Gisele === 1, `quem tem 20 escalas contra 0 entra uma vez antes de alguem dobrar (${cont.Gisele ?? 0})`);
  ok(Object.values(cont).filter((n) => n === 2).length === 1, 'e so uma pessoa dobra');
  ok(Object.keys(cont).length === 8, 'as 8 pessoas disponiveis estao na semana');
}
{
  // Quem dobra e quem tem menos escalas - mesmo que seja quem pegou a sexta.
  // Poupar a sexta vale so entre empatados no contador; equilibrio vem antes.
  const povo = NOMES.slice(0, 7).map((_, i) => mk(i, { totalCount: i < 2 ? 0 : 5 }));
  const r = solveWeek(povo, CAP);
  const cont = {};
  r.assignments.forEach((a) => { cont[a.name] = (cont[a.name] || 0) + 1; });
  const dobraram = Object.entries(cont).filter(([, n]) => n === 2).map(([n]) => n).sort();
  ok(dobraram.join() === ['Ana', 'Luiz'].join(),
     `dobram os dois com 0 escalas contra 5 (dobraram ${dobraram})`);
  ok(sexta(r).name === 'Luiz' && cont.Luiz === 2,
     'inclusive quem esta na sexta, porque esta 5 escalas atras dos outros');
}
{
  // Mais gente que vagas: quem decide QUEM entra e o contador, nao a
  // preferencia. Uma vaga na segunda; Luiz pediu segunda em 1a opcao mas ja tem
  // 5 escalas, Ana nao pediu segunda e nao tem nenhuma. Entra Ana: preferencia
  // escolhe o dia de quem entra, nao quem fica de fora.
  const SO_SEGUNDA = { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 };
  const povo = [
    mk(0, { choices: [1, 2, 3], totalCount: 5 }),
    mk(1, { choices: [2, 3, 4], totalCount: 0 }),
  ];
  const r = solveWeek(povo, SO_SEGUNDA);
  ok(r.assignments.length === 1 && r.assignments[0].name === 'Ana',
     `entra quem tem menos escalas (entrou ${r.assignments[0]?.name})`);
}
{
  // Empatados no contador, decide a preferencia - o criterio de baixo escolhe
  // entre as escalas que o de cima empatou.
  const SO_SEGUNDA = { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 };
  const povo = [
    mk(0, { choices: [1, 2, 3], totalCount: 4 }),
    mk(1, { choices: [2, 3, 4], totalCount: 4 }),
  ];
  const r = solveWeek(povo, SO_SEGUNDA);
  ok(r.assignments[0]?.name === 'Luiz',
     `no empate leva quem pediu o dia (entrou ${r.assignments[0]?.name})`);
}
{
  // O rodizio fecha com mais gente que vagas: 12 pessoas para 9 vagas deixa 3
  // de fora por semana, e em 8 semanas a diferenca entre o maior e o menor
  // contador nao passa de 1. E o teste que o app nao passava: com o contador
  // valendo so como desempate, os mesmos 3 ficavam de fora toda semana.
  // Gosto ESTAVEL e desigual, como na vida real: oito preferem o comeco da
  // semana, quatro preferem a quinta. E a desigualdade que quebrava o rodizio -
  // os quatro da quinta nunca disputavam vaga com ninguem e entravam sempre.
  const gosto = (i) => (i < 8 ? [1, 2, 3] : [4, 3, 2]);
  const total = new Map(DOZE.map((_, i) => [i + 1, 0]));
  const sextas = new Map(DOZE.map((_, i) => [i + 1, 0]));

  for (let semana = 0; semana < 8; semana++) {
    const povo = DOZE.map((name, i) => ({
      id: i + 1, name, choices: gosto(i), noFriday: false,
      totalCount: total.get(i + 1), fridayCount: sextas.get(i + 1),
    }));
    for (const a of solveWeek(povo, CAP).assignments) {
      total.set(a.personId, total.get(a.personId) + 1);
      if (a.day === FRIDAY) sextas.set(a.personId, sextas.get(a.personId) + 1);
    }
  }

  const n = [...total.values()];
  const espalhamento = Math.max(...n) - Math.min(...n);
  ok(espalhamento <= 1,
     `8 semanas, 12 pessoas, 9 vagas: diferenca de ${espalhamento} escala(s) entre o maior e o menor`);
  console.log(`  12 pessoas em 8 semanas: de ${Math.min(...n)} a ${Math.max(...n)} escalas por pessoa`);
}

{
  // Quem larga o dia fixo volta a valer pelo contador. Como o dia fixo entra
  // toda semana, a tendencia e chegar a essa hora com o contador mais alto - e
  // entao a pessoa fica de fora ate o resto alcancar. E o caso que o usuario
  // descreveu: a excecao do dia fixo vale enquanto ele existe, nao depois.
  const EX_FIXO = 6, RESTO = 3;
  const total = new Map(DOZE.map((_, i) => [i + 1, i === 0 ? EX_FIXO : RESTO]));
  const sextas = new Map(DOZE.map((_, i) => [i + 1, 0]));
  const semanasDeFora = [];

  for (let semana = 0; semana < 6; semana++) {
    const povo = DOZE.map((name, i) => ({
      id: i + 1, name, choices: [1, 2, 3], noFriday: false,
      totalCount: total.get(i + 1), fridayCount: sextas.get(i + 1),
    }));
    const r = solveWeek(povo, CAP);
    if (!r.assignments.some((a) => a.name === 'Luiz')) semanasDeFora.push(semana + 1);
    for (const a of r.assignments) {
      total.set(a.personId, total.get(a.personId) + 1);
      if (a.day === FRIDAY) sextas.set(a.personId, sextas.get(a.personId) + 1);
    }
  }

  ok(semanasDeFora[0] === 1, `o ex-fixo fica de fora ja na 1a semana (ficou nas ${semanasDeFora})`);
  const n = [...total.values()];
  ok(Math.max(...n) - Math.min(...n) <= 1,
     `em 6 semanas os contadores emparelham (diferenca ${Math.max(...n) - Math.min(...n)})`);
  console.log(`  ex-fixo de ${EX_FIXO} contra ${RESTO}: fora nas semanas ${semanasDeFora}, ` +
              `e no fim todos entre ${Math.min(...n)} e ${Math.max(...n)}`);
}

{
  // Semana muito curta de gente: 3 pessoas para 9 vagas. Toda vaga sai
  // preenchida e a repeticao se espalha - tres escalas para cada uma, e nao
  // quatro para duas e uma para a terceira.
  const povo = NOMES.slice(0, 3).map((_, i) => mk(i));
  const r = solveWeek(povo, CAP);
  const porPessoa = new Map();
  for (const a of r.assignments) porPessoa.set(a.personId, (porPessoa.get(a.personId) ?? 0) + 1);
  ok(r.assignments.length === 9 && r.unfilledSlots.length === 0,
     `9 escalas, nenhuma em aberto (${r.assignments.length} e ${r.unfilledSlots.length})`);
  ok([...porPessoa.values()].every((n) => n === 3),
     `a repeticao se espalha: ${[...porPessoa.values()].join('/')} escalas`);
  const chaves = r.assignments.map((a) => `${a.personId}-${a.day}`);
  ok(new Set(chaves).size === chaves.length, 'ninguem duas vezes na mesma data');
}

console.log('\n--- fase 0: dia fixo ---');
{
  // Quem tem dia fixo cai nele, sem passar por preferencia nenhuma.
  const povo = NOMES.map((_, i) => mk(i, i === 0 ? { fixedDay: 3 } : {}));
  const r = solveWeek(povo, CAP);
  const dele = r.assignments.filter((a) => a.name === 'Luiz');
  ok(dele.length === 1 && dele[0].day === 3, `fixo na quarta (dias: ${dele.map((a) => a.day)})`);
  ok(dele[0].via === 'fixo', 'marcado como dia fixo');
  ok(r.summary.fixedDay === 1, `contabilizado a parte no resumo (${r.summary.fixedDay})`);
  ok(r.assignments.length === 9, `as 9 vagas continuam preenchidas (${r.assignments.length})`);
  const soma = r.summary.fixedDay + r.summary.firstChoice + r.summary.secondChoice
    + r.summary.thirdChoice + r.summary.automaticFriday + r.summary.outsidePreferences;
  ok(soma === r.summary.filled, `o resumo fecha com as vagas (${soma} de ${r.summary.filled})`);
}
{
  // Dia fixo que a pessoa nunca pediu no top 3 nao pode ser lido como "fora das
  // opcoes pedidas" - a tela acusaria um problema onde nao ha nenhum.
  const r = solveWeek([mk(0, { fixedDay: 1, choices: [2, 3, 4] })],
                      { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 });
  ok(r.summary.fixedDay === 1 && r.summary.outsidePreferences === 0,
     `fixo=${r.summary.fixedDay}, fora=${r.summary.outsidePreferences}`);
}
{
  // Dia fixo tira da fila da sexta - mesmo sendo quem tem menos sextas.
  const povo = NOMES.map((_, i) =>
    i === 0 ? mk(i, { fixedDay: 1, fridayCount: 0 }) : mk(i, { fridayCount: 10 }));
  const r = solveWeek(povo, CAP);
  ok(sexta(r).name !== 'Luiz', `quem tem dia fixo nao entra na fila (levou ${sexta(r).name})`);
  ok(!r.friday.queue.some((q) => q.name === 'Luiz'), 'e nem aparece nela');
}
{
  // Fixo na sexta: leva a sexta e ninguem mais disputa.
  const povo = NOMES.map((_, i) => mk(i, i === 0 ? { fixedDay: FRIDAY } : {}));
  const r = solveWeek(povo, CAP);
  ok(sexta(r).name === 'Luiz', `fixo na sexta leva a sexta (${sexta(r).name})`);
  ok(sexta(r).via === 'fixo', 'via fixo, nao pela fila');
  ok(r.friday.queue.every((q) => q.name !== 'Luiz'), 'fora da fila mesmo fixo na sexta');
}
{
  // Mais fixos que vagas: quem nao coube volta a disputar como todo mundo.
  const povo = NOMES.map((_, i) => mk(i, i < 3 ? { fixedDay: 1 } : {}));
  const r = solveWeek(povo, CAP);
  ok(r.fixed.placed.length === 2, `so 2 cabem na segunda (${r.fixed.placed.length})`);
  ok(r.fixed.spill.length === 1 && r.fixed.spill[0].name === 'Bruno',
     `o terceiro sobra (${r.fixed.spill.map((f) => f.name)})`);
  ok(r.fixed.spill[0].reason === 'sem-vaga', 'motivo: nao havia vaga livre');
  ok(r.assignments.some((a) => a.name === 'Bruno' && a.via !== 'fixo'),
     'e entra pela preferencia');
  ok(r.assignments.filter((a) => a.day === 1).length === 2, 'a segunda nao estoura a capacidade');
}
{
  // Dia fixo em feriado: a pessoa escolhe como todo mundo naquela semana.
  const SEM_QUARTA = { 1: 2, 2: 2, 3: 0, 4: 2, 5: 1 };
  const povo = NOMES.map((_, i) =>
    i === 0 ? mk(i, { fixedDay: 3, choices: [1, 2, 4], fridayCount: 0 })
            : mk(i, { fridayCount: 10 }));
  const r = solveWeek(povo, SEM_QUARTA);
  ok(r.fixed.placed.length === 0, 'ninguem fixado num dia sem expediente');
  ok(r.fixed.spill[0]?.reason === 'sem-expediente', `motivo: ${r.fixed.spill[0]?.reason}`);
  ok(!r.assignments.some((a) => a.day === 3), 'ninguem na quarta fechada');
  ok(sexta(r).name !== 'Luiz',
     `mesmo sem o dia fixo, ele segue fora da FILA da sexta (levou ${sexta(r).name})`);
}
{
  // ... mas pode se voluntariar para a sexta, como qualquer um.
  const SEM_QUARTA = { 1: 2, 2: 2, 3: 0, 4: 2, 5: 1 };
  const povo = NOMES.map((_, i) =>
    i === 0 ? mk(i, { fixedDay: 3, choices: [FRIDAY, 1, 2] }) : mk(i));
  const r = solveWeek(povo, SEM_QUARTA);
  ok(sexta(r).name === 'Luiz', `voluntario com dia fixo leva a sexta (${sexta(r).name})`);
  ok(sexta(r).via === 'voluntario', 'marcado como voluntario');
}
{
  // Menos gente que vagas: quem tem dia fixo pode dobrar como qualquer um, mas
  // nunca no MESMO dia - duas linhas na mesma data quebrariam a chave da tabela.
  const povo = NOMES.slice(0, 7).map((_, i) => mk(i, i === 0 ? { fixedDay: 1 } : {}));
  const r = solveWeek(povo, CAP);
  const chaves = r.assignments.map((a) => `${a.personId}-${a.day}`);
  ok(new Set(chaves).size === chaves.length, 'ninguem aparece duas vezes no mesmo dia');
  ok(r.assignments.length === 9, `9 vagas com 7 pessoas (${r.assignments.length})`);
  ok(r.assignments.some((a) => a.name === 'Luiz' && a.day === 1 && a.via === 'fixo'),
     'o fixo continua na segunda');
}
{
  // Determinismo: a ordem de entrada nao muda nada.
  const povo = NOMES.map((_, i) => mk(i, i < 3 ? { fixedDay: (i % 2) + 1 } : {}));
  const a = solveWeek(povo, CAP);
  const b = solveWeek([...povo].reverse(), CAP);
  ok(JSON.stringify(a.assignments) === JSON.stringify(b.assignments),
     'mesma entrada, mesma escala');
}

console.log('\n--- explicacao da escala ---');
{
  // A explicacao precisa bastar sozinha: e ela que a tela usa para dizer por
  // que cada pessoa esta onde esta, meses depois, sem refazer conta nenhuma.
  const povo = DOZE_PESSOAS(
    { 0: { fixedDay: 2 }, 1: { choices: [FRIDAY, 1, 2] }, 2: { noFriday: true, totalCount: 9 } },
    { totalCount: 4 },
  );
  const r = solveWeek(povo, CAP);
  const e = r.explain;
  const de = (nome) => e.people.find((p) => p.name === nome);

  ok(e.people.length === povo.length, `uma linha por participante (${e.people.length})`);
  ok(e.totalSlots === 9 && e.headcount === 12, `${e.totalSlots} vagas, ${e.headcount} pessoas`);

  // Os contadores sao os de ANTES da semana - e o que sustenta cada frase.
  ok(de('Luiz').totalBefore === 4 && de('Bruno').totalBefore === 9,
     'guarda o contador com que cada um chegou na semana');

  // O que a pessoa pediu fica registrado junto: a tela precisa poder dizer
  // "sua 1a opcao foi para fulano" sem ir buscar as preferencias de novo.
  ok(de('Ana').choices.join() === [FRIDAY, 1, 2].join(), 'guarda o top 3 pedido');

  // Cada linha da escala aparece na pessoa certa.
  for (const a of r.assignments) {
    const dele = de(a.name).days.find((d) => d.day === a.day);
    ok(dele && dele.via === a.via && dele.rank === a.rank,
       `${a.name} na ${a.day} bate com a escala (via ${dele?.via})`);
  }

  ok(de('Luiz').fixedDay === 2 && de('Luiz').days[0].via === 'fixo', 'dia fixo registrado');
  ok(de('Bruno').noFriday === true && de('Bruno').fridayPos === null,
     'quem vetou a sexta nao aparece na fila');
  ok(de('Bruno').aboveCut === true && de('Bruno').days.length === 0,
     `quem tem 9 escalas contra 4 fica fora e marcado (aboveCut=${de('Bruno').aboveCut})`);
  ok(e.cut === 4, `o corte vai junto, para a tela poder citar o numero (${e.cut})`);

  // A fila da sexta e uma ordem, nao um conjunto: as posicoes tem que ser 1..N.
  const posicoes = e.people.map((p) => p.fridayPos).filter((n) => n != null).sort((a, b) => a - b);
  ok(posicoes.join() === posicoes.map((_, i) => i + 1).join(),
     `posicoes da fila sao 1..${posicoes.length} sem buraco`);

  console.log(`  corte em ${e.cut} escalas; ${e.people.filter((p) => !p.days.length).length} fora da semana`);
}
{
  // Com vaga para todo mundo nao existe corte - a explicacao nao pode sugerir
  // que alguem foi barrado por contador.
  const r = solveWeek(NOMES.map((_, i) => mk(i)), CAP);
  ok(r.explain.people.every((p) => p.aboveCut === false),
     'com 9 vagas para 9 pessoas empatadas ninguem fica acima do corte');
  ok(r.explain.people.every((p) => p.days.length === 1), 'e todo mundo tem o seu dia');
}
{
  // Nem um contador muito a frente derruba a regra: com 9 vagas para 9 pessoas,
  // tirar quem tem 9 escalas obrigaria alguem a fazer duas. Entao ele entra, e
  // a explicacao registra que ninguem ficou de fora.
  const r = solveWeek(NOMES.map((_, i) => mk(i, { totalCount: i === 0 ? 9 : 0 })), CAP);
  const luiz = r.explain.people.find((p) => p.name === 'Luiz');
  ok(luiz.days.length === 1, `quem tem 9 escalas contra 0 ainda entra (${luiz.days.length})`);
  ok(r.explain.people.every((p) => p.days.length <= 1), 'e ninguem dobra');
  ok(r.explain.unfilled.length === 0, 'sem vaga em aberto: havia gente para todas');
}

console.log('\n--- prioridade: um dia so, ou nenhum ---');
{
  // Luiz tem prioridade e pede terca; o resto pede [1,2,3]. Ele fica na terca.
  const povo = NOMES.map((_, i) => mk(i, i === 0 ? { priority: true, choices: [2] } : {}));
  const r = solveWeek(povo, CAP);
  const luiz = r.assignments.filter((a) => a.name === 'Luiz');
  ok(luiz.length === 1 && luiz[0].day === 2, `Luiz ficou na terca (${JSON.stringify(luiz)})`);
  ok(luiz[0].via === 'prioridade', `marcado como prioridade (via=${luiz[0].via})`);
  ok(r.priorityUnplaced.length === 0, 'ninguem com prioridade ficou de fora');
  ok(sexta(r).name !== 'Luiz', 'prioridade nao cai na fila da sexta');
}
{
  // Tres com prioridade pedem terca, que tem 2 vagas. Quem decide e o contador
  // geral - o mesmo criterio que decide quem trabalha na semana.
  const povo = NOMES.map((_, i) => mk(i, i < 3
    ? { priority: true, choices: [2], totalCount: [5, 1, 3][i] }
    : { totalCount: 1 }));
  const r = solveWeek(povo, CAP);
  const naTerca = r.assignments.filter((a) => a.day === 2).map((a) => a.name).sort();
  ok(naTerca.join(',') === 'Ana,Bruno', `terca ficou com os dois de menos escalas (${naTerca})`);
  ok(!r.assignments.some((a) => a.name === 'Luiz'),
     'quem tinha 5 escalas nao entrou em nenhum outro dia');
  ok(r.priorityUnplaced.length === 1 && r.priorityUnplaced[0].name === 'Luiz',
     `e e reportado como fora da semana (${JSON.stringify(r.priorityUnplaced)})`);
  ok(r.priorityUnplaced[0].day === 2, 'com o dia que ele tinha pedido');
  console.log(`  terca: ${naTerca.join(', ')}; fora: ${r.priorityUnplaced.map((p) => p.name)}`);
}
{
  // Prioridade nao e excecao ao contador: com mais gente do que vagas, quem
  // esta a frente no historico fica de fora - tenha a flag ou nao.
  const MENOS = { 1: 2, 2: 2, 3: 1, 4: 1, 5: 1 };   // 7 vagas para 9 pessoas
  const povo = NOMES.map((_, i) =>
    mk(i, i === 0 ? { priority: true, choices: [2], totalCount: 9 } : { totalCount: 0 }));
  const r = solveWeek(povo, MENOS);
  const naTerca = r.assignments.filter((a) => a.day === 2).map((a) => a.name).sort();
  ok(!naTerca.includes('Luiz'), `prioridade com 9 escalas nao levou a terca (${naTerca})`);
  ok(r.priorityUnplaced.some((p) => p.name === 'Luiz'), 'ficou de fora da semana');
  console.log(`  com 7 vagas para 9: terca ficou com ${naTerca.join(', ')}; ` +
              'Luiz, com 9 escalas, ficou de fora');
}
{
  // Mas "toda vaga e preenchida" continua acima de tudo: com tanta gente
  // quanto vaga, todo mundo trabalha - inclusive quem tem prioridade e esta a
  // frente no contador. Quem tem tres opcoes e que se move.
  const povo = NOMES.map((_, i) => {
    if (i === 0) return mk(i, { priority: true, choices: [2], totalCount: 9 });
    if (i === 1) return mk(i, { choices: [2, 3, 4] });
    if (i === 2) return mk(i, { choices: [2, 4, 3] });
    return mk(i, { choices: [1, 3, 4] });
  });
  const r = solveWeek(povo, CAP);   // 9 vagas para 9 pessoas
  ok(r.assignments.filter((a) => a.name === 'Luiz').length === 1,
     'com vaga para todos, quem tem prioridade tambem trabalha');
  ok(r.assignments.some((a) => a.name === 'Luiz' && a.day === 2), 'e no dia que pediu');
  ok(r.unfilledSlots.length === 0, 'nenhuma vaga ficou vazia por causa disso');
}
{
  // Prioridade na sexta: e o dia dela, nao a 4a opcao automatica de ninguem.
  const povo = NOMES.map((_, i) => mk(i, i === 0 ? { priority: true, choices: [5] } : {}));
  const r = solveWeek(povo, CAP);
  ok(sexta(r).name === 'Luiz', `quem pediu a sexta com prioridade levou (${sexta(r).name})`);
  ok(sexta(r).via === 'prioridade', `via=${sexta(r).via}`);
  ok(!r.assignments.some((a) => a.name === 'Luiz' && a.day !== 5),
     'e nao ganhou um dia de seg-qui por cima');
}
{
  // Sem dia escolhido, quem tem prioridade nao entra - ao contrario de quem
  // nao tem, que o app encaixa em qualquer lugar.
  const povo = NOMES.map((_, i) => mk(i, i === 0 ? { priority: true, choices: [] } : {}));
  const r = solveWeek(povo, CAP);
  ok(!r.assignments.some((a) => a.name === 'Luiz'), 'quem nao escolheu dia fica de fora');
  ok(r.priorityUnplaced[0]?.day === null, 'reportado sem dia');
}
{
  // A flag ligada depois de a pessoa ja ter marcado 3 dias: vale o primeiro.
  const povo = NOMES.map((_, i) => mk(i, i === 0 ? { priority: true, choices: [4, 1, 2] } : {}));
  const r = solveWeek(povo, CAP);
  const luiz = r.assignments.filter((a) => a.name === 'Luiz');
  ok(luiz.length === 1 && luiz[0].day === 4, `vale so a 1a escolha (${JSON.stringify(luiz)})`);
}
{
  // Prioridade nunca dobra: mesmo faltando gente, ela tem um dia admissivel so.
  const povo = NOMES.slice(0, 5).map((_, i) =>
    mk(i, i === 0 ? { priority: true, choices: [2] } : {}));
  const r = solveWeek(povo, CAP);
  const luiz = r.assignments.filter((a) => a.name === 'Luiz');
  ok(luiz.length === 1, `com 5 pessoas para 9 vagas, Luiz segue com 1 dia (${luiz.length})`);
  ok(r.assignments.some((a) => a.name !== 'Luiz'
     && r.assignments.filter((x) => x.name === a.name).length > 1),
     'quem dobra e quem nao tem prioridade');
}
{
  // Prioridade e explicavel: a caixa "como foi gerada" precisa dos fatos.
  const povo = NOMES.map((_, i) => mk(i, i === 0 ? { priority: true, choices: [3] } : {}));
  const r = solveWeek(povo, CAP);
  const luiz = r.explain.people.find((p) => p.name === 'Luiz');
  ok(luiz.priority === true && luiz.priorityDay === 3,
     `explain carrega a flag e o dia (${JSON.stringify({ p: luiz.priority, d: luiz.priorityDay })})`);
}

{
  // Prioridade sem dia escolhido nao entra na conta do corte: ela nao pode
  // ocupar vaga nenhuma. Tres assim, com 1 escala a menos, nao podem baixar o
  // corte e marcar como "acima do corte" quem entra com 2.
  const gente = (id, extra) => ({ id, name: `P${id}`, choices: [1, 2, 3], totalCount: 0,
    fridayCount: 0, noFriday: false, fixedDay: null, priority: false, blockedDays: [], ...extra });
  const povo = [];
  for (let i = 1; i <= 3; i++) povo.push(gente(i, { priority: true, choices: [] }));
  for (let i = 4; i <= 9; i++) povo.push(gente(i, { totalCount: 1 }));
  for (let i = 10; i <= 15; i++) povo.push(gente(i, { totalCount: 2 }));
  const r = solveWeek(povo, CAP);   // 9 vagas
  ok(r.explain.cut === 2, `o corte ignora quem nao pode ser escalado (${r.explain.cut})`);
  ok(r.explain.people.filter((p) => p.days.length).every((p) => !p.aboveCut),
     'ninguem que entrou fica marcado acima do corte');
}

console.log('\n--- prioridade na sexta: antes da fila, se o contador poe na semana ---');
{
  // Semana normal, mais gente do que vagas. P1 tem prioridade na sexta, MENOS
  // escalas que todo mundo e MAIS sextas. O contador o poe na semana, e a sexta e
  // o unico dia dele: ele vem antes da fila. Antes da correcao, a fila dava a
  // sexta a quem podia ficar em outro dia, P1 ficava de fora e gente com mais
  // escalas trabalhava.
  const gente = (id, extra) => ({ id, name: `P${id}`, choices: [1, 2, 3], totalCount: 0,
    fridayCount: 0, noFriday: false, fixedDay: null, priority: false, blockedDays: [], ...extra });
  const povo = [gente(1, { priority: true, choices: [5], totalCount: 5, fridayCount: 3 })];
  for (let i = 2; i <= 9; i++) {
    povo.push(gente(i, { totalCount: 6, fridayCount: 1,
      choices: [1 + (i % 4), 1 + ((i + 1) % 4), 1 + ((i + 2) % 4)] }));
  }
  for (let i = 10; i <= 12; i++) povo.push(gente(i, { totalCount: 7 }));
  const r = solveWeek(povo, CAP);   // 9 vagas para 12 pessoas
  const naSexta = r.assignments.filter((a) => a.day === 5);
  ok(naSexta.length === 1 && naSexta[0].personId === 1 && naSexta[0].via === 'prioridade',
     `prioridade na sexta, com menos escalas, levou a sexta (${JSON.stringify(naSexta)})`);
  ok(r.priorityUnplaced.length === 0, 'ninguem com prioridade ficou de fora');
  ok(!r.assignments.some((a) => a.personId >= 10), 'ninguem com 7 escalas trabalhou');
  ok(r.explain.people.find((p) => p.personId === 1).fridayPos === 1,
     'e aparece em 1o na fila da sexta da explicacao');
}
{
  // Com tanta gente quanto vaga, a regra de ninguem dobrar enquanto houver
  // alguem disponivel: Luiz, com prioridade na sexta e mais sextas, fica com
  // ela, e ninguem precisa ficar em dois dias.
  const um = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 };
  const povo = NOMES.slice(0, 5).map((_, i) =>
    mk(i, i === 0 ? { priority: true, choices: [5], fridayCount: 5 } : {}));
  const r = solveWeek(povo, um);
  ok(r.assignments.some((a) => a.name === 'Luiz' && a.day === 5), 'Luiz ficou com a sexta');
  const dias = new Map();
  r.assignments.forEach((a) => dias.set(a.name, (dias.get(a.name) ?? 0) + 1));
  ok([...dias.values()].every((n) => n === 1), `ninguem dobrou (${JSON.stringify([...dias])})`);
  ok(r.unfilledSlots.length === 0, 'e nenhuma vaga ficou em aberto');
}
{
  // Acima do corte, prioridade na sexta nao passa na frente de ninguem.
  const MENOS = { 1: 2, 2: 2, 3: 1, 4: 1, 5: 1 };   // 7 vagas para 9 pessoas
  const povo = NOMES.map((_, i) =>
    mk(i, i === 0 ? { priority: true, choices: [5], totalCount: 9 } : { totalCount: 0 }));
  const r = solveWeek(povo, MENOS);
  ok(!r.assignments.some((a) => a.name === 'Luiz'), 'prioridade na sexta com 9 escalas ficou de fora');
  ok(r.assignments.some((a) => a.day === 5 && a.via === 'fila'), 'e a sexta foi pela fila');
}
{
  // Dois com prioridade pedem a sexta, que tem 1 vaga, e os dois trabalhariam:
  // entra quem tem menos escalas, mesmo tendo mais sextas.
  const povo = NOMES.map((_, i) => mk(i,
    i === 0 ? { priority: true, choices: [5], totalCount: 2, fridayCount: 0 }
      : i === 1 ? { priority: true, choices: [5], totalCount: 1, fridayCount: 4 }
        : { totalCount: 1 }));
  const r = solveWeek(povo, CAP);
  const naSexta = r.assignments.find((a) => a.day === 5);
  ok(naSexta?.name === 'Ana', `sexta ficou com quem tem menos escalas (${naSexta?.name})`);
  ok(r.priorityUnplaced.some((p) => p.name === 'Luiz'), 'e o outro ficou de fora da semana');
}

console.log('\n--- ferias ---');
{
  // Dia de ferias nunca recebe a pessoa: com 9 pessoas para 9 vagas todo mundo
  // trabalha, e Luiz so tem a quinta livre.
  const povo = NOMES.map((_, i) => mk(i, i === 0 ? { blockedDays: [1, 2, 3, 5] } : {}));
  const r = solveWeek(povo, CAP);
  const luiz = r.assignments.filter((a) => a.name === 'Luiz');
  ok(luiz.length === 1 && luiz[0].day === 4, `Luiz so cabe na quinta (${JSON.stringify(luiz)})`);
  ok(r.assignments.length === 9, `as 9 vagas saem mesmo assim (${r.assignments.length})`);
  const exp = r.explain.people.find((p) => p.name === 'Luiz');
  ok(JSON.stringify(exp.blockedDays) === '[1,2,3,5]', `explain guarda os dias de ferias (${exp.blockedDays})`);
}
{
  // Sexta de ferias: fora da fila, mesmo sendo o primeiro dela.
  const povo = NOMES.map((_, i) => mk(i, {
    fridayCount: i === 0 ? 0 : 3, blockedDays: i === 0 ? [5] : [],
  }));
  const r = solveWeek(povo, CAP);
  ok(sexta(r).name !== 'Luiz', `quem esta de ferias na sexta nao leva (levou ${sexta(r).name})`);
  ok(!r.friday.queue.some((q) => q.name === 'Luiz'), 'e nem aparece na fila');
}
{
  // Dia fixo que cai nas ferias: a vaga nao fica reservada, e a pessoa disputa
  // os outros dias.
  const povo = NOMES.map((_, i) => mk(i, i === 0 ? { fixedDay: 3, blockedDays: [3] } : {}));
  const r = solveWeek(povo, CAP);
  ok(r.fixed.spill.some((f) => f.name === 'Luiz' && f.reason === 'ferias'),
     `dia fixo de ferias vira spill com motivo ferias (${JSON.stringify(r.fixed.spill)})`);
  ok(!r.assignments.some((a) => a.name === 'Luiz' && a.day === 3), 'ninguem o poe na quarta');
  ok(r.assignments.some((a) => a.name === 'Luiz'), 'e ele entra em outro dia');
}
{
  // Um segundo fixo no mesmo dia herda a vaga de quem esta de ferias.
  const cap1 = { ...CAP, 3: 1 };
  const povo = NOMES.map((_, i) => mk(i,
    i === 0 ? { fixedDay: 3, blockedDays: [3] } : i === 1 ? { fixedDay: 3 } : {}));
  const r = solveWeek(povo, cap1);
  ok(r.fixed.placed.some((f) => f.name === 'Ana' && f.day === 3),
     `Ana fica com a quarta que Luiz liberou (${JSON.stringify(r.fixed.placed)})`);
}

console.log('\n--- casos limite ---');
ok(solveWeek([], CAP).unfilledSlots.length === 9, 'zero pessoas: 9 vagas em aberto');
ok(solveWeek(NOMES.map((_, i) => mk(i)), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }).assignments.length === 0, 'zero vagas');
{
  // Uma pessoa so: cobre os 5 dias distintos e nao mais - a mesma data nunca
  // recebe a mesma pessoa duas vezes, entao 4 vagas ficam em aberto.
  const r = solveWeek([mk(0)], CAP);
  ok(r.assignments.length === 5, `1 pessoa cobre no maximo 5 dias distintos (${r.assignments.length})`);
  ok(r.unfilledSlots.length === 4, `as 4 vagas restantes ficam em aberto (${r.unfilledSlots.length})`);
}
{
  // Sem preferencia registrada, a pessoa ainda entra na escala.
  const povo = NOMES.map((_, i) => mk(i, { choices: i < 3 ? [] : [1, 2, 3] }));
  const r = solveWeek(povo, CAP);
  ok(r.assignments.length === 9, 'quem nao respondeu ainda entra');
}
ok(rankOf({ choices: [3, 1, 5] }, 5) === 3, 'rankOf acha a posicao correta');
ok(rankOf({ choices: [3, 1, 5] }, 2) === null, 'rankOf devolve null para dia nao pedido');

console.log(`\n${fails === 0 ? 'TODOS OS TESTES PASSARAM' : fails + ' FALHA(S)'}`);
process.exit(fails ? 1 : 0);
