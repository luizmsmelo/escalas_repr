# Escala 18h

Nove colegas escolhem, semana a semana, em que dia ficam até as 18h. Cada um
marca três dias em ordem de preferência; o app resolve os conflitos e mantém os
contadores.

**Vagas por semana:** 2 pessoas de segunda a quinta, 1 pessoa na sexta. São 9
vagas para 9 pessoas — cada um fica exatamente um dia por semana, e o que o app
decide é *qual* dia.

---

## Como a escala é montada

A semana é resolvida em duas fases, porque sexta e os outros dias são problemas
de natureza diferente.

### Fase 1 — a sexta

Ninguém escolhe sexta por gosto, então preferência não serve de critério. **Leva
quem tem menos sextas acumuladas.** É uma fila que qualquer pessoa confere de
cabeça. Duas exceções:

- **Voluntário passa na frente.** Quem coloca sexta no próprio top 3 leva, mesmo
  tendo mais sextas acumuladas. Ninguém sai perdendo: o voluntário queria a
  sexta, e quem estava na fila foi poupado.
- **"Não posso esta sexta" é veto, não preferência.** Quem aperta sai da conta
  daquela semana. Se todos apertarem, a vaga fica vazia — o app não escala
  alguém que disse que não podia.

Para quem não pediu nem vetou, sexta é a **4ª opção automática**.

Empates na fila são desfeitos por: menos sextas → menos escalas no total →
ordem de cadastro. O último critério garante que a mesma entrada sempre produza
a mesma escala.

### Fase 2 — de segunda a quinta

Com a sexta resolvida, sobra um problema puro de preferência. O app procura a
distribuição que **minimiza o custo total do grupo**, onde o custo de colocar
alguém num dia é a posição daquele dia na lista dessa pessoa:

| situação | custo |
| --- | --- |
| 1ª opção | 0 |
| 2ª opção | 1.000 |
| 3ª opção | 2.000 |
| dia de seg–qui que a pessoa não pediu | 8.000 |
| segundo dia na mesma semana | +50.000 |

Minimizar a soma é o mesmo que deixar **o grupo inteiro** o mais perto possível
das primeiras opções. Não é ordem de chegada, e não é "cada um por si": às vezes
alguém fica com a 2ª opção porque isso permite que dois outros fiquem com a 1ª,
e o total melhora.

O resultado é o ótimo global — nenhuma outra distribuição tem custo menor — e é
determinístico: a mesma entrada sempre produz a mesma escala.

Empates são desfeitos a favor de quem tem menos escalas acumuladas, por um termo
sempre menor que 1.000. Como um degrau de preferência custa 1.000, o desempate
**nunca** troca uma 1ª opção por uma 2ª: ele só escolhe entre distribuições que
já custam o mesmo.

---

## Os contadores

São dois, por pessoa: **escalas** e **sextas**. Ambos são acumulados e **nunca
zeram sozinhos** — nem por mês, nem por ano. Só zeram se alguém mandar zerar, na
aba Ajustes, e mesmo assim o histórico das escalas não é apagado: o app apenas
passa a contar a partir daquela data.

Isso é deliberado, por dois motivos.

**O rodízio da sexta não fecha dentro de um mês.** O mês tem 4 ou 5 sextas para
9 pessoas. Um contador que zera todo mês volta a empatar quem nunca pegou com
quem acabou de pegar, e o desempate cai na ordem de cadastro. Simulação de um
ano, uma sexta por semana:

| memória do contador | sextas por pessoa em 1 ano |
| --- | --- |
| mensal | `12, 12, 12, 12, 4, 0, 0, 0, 0` |
| acumulado | `6, 6, 6, 6, 6, 6, 6, 5, 5` |

Com contador acumulado, ninguém pega a segunda sexta antes de todos terem pego a
primeira — a diferença entre o maior e o menor nunca passa de 1.

**Os meses não são comparáveis entre si.** Feriado, ponto facultativo e recesso
fazem o número de vagas variar muito: em 2026 vai de 25 vagas em dezembro a 41
em julho. Comparar quantas escalas cada um fez "no mês" compara períodos de
tamanhos diferentes. No acumulado, todo mundo mediu o mesmo período.

A referência nos gráficos é a **média do grupo** — com contadores acumulados, é
onde todos deveriam estar.

---

## Dias sem expediente

Um dia sem expediente **não tem vaga**: ninguém é escalado, e a fila da sexta não
anda numa semana em que a sexta é feriado — senão alguém gastaria a vez sem ter
ficado até as 18h.

Numa semana encurtada por feriado, o app pede menos preferências: se sobraram só
3 dias com expediente, ele pede 3; se sobraram 2, pede 2. Semana inteira fechada
não gera escala.

Quais dias não têm expediente é o que o calendário da aba Ajustes mostra e
controla.

---

## Meta do mês

```
vagas do mês    = dias com expediente (seg–qui) × 2  +  sextas com expediente × 1
meta por pessoa = vagas do mês ÷ nº de pessoas ativas
```

Os dias com expediente não são um número digitado: saem do calendário da aba
Ajustes. Fechar ou abrir um dia lá recalcula a meta na hora, e a conta inteira
aparece embaixo do calendário — a mesma fonte alimenta os dois, então não existe
o estado inconsistente de a meta dizer 15 dias enquanto o calendário mostra 16.

Essa meta é um número de planejamento do mês. Quem mede se a divisão está justa
são os contadores acumulados, não ela.
