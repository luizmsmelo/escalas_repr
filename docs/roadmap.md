# Roadmap

Ideias e pontos em aberto do App de Escalas. Cada item tem um código **AE-NN**
(AE = App de Escalas), um status e o que faria o item voltar à mesa. Nada aqui
está prometido: é a lista do que vale reavaliar quando surgir a necessidade.

Status possíveis: **em observação** (funciona assim de propósito; reavaliar se
houver queixa), **planejado**, **em andamento**, **feito**.

---

## AE-01 — Empate misto: o histórico deveria decidir também?

**Status:** em observação

**Como funciona hoje.** Em um empate exato de preferência — trocar duas pessoas
de dia dá o mesmo resultado para o grupo —, o dia disputado vai para quem mais
vezes ficou abaixo daquela opção (ver "Desempate entre preferências iguais" no
README). Há um caso em que o histórico **não** entra: quando, para um dos dois, o
dia disputado é a **1ª opção** e, para o outro, só a **2ª**. Aí leva quem pediu
como 1ª opção, seja qual for o histórico.

Exemplo com as preferências da semana de 5 a 9 de outubro:

| | Joel (Qua > Ter > Qui) | Tostes (Qui > Qua > Ter) | Soma para o grupo |
|---|---|---|---|
| Joel na quarta, Tostes na terça | 1ª opção | 3ª opção | 2.000 |
| Tostes na quarta, Joel na terça | 2ª opção | 2ª opção | 2.000 |

As somas empatam, e a quarta fica com o Joel, porque só para ele ela era a 1ª
opção. A tela explica o caso com a frase "vale primeiro a melhor posição em jogo,
e a 1ª opção só estava em jogo para Joel".

**Por que ficou assim.** É consequência direta do cálculo do desempate aprovado
(a melhor posição em jogo decide primeiro) e é intuitivo: quem pediu o dia como
1ª opção leva. Nas simulações, esse caso decidiu de 23% a 31% dos empates; em
42% deles, quem perdeu tinha o histórico pior. As simulações usaram
preferências inventadas, então a frequência real é desconhecida.

**Quando reabrir.**
- Alguém reclamar de perder repetidamente esse tipo de empate.
- A frase "a 1ª opção só estava em jogo para…" aparecer com frequência em
  "Como essa escala foi montada?".

**Caminhos possíveis, se reabrir.**
- Deixar o histórico decidir também esse caso: quem mais vezes ficou abaixo da
  opção em disputa leva, mesmo que o dia seja só a 2ª opção dele.
- Usar o histórico só quando a diferença entre os dois for grande (um limite a
  definir).

Qualquer mudança aqui muda o cálculo do solver e o texto da tela; passa pelo
mesmo processo de desenho, especificação e testes do desempate original.

**Referências.** Especificação: `docs/superpowers/specs/2026-10-13-desempate-design.md`
(§3 e §7.1). Código: `tieBreakWeekdays` em `netlify/functions/lib/solver.mjs` e
`dueloEntre` em `public/app.js`. Teste que fixa o comportamento: "empate misto"
em `test/solver.test.mjs`.
