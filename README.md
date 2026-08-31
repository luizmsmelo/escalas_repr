# Escala 18h

App de celular para nove colegas escolherem, semana a semana, em que dia ficam
até as 18h. Cada um marca três dias em ordem de preferência, e a sexta é a 4ª
opção automática de todo mundo — quem leva é quem tem menos sextas no histórico.
O app resolve os conflitos sozinho e mantém os contadores.

Padrão de vagas: **2 pessoas de segunda a quinta, 1 pessoa na sexta** — 9 vagas
por semana para 9 pessoas, ou seja, cada um fica um dia por semana. Quem estiver
de férias marca "não participo" e o app redistribui as vagas entre os presentes.

## Como a escala é montada

O app resolve a semana em duas fases, porque sexta e os outros dias são problemas
diferentes.

### Fase 1 — a sexta

Ninguém escolhe sexta por gosto, então preferência não serve de critério. **Leva
quem tem menos sextas no histórico** — uma fila que qualquer pessoa confere de
cabeça na aba Contadores. Duas exceções:

- **Voluntário passa na frente.** Quem coloca sexta no próprio top 3 leva, mesmo
  tendo mais sextas acumuladas. Ninguém sai perdendo: o voluntário queria, e quem
  estava na fila foi poupado.
- **"Não posso esta sexta" é veto, não preferência.** Quem aperta sai da conta
  daquela semana. Se todos apertarem, a vaga fica vazia e a tela avisa — o app
  não escala alguém que disse que não podia.

Para todo mundo que não pediu nem vetou, sexta é a **4ª opção automática**: é o
que aparece na tela, e é como a alocação fica registrada.

### Fase 2 — de segunda a quinta

Com a sexta resolvida, sobra um problema puro de preferência. O app monta um
*fluxo de custo mínimo* (`netlify/functions/lib/solver.mjs`): cada vaga é uma
unidade de fluxo que passa por uma pessoa e um dia, e o custo da aresta é a
posição daquele dia na lista da pessoa.

| situação | custo |
| --- | --- |
| 1ª opção | 0 |
| 2ª opção | 1.000 |
| 3ª opção | 2.000 |
| dia de seg–qui que a pessoa não pediu | 8.000 |
| segundo dia na mesma semana | +50.000 |

Minimizar o custo total é o mesmo que deixar **o grupo inteiro** o mais perto
possível das primeiras opções — não é ordem de chegada. O resultado é o ótimo
global e é determinístico: a mesma entrada sempre produz a mesma escala. Empates
vão para quem tem menos escalas acumuladas, por um termo sempre menor que 1.000
— incapaz, portanto, de trocar uma 1ª opção por uma 2ª.

## Por que o contador de sextas é geral, e não mensal

O mês tem 4 ou 5 sextas para 9 pessoas. Um contador que zera todo mês **nunca
fecha o rodízio**: quando ele reseta, quem nunca pegou volta a empatar com quem
acabou de pegar, e o desempate cai na ordem de cadastro. Simulação de um ano:

| memória do contador | sextas por pessoa em 1 ano |
| --- | --- |
| mensal | `12, 12, 12, 12, 4, 0, 0, 0, 0` |
| geral | `6, 6, 6, 6, 6, 6, 6, 5, 5` |

Com contador geral, ninguém pega a segunda sexta antes de todos terem pego a
primeira — a diferença entre o maior e o menor contador nunca passa de 1. Há um
teste que verifica exatamente isso ao longo de 12 semanas.

Os gráficos mensais continuam existindo (é o recorte do mês corrente), mas quem
decide a fila é o contador geral.

### Quem entra na equipe depois

Começa em 0 e por isso pega várias sextas seguidas até emparelhar com o grupo.
Se não for o que vocês querem, o contador é editável na aba Ajustes.

## Calendário oficial

O app carrega os dias sem expediente do **Decreto nº 12.134 de 04/12/2025**
(Calendário 2026 do Poder Executivo do Paraná), em
`netlify/functions/lib/holidays.mjs`, nas três categorias do próprio decreto:

| categoria | 2026 | tratamento |
| --- | --- | --- |
| feriado | 10 datas | sem expediente, fixo |
| ponto facultativo | 8 datas | sem expediente por padrão, reversível em Ajustes |
| recesso | 21 a 31/12 | sem expediente, fixo |

Um dia sem expediente **não tem vaga**: ninguém é escalado, ele aparece marcado
no seletor e na escala, e a fila da sexta não anda numa semana em que a sexta é
feriado. Semana inteira fechada (21 a 25/12, por exemplo) é recusada com aviso.

### O calendário na aba Ajustes

A aba Ajustes traz o mês inteiro desenhado, com cada dia colorido por categoria.
Tocar num dia abre o editor:

- **dia com expediente** → dá para fechá-lo, informando o motivo (paralisação,
  manutenção, recesso do órgão). Vira uma exceção verde no calendário.
- **ponto facultativo ou exceção de vocês** → botão "Vai ter expediente neste
  dia", que devolve o dia à escala.
- **feriado ou recesso** → travado, com a explicação. Vem de lei e de decreto.

O decreto define ponto facultativo como "dia útil em que a administração *poderá*
dispensar total ou parcialmente o expediente" — não é garantido, e por isso ele é
o único do decreto que vocês podem reverter.

Impacto em 2026: **426 vagas no ano em vez de 470** — 44 a menos (9,4%).
Dezembro cai de 42 para 25.

Para um ano sem calendário carregado, o app assume que todo dia útil tem
expediente **e avisa na tela**, para ninguém confiar num calendário vazio.

## Meta do mês

```
vagas do mês   = dias úteis (seg–qui) × 2  +  sextas úteis × 1
meta por pessoa = vagas do mês ÷ nº de pessoas ativas
```

Os dias úteis **não são um número digitado**: saem do calendário da aba Ajustes.
Fechar ou abrir um dia lá recalcula a meta na hora, e a conta inteira aparece
embaixo do calendário. Assim não existe o estado inconsistente de a premissa
dizer 15 dias enquanto o calendário mostra 16 — é a mesma fonte para os dois.
