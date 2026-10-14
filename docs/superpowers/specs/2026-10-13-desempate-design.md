# Desempate justo entre preferências iguais — design

Data: 13/10/2026 · Status: aguardando revisão

## 1. Problema

De segunda a quinta, o solver escolhe a distribuição de dias com a **menor soma de
custos de preferência** (1ª opção = 0, 2ª = 1.000, 3ª = 2.000, dia não pedido =
8.000). Quando duas distribuições têm exatamente a mesma soma — por exemplo, Arthur
e Geovani com a mesma lista (Ter > Seg > Qua) e uma vaga na terça e outra na
segunda —, quem decide hoje é a ordem em que o algoritmo monta o grafo, que segue o
cadastro. Essa ordem é **sempre a mesma**: em simulação de 12 semanas, a mesma
pessoa levou a 1ª opção 12 vezes e a outra, 0. Nada corrige isso com o tempo,
porque o empate de "qual dia" não deixa rastro em contador nenhum.

## 2. Objetivo e critérios de sucesso

Reduzir o sentimento de injustiça de quem é sempre preterido em empates de
preferência — justiça no sentido de equidade.

1. Pessoas com as mesmas preferências terminam, ao longo do tempo, com a mesma
   proporção de 1ª, 2ª e 3ª opção.
2. Nenhum empate é decidido sistematicamente por característica fixa (cadastro,
   rapidez para marcar, frequência de resposta).
3. A regra não muda **quem entra** na semana, quantas escalas cada um faz, os dias
   preenchidos nem o total de preferência do grupo — só quem fica com qual dia
   quando trocar dá exatamente na mesma.
4. A regra não pode ser explorada (isca na 1ª opção, troca combinada, marcar cedo).
5. Cada pessoa vê na tela, com números, por que ganhou ou perdeu um empate — e
   também quando **não** houve empate.

## 3. A regra

Só vale quando trocar duas pessoas de dia dá **exatamente** a mesma soma de custos
para o grupo, e só depois de decidido quem entra. Na disputa por uma posição (1ª,
2ª ou 3ª opção) — a melhor posição em jogo —, ganha:

1. quem mais vezes ficou **abaixo** dessa posição (proporção);
2. empatando, quem tem a **pior posição média**;
3. empatando de novo, a ordem fixa de cadastro. Ela só decide empates perfeitos e
   se corrige sozinha: quem ganha um empate perfeito melhora as próprias proporções
   e perde o próximo.

Não há sorteio nem ordem de chegada.

## 4. Os contadores

### 4.1 Base

- Semanas **publicadas**, desde o último zeramento dos contadores (o mesmo marco do
  contador de escalas; zerar zera também estes, desfazer o zeramento devolve),
  sem a semana que está sendo montada.
- Conta **o que o app decidiu**, não o que aconteceu depois: troca combinada e
  ajuste manual não mexem nos contadores (decisão: opção 1 — as outras duas são
  exploráveis por troca combinada entre dois colegas).
- Conta só escala de quem **tinha marcado opções** naquela semana e que veio por
  `preferencia`, `voluntario` (sexta pedida) ou `fila` (sexta automática).
- Não conta: semana sem opções marcadas, dia fixo, prioridade, quem foi incluído à
  mão. Quem foi tirado à mão conta pelo que o app tinha decidido.
- Quem dobrou na semana conta as duas escalas.

### 4.2 Posição de cada escala

| Como a escala veio | Posição |
|---|---|
| dia que estava na lista, na posição 1, 2 ou 3 | 1, 2 ou 3 |
| sexta pela fila | 4 ("abaixo da 3ª") |
| dia fora das opções marcadas | 4 ("abaixo da 3ª") |

### 4.3 Números por pessoa

De `n` (escalas que contam) e `c1`, `c2`, `c3` (quantas na 1ª, 2ª, 3ª), com
`c4 = n − c1 − c2 − c3`:

- abaixo da 1ª = `1 − c1/n`
- abaixo da 2ª = `1 − (c1 + c2)/n`
- abaixo da 3ª = `1 − (c1 + c2 + c3)/n`
- posição média = `(c1 + 2·c2 + 3·c3 + 4·c4)/n`

Exemplo: 10 escalas, 5 na 1ª, 3 na 2ª, 1 na 3ª, 1 pela fila → 50%, 20%, 10%,
posição média 1,8.

Quem tem `n = 0` (pessoa nova, ou que nunca marcou) entra com a **média do grupo
da semana** em cada número.

O histórico já gravado conta desde o primeiro dia: as perdas passadas já pesam no
primeiro empate depois da mudança.

## 5. Solver

### 5.1 Duas etapas, em `solveWeekdays`

- **Etapa 1 — igual a hoje.** O fluxo atual decide quem entra, quantas escalas cada
  um faz (incluindo dobras), quais dias ficam cheios e a melhor soma de
  preferência. Sexta, dia fixo, prioridade e `priorityOnFriday` não mudam.
- **Etapa 2 — nova.** Um segundo fluxo com as **mesmas pessoas** (cada uma com o
  mesmo número de escalas da etapa 1), os **mesmos dias cheios** (capacidade de
  cada dia = o que a etapa 1 preencheu) e as mesmas restrições de aresta
  (`allowsDay`, dia fixo já reservado). O custo de cada aresta pessoa → dia é
  `custoDePreferência × ESCALA + desempate`, com `ESCALA` maior que qualquer soma
  possível de desempates — então a soma de preferência continua mínima e o
  desempate só escolhe entre distribuições com a mesma soma.

Fazer o desempate numa etapa separada é obrigatório: dentro do fluxo principal ele
também mexia em quem entra, e ao contrário — num empate de contador de escalas,
quem mais tinha perdido a 1ª opção ficava de fora da semana.

### 5.2 O custo de desempate

- Para cada nível `k ∈ {1, 2, 3}` (disputa pela 1ª, 2ª, 3ª opção), ordena as `P`
  pessoas da semana por: abaixo da `k`-ésima (maior primeiro) → posição média
  (maior primeiro) → id (menor primeiro). O peso da pessoa no nível é
  `P − índice` (1 a `P`).
- Cair da posição `r` para `r + 1` custa `peso_r(pessoa) × NÍVEL_r`, com
  `NÍVEL_1 = (P+1)²`, `NÍVEL_2 = P+1`, `NÍVEL_3 = 1`. O custo de ficar na posição
  `r` é a soma dos degraus de 1 até `r − 1` (dia não pedido = posição 4).
- Os níveis multiplicados garantem que a melhor posição em jogo decide a disputa.
  A versão sem esse peso por nível (somando os níveis) contrariou o texto da regra
  em 275 de 4.231 pares; a versão final (com o peso, sem "quem marcou primeiro"), em
  0 de 4.114.
- Usar a **ordem** das pessoas, não os percentuais, mantém os números pequenos e
  inteiros (sem arredondamento; bem abaixo de 2⁵³) e o resultado determinístico.

### 5.3 Entrada e saída

- Entrada nova por participante: `prefHistory: { n, c1, c2, c3 }` (ausente = `n` 0).
  O solver não lê o banco.
- O `explain` gravado ganha, por pessoa: `prefBefore: { n, c1, c2, c3 }`,
  `tieProfile: { below, avgPos, fromAverage }` (os números que o solver de fato
  usou — para quem tem `n = 0`, a média do grupo) e `tieOrder: { 1, 2, 3 }`
  (posição da pessoa em cada fila de prioridade, 1 = primeira), e na raiz
  `tieBreak: 1` (versão da regra). Semanas sem `tieBreak`
  foram montadas pela regra antiga.

## 6. Banco e API

### 6.1 Tabela nova `app_decisions`

```
monday     date not null
person_id  int  not null references people(id) on delete cascade
day        int  not null
work_date  date not null
position   int  not null check (position between 1 and 4)
primary key (monday, person_id, day)
```

- Só guarda as escalas que contam (4.1), com a posição de 4.2.
- **Espelha o `explain` da semana:** toda gravação de `explain` regrava as linhas
  da semana (`gravacaoDaSemana`, e `setAssignments` quando a edição parte da
  prévia); toda limpeza de `explain` (descartar prévia, migrações do schema) apaga
  as linhas. Ajuste manual em semana já gravada não toca nela.
- Semana reaberta continua com as linhas, mas sai da conta porque a soma só lê
  semanas publicadas — sem nada a sincronizar. O mesmo vale para zerar e desfazer.

### 6.2 Preenchimento das semanas antigas

Uma vez, marcada por uma chave em `settings` (para não rodar a cada instância):

- semanas com `explain`: a partir de `explain.people[].days` (o que o app decidiu)
  e `explain.people[].choices`;
- semanas sem `explain` (31/08 e 07/09): a partir de `assignments`, ignorando
  `via = 'manual'`, `'fixo'` e `'prioridade'`, só para quem tinha opções em
  `preferences` naquela semana. Linha com `via` nulo (anterior à coluna): conta se
  `rank` for 1, 2 ou 3, como preferência naquela posição; com `rank` nulo não conta,
  porque não dá para distinguir "fora das opções" de dia fixo;
- pessoas que não existem mais são ignoradas.

### 6.3 Conta

Uma função ao lado de `allTimeCounts` soma `app_decisions` no banco (group by
pessoa, só semanas publicadas, `work_date` desde o zeramento, sem a semana em
montagem) e devolve `{ n, c1, c2, c3 }` por pessoa. É a mesma forma de conta do
contador de escalas — em 5 anos, uns 2.300 números pequenos —, e roda a cada
montagem de prévia sem pesar.

Nada muda em `preferences`: o critério "quem marcou primeiro" foi descartado.

### 6.4 Aba Contadores

`/api/stats` passa a devolver, por pessoa, `{ n, c1, c2, c3 }` e a média do grupo
da proporção na 1ª opção.

### 6.5 Robustez

Registro incompleto de uma semana, ou de pessoa excluída, é ignorado na conta e não
trava a montagem. Semanas antigas sem os campos novos continuam abrindo.

## 7. Tela

### 7.1 Aba Escala — "Como essa escala foi montada?"

**Linha de cada pessoa (`whyOnePerson`).** Para quem ficou na 2ª ou 3ª opção, ou
ganhou um dia que outra pessoa também queria, a tela procura no `explain` cada
colega com quem a troca seria possível (os dois aceitam o dia do outro) e daria a
mesma soma de custos — isso é um empate — e escreve o duelo com os números
gravados. A posição em disputa ("a melhor posição em jogo") é a menor das
posições que os dois ocupam numa ou noutra distribuição — é o nível que o solver
usa para decidir (5.2). Textos (números ilustrativos):

- perdeu: *"ficou na **Segunda, a 2ª opção** — **empatou com Geovani pela
  terça**: trocar os dois dava exatamente o mesmo resultado para o grupo. Na
  disputa pela 1ª opção, leva quem mais vezes ficou sem ela: Geovani, **6 de 10**
  escalas (60%); Arthur, **4 de 10** (40%). Esta semana entra na conta de Arthur:
  agora são 5 de 11."*
- ganhou: *"ficou na **Terça, a 1ª opção** — empatou com Arthur e levou: tinha
  ficado sem a 1ª em 6 de 10 escalas (60%), contra 4 de 10 (40%) de Arthur."*
- decidiu a posição média: *"…as proporções empataram (50% cada); decidiu a
  posição média: 1,9 contra 1,6."*
- empate perfeito: *"…empataram em tudo; decidiu a ordem fixa de cadastro. Quem
  ganha um empate desses passa a ter proporção menor, e por isso a ordem fixa
  nunca favorece a mesma pessoa duas vezes seguidas."*
- não foi empate: *"…a terça ficou com Alan, que só pediu terça: trocar os dois
  deixaria o grupo pior, então **não foi empate**."* (com o motivo concreto quando
  o colega não tinha o dia na lista; senão, só "trocar deixaria o grupo pior").

Para isso a tela usa os mesmos custos do solver (0 / 1.000 / 2.000 / 8.000).
Rotações entre três ou mais pessoas são explicadas par a par.

**Regras (`whyRules` / `whyWeekdays`).** Um parágrafo na camada "em qual dia" com a
regra da seção 3 em linguagem simples.

**Semanas antigas** (sem `tieBreak`): o texto de hoje, sem alteração — era a regra
da época.

### 7.2 Aba Contadores

- Cartão pessoal: *"Na 1ª opção: 6 de 10 escalas (60%) · média do grupo 55%"*,
  com a nota *"Em empate, leva o dia quem vem ficando menos com a 1ª opção."*
  Sem escalas que contam: "—".
- Gráfico com todos, no mesmo formato dos de escalas e sextas: % de vezes na 1ª
  opção.

### 7.3 Aba Pedidos

Uma frase no quadro explicativo: *"Entre quem pede o mesmo dia na mesma opção,
leva quem vem ficando menos com a 1ª opção."* Sem bolinha nova.

### 7.4 Aviso de novidade

Cartão no topo da aba Escala, até a pessoa fechar (guardado no aparelho, com
`try/catch` como o resto do `localStorage` do app):
*"**Mudou a regra do empate.** Quando duas pessoas pedem o mesmo dia na mesma
opção, agora leva quem vem ficando menos com a 1ª opção, e não mais uma ordem
fixa. O porquê de cada caso está em “Como essa escala foi montada?”."*

### 7.5 README

A regra, os contadores e as decisões desta especificação, na seção do solver.

## 8. Testes

Escritos antes do código (falham primeiro, passam depois).

**Solver (`test/solver.test.mjs`):**
- Arthur × Geovani: leva a terça quem mais ficou sem a 1ª; invertendo os números,
  inverte.
- Sortudo (10× 1ª) × Meio (10× 2ª) × Azarado (10× 3ª), disputa pela 2ª: Azarado >
  Meio > Sortudo nos três duelos.
- 1ª contra 3ª: A (60% sem a 1ª, 0% abaixo da 2ª) × B (40%, 40%), sobrando a 1ª e
  a 3ª: leva A.
- Empate perfeito: decide o id; na semana seguinte, com os números atualizados,
  leva o outro.
- Não foi empate: Alan só pediu terça, Arthur Ter > Seg; com Arthur 100% sem a 1ª,
  Alan continua na terça.
- Pessoa com `n = 0` usa a média do grupo.
- Equilíbrio: 3 e 4 pessoas iguais, 24 semanas → distribuição idêntica.
- Garantias com semanas sorteadas (gerador com semente fixa): a etapa 2 nunca muda
  quem entra, quantas escalas, os dias cheios nem a soma de preferência; nenhum
  par contradiz o texto da regra.
- Todos os testes atuais continuam passando.

**API com Postgres em memória (`test/api.test.mjs`):**
- `app_decisions` gravada na montagem; inalterada por ajuste manual; apagada ao
  descartar a prévia; semana reaberta sai da conta; zerar e desfazer.
- Preenchimento das semanas antigas, com e sem `explain`.
- Conta do exemplo de 4.3 (50% / 20% / 10% / 1,8).
- `explain` com `prefBefore`, `tieOrder` e `tieBreak`.
- `/api/stats` com as proporções.

**Tela:** sem teste automático no projeto. Verificação no navegador com dados de
exemplo, com capturas enviadas para revisão: os cinco textos de 7.1, uma semana
antiga com o texto antigo, cartão e gráfico de 7.2, e o aviso de 7.4 sumindo depois
de fechado.

## 9. Fora do escopo

- **Compensar perdas que não são empate** (quando o melhor para o grupo exige que
  alguém fique com a 2ª opção). Exigiria decidir quanto o grupo pode piorar em
  troca de compensar alguém; fica para outra rodada, se houver queixas desse tipo.
- **Empates de quem entra na semana** e o último critério da fila da sexta
  continuam pela ordem de hoje: os dois se corrigem sozinhos pelos contadores de
  escalas e de sextas.
- Administrador movendo alguém de dia contra a vontade da pessoa não é compensado
  (consequência da opção 1).

## 10. Alternativas descartadas e por quê

| Alternativa | Por que não |
|---|---|
| Custo acumulado (pontos) como desempate | quem fica sempre com a 2ª opção nunca leva a 1ª: o custo dele é sempre a média |
| Contar perdas em número absoluto | favorece quem responde mais (correlação de 71% com a frequência de resposta) |
| Pontos como 2º critério | com proporções, não mudou nada mensurável |
| Proporção literal por posição ("menos 2ªs ganha a 2ª") | o mais sortudo empata com o mais azarado e pode levar |
| Somar os níveis (sem peso por nível) | contraria o texto da regra em 6,5% dos pares |
| Desempate dentro do fluxo principal | mexe em quem entra, contra quem mais perdeu |
| Quem marcou primeiro | incentiva marcar qualquer coisa cedo; é ordem de chegada; sem ganho medido |
| Reler todos os registros a cada acesso | a prévia é montada a cada abertura do app; pesaria com os anos |
| Guardar o total acumulado pronto | reabrir, zerar e desfazer exigiriam recalcular tudo |
| Proporções decidindo os dias fora do empate | piora o grupo e abre espaço para estratégia; fora do escopo |

## 11. Evidência (simulações descartáveis, fora do repositório)

Grupo de 22 pessoas com perfis repetidos, 156 semanas, 40 sementes. Diferença, em
pontos percentuais, entre a pessoa mais e a menos favorecida de um mesmo perfil:

| | % na 1ª opção | % na 3ª ou pior |
|---|---|---|
| Hoje — todos respondem 60% das semanas | 11,2 | 5,5 |
| Regra desta especificação — idem | 2,9 | 4,4 |
| Hoje — cada pessoa responde de 25% a 95% das semanas | 11,6 | 6,1 |
| Regra desta especificação — idem | 3,5 | 4,9 |

Laboratório: 3 e 4 pessoas iguais por 24 semanas, com a mesma pessoa sempre
primeira na ordem fixa → 8/8/8 e 6/6/6/6. Isca na 1ª opção: a pessoa caiu de 78%
para 37% das escalas no dia que queria de verdade. Invariantes (versão final): 3.122 semanas
sorteadas sem nenhuma mudança em quem entra, contagens, dias cheios ou soma de
preferência.
