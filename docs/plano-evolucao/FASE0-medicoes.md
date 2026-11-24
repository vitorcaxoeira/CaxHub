# Plano de Evolução Profissional e Eficiência — Fase 0: medições em dado real

Medido em **15/10/2026** no banco local (cópia dos dados do Senior sincronizados), só leitura. As consultas estão em
[`fase0-sql/`](fase0-sql/) e podem ser reexecutadas. Plano completo: [`PLANO.md`](PLANO.md).

A Fase 0 existe para decidir **quais indicadores automáticos dá para ativar no 1º ciclo** (01/01/2027) e quais ficam manuais.

## Resumo para decidir

| Indicador / base | Dá para automatizar hoje? | Por quê |
|---|---|---|
| **Eficiência Global** (Σ orçado ÷ Σ executado das tarefas encerradas) | **Sim, com cautela.** Base fina | 362 alocações encerradas, 21 consultores, desde 07/08/2026. Cobre só **11%** das horas executadas |
| **Produtividade** individual (mesma conta, por consultor) | **Sim, só com amostra mínima** | 13 consultores têm 10+ encerradas; 5 têm menos de 5. Abaixo do mínimo = "sem base" |
| **Apontamento online** | **Sim** | Há sinal confiável para separar online de retroativo (ver seção 3) e ele discrimina bem entre consultores |
| **Cumprimento de cronograma** | **Não** | `dataPrevistaFim` está preenchida em 8 de 5.147 alocações ativas (**0,2%**) |
| Retrabalho, qualidade técnica, aderência a processos | **Não** (manual) | Não há dado no sistema; o gestor lança |

## 1. Encerramento da tarefa pela coluna final do quadro

A única data de encerramento confiável é a **1ª entrada numa coluna com `ehFinal`** (hoje só "Concluído") no histórico de movimentação.

- O quadro só começou a ser usado em **07/08/2026** (primeira movimentação). Não existe histórico de encerramento antes disso:
  o "ensaio" do 2º semestre de 2026 cobre **agosto a dezembro**, não o semestre inteiro.
- 5.147 alocações ativas: **837 têm coluna** (16%), 4.310 nunca foram movidas.
- Encerradas (1ª entrada em coluna final): **131 em agosto, 121 em setembro, 110 em outubro (até o dia 13)** = 362 alocações.
- Coerência: das 349 alocações hoje em "Concluído", **todas** têm a movimentação no histórico. 13 foram encerradas e **reabertas**
  (voltaram a coluna não final): a regra "1ª entrada" as conta como encerradas; precisa decidir se reabrir desfaz o encerramento.
- Orçado preenchido (`qtdhor > 0`) em 100% das encerradas. `seqati` presente em 100% (dá para ligar ao realizado).

### Cobertura: quanto do trabalho real o quadro enxerga

Horas executadas desde 01/08/2026, por situação da alocação:

| Situação | Alocações | Horas | % |
|---|---:|---:|---:|
| Encerrada no quadro | 123 | 937 | **11,0%** |
| No quadro, ainda aberta | 352 | 4.585 | 53,7% |
| Fora do quadro (nunca movida) | 2.136 | 2.567 | 30,0% |
| Apontamento sem alocação | — | 454 | 5,3% |

**Leitura:** a Eficiência Global "das tarefas encerradas" usa a menor fatia do trabalho. Mais da metade das horas está em
tarefas que **ainda estão abertas**. Dois cuidados: (1) tarefa encerrada é a que terminou, então a base é enviesada para o
que fechou; (2) a base cresce se a adoção do quadro continuar até janeiro.

## 2. Orçado × executado das encerradas (desde 01/07)

Orçado = `qtdhor` da alocação; executado = realizado da alocação (mesma regra do teto: RatItem por `seqati` + sessões não confirmadas).

| depexe do item | Encerradas | Consultores | Orçado (h) | Executado (h) | Orçado ÷ Executado |
|---|---:|---:|---:|---:|---:|
| 8 Consultoria ERP | 129 | 11 | 2.005,6 | 1.697,9 | 118,1% |
| 9 Consultoria HCM | 148 | 10 | 2.414,1 | 2.535,8 | 95,2% |
| **8 + 9 (a área)** | **277** | — | **4.419,7** | **4.233,7** | **104,4%** |
| Demais (1, 2, 3, 4, 5, 6, 10, 11) | 85 | — | 1.429,8 | 972,1 | — |
| **Todas** | **362** | **21** | **5.849,5** | **5.205,8** | **112,4%** |

- A área de Consultoria (depexe 8 e 9) concentra **77%** das encerradas (277 de 362).
- Distribuição por consultor: 13 têm 10 ou mais encerradas (331 das 362), 3 têm de 5 a 9, 3 têm de 2 a 4 e 2 têm só 1.
- 314 das 362 ficaram dentro do orçado e **48 acima**. 17 têm horas excedentes autorizadas.
- 38 encerradas têm **zero hora executada** (24 no depexe 8, 7 no 9): cartão movido para Concluído sem apontamento.
  Elas entram no orçado e não no executado, o que **infla** o índice. Precisa de regra: excluir encerradas sem horas, ou contar como "sem base".
- O índice do regulamento (Σ orçado ÷ Σ executado) é **diferente** da "eficiência" do painel (horas dentro do orçado ÷ executado, teto 100%).
  Com a definição do painel, as mesmas 362 dão 81,5%. São motores diferentes; o plano já prevê motor novo.

## 3. Apontamento online × retroativo

Sinais disponíveis (todos medidos):

1. **Sessão Start/Stop ao vivo:** `criadoEm` até 5 min depois de `inicio`.
2. **Sessão de solicitação de apontamento aprovada** (`solicitacoes_apontamento.sessaoId`): retroativo explícito.
3. **Sessão criada depois do fato** (atraso maior que 5 min, sem solicitação): retroativo provável.
4. **Lançado direto no Senior** (RatItem sem sessão do CaxHub): sem timestamp de criação, mas há `datreg` (data de registro) para comparar com `datati`.

De onde vêm as horas executadas desde 01/08/2026 (RatItem válido):

| Origem | Horas | % |
|---|---:|---:|
| Lançado direto no Senior (sem sessão) | 4.174 | **48,9%** |
| Sessão ao vivo (Start/Stop) | 3.311 | 38,8% |
| Sessão de solicitação aprovada (retroativo explícito) | 865 | 10,1% |
| Sessão criada depois do fato (retroativo provável) | 193 | 2,3% |

Dos lançados direto no Senior, pelo atraso entre o dia trabalhado (`datati`) e o do registro (`datreg`):
**12,7% no mesmo dia**, 12,2% no dia seguinte, 11,4% em 2 a 3 dias, 18,7% em 4 a 7 dias e **45,0% depois de mais de 7 dias**
(mediana de 4 dias; `datreg` nunca é anterior a `datati` em 5.431 apontamentos).

Por consultor (32 com 10 h ou mais desde agosto), % das horas "online":

| Definição | ≥ 90% | 70–90% | 40–70% | < 40% | dos quais **0%** | Mediana |
|---|---:|---:|---:|---:|---:|---:|
| A: só Start/Stop ao vivo | 0 | 2 | 15 | 15 | **10** | 41,5% |
| B: A + Senior registrado no mesmo dia | 2 | 5 | 14 | 11 | **9** | 56,6% |

**Leitura:** o indicador **discrimina** (de 0% a mais de 90%), então serve. Chama atenção que **10 dos 32 consultores não usam o
Start/Stop** (0% pela definição A), e que ninguém chega a 90% por ela. Isso muda o peso do indicador na prática: com a regra do regulamento
(requisito individual indivisível), uma meta alta de apontamento online reprovaria a maioria no 1º ciclo. A escolha entre A e B é **política**:
o regulamento diz "apontamento online, via StartStop, no momento da execução", o que aponta para a definição **A**; a B só vale se a Gerência
aceitar o lançamento no Senior no mesmo dia como online. **A hipótese sobre `datreg` (data em que o apontamento foi registrado, não a do
sync) precisa de confirmação com a Gerência** em um caso conhecido antes de entrar numa apuração real.

## 4. "Tarefa da área"

Pelo `depexe` do **item da proposta**, 8 (Consultoria ERP) e 9 (Consultoria HCM) concentram 277 das 362 encerradas e **19 consultores**
com apontamento em itens desses departamentos desde agosto (3.784 h). A alternativa "pelo time do consultor" (`DepartamentoTime`) não foi
cruzada nesta fase, porque exige o mapeamento `codusu` → `codfor` da regra de `contextoProjeto.ts`; fica para o início da Fase 1.

## Consequências para o plano

1. **Cronograma fica desativado** no 1º ciclo (0,2% de preenchimento). Para ativá-lo, é preciso que `dataPrevistaFim` seja exigida ao
   mover a tarefa para "Em Andamento". Alternativa a avaliar: usar o prazo da proposta (`datval`), que é do ERP, mas é prazo do projeto e não da tarefa.
2. **Produtividade e Eficiência Global** entram, com **amostra mínima** configurável por ciclo (sugestão: 5 encerradas por consultor para o individual)
   e devolvem "sem base" abaixo disso, nunca um 0% falso.
3. **Regra para encerrada sem horas** (38 de 362): proposta de excluir da conta e listar na apuração.
4. **Regra para tarefa reaberta** (13): proposta de manter a data da 1ª entrada, conforme o plano, e sinalizar.
5. **Apontamento online** entra pela definição A, com a B como parâmetro do ciclo, e a confirmação do `datreg` como pendência. A **meta** do indicador precisa ser calibrada com esses números (mediana 41,5%), senão reprova quase todos.
6. O ensaio de fevereiro de 2027 deve ser descrito como "agosto a dezembro de 2026", já que não há encerramento antes de 07/08/2026.

## Decisão do Vitor (15/10/2026)

**A unidade de medida é o item da proposta, não a atividade atribuída ao consultor.** Isso encerra as perguntas sobre tarefa encerrada sem
horas e tarefa reaberta (não há "tarefa encerrada"), e as seções 1 e 2 acima passam a ser só contexto (de por que o quadro não serve de base).
Detalhes e consequências no [`PLANO.md`](PLANO.md), seção "Decisão de 15/10/2026".

## Decisões que ainda dependem da Gerência

- Encerrada **sem horas executadas** conta ou não conta?
- Tarefa **reaberta** continua encerrada?
- Online = só Start/Stop (A) ou também Senior no mesmo dia (B)?
- Qual a amostra mínima de encerradas por consultor para o indicador individual?
- Cronograma: exigir a data prevista de fim no quadro, ou usar outro critério?
