# Plano de Evolução Profissional e Eficiência (consultores PJ) dentro do Painel de Eficiência do CaxHub

> **Estado em 15/10/2026 — Fase 0 medida (`FASE0-medicoes.md`), Fase 1 entregue e SEM commit** na worktree `CaxHub-plano-evolucao` (branch `plano-evolucao`).
> Fase 1 = motor puro (`backend/src/domain/planoEvolucao/`), tabelas `plano_*` (2 migrations), `routes/planoEvolucao.ts`, telas `PlanoEvolucao` (gestão) e `MeuPlano`.
> Testes: `scripts/verificar-plano-evolucao.ts` (136) e `prisma/verificarPlanoEvolucaoApi.ts` (88). Falta a **Fase 2**: lançamentos do gestor, apuração com snapshot,
> memória de cálculo em PDF, devolutiva e contestação, efetivação gravada e CSV. As seções abaixo que falam em alocação, `atividades_consultor` e coluna do quadro
> foram **substituídas** pela decisão do item da proposta (seção "Decisão de 15/10/2026").

## Contexto

A Soeltech vai pagar mérito aos consultores PJ pelo regulamento `Plano_de_Evolucao_Profissional_e_Eficiencia_v3.1`
(`D:\Projeto com IA\Exemplos\Eficiencia Soeltech\`). A cada ciclo semestral (1º ciclo: 01/01/2027 a 30/06/2027) o consultor
é avaliado em 5 requisitos de 1% cada: 4 individuais e indivisíveis (Certificações, Avaliação de Clientes, Case Técnico,
**Eficiência Individual**) e 1 coletivo e opcional (**Eficiência Global** da área). Há ainda um portão: Avaliação de
Competências ≥ 80%. O resultado vira o **Valor Hora do Ciclo** = Valor Hora Base × (1 + Pontuação + Reforçador). O
Reforçador soma +0,5 p.p. por ciclo consecutivo cumprido. Falhar um requisito individual zera tudo e volta à base. Dez
ciclos consecutivos efetivam o valor como nova base.

O CaxHub já mede horas orçadas e executadas, Start/Stop, escopo de gestor e time. O objetivo é entregar o cálculo do mérito
**dentro da área de Eficiência** (Gestão de Projetos › Eficiência), com as duas eficiências automáticas e o resto
registrado pelo gestor.

**Decisões do Vitor (14/10/2026):**
- Eficiência Individual: indicadores automáticos mais os que o gestor completa, todos configuráveis por ciclo.
- Eficiência Global: razão das somas, Σ orçado ÷ Σ executado das tarefas encerradas no ciclo.
- Avaliação de Clientes: não será implementada como formulário. O gestor só lança o resultado na apuração.
- Valor Hora Base: informado na adesão, com histórico.
- Certificações, Case e Competências: o gestor registra o resultado, sem upload.
- Devolutiva: memória de cálculo (tela e PDF) mais o registro de contestação e desfecho, sem prazos automáticos.
- Consultor: vê só o próprio andamento.

## Decisão de 15/10/2026 (após a Fase 0): a unidade é o ITEM DA PROPOSTA, não a atividade atribuída ao consultor

Resposta do Vitor às perguntas da Fase 0: **"sempre olhar para o item da proposta e não por atividade atribuída ao consultor"**.
Consequências, que **substituem** o que este plano dizia antes sobre alocações e coluna do quadro:

- **Orçado** = horas vendidas do item (`propostas_itens.qtdhor`); **executado** = tudo apontado no item (RatItem por `codpro + seqite`,
  mesma regra do executado do painel). Não se usa `atividades_consultor`, `seqati`, quadro Kanban nem `dataPrevistaFim`.
- **Sem "tarefa encerrada"**: o item do Senior não tem data de encerramento (nem a proposta). A pergunta "encerrada sem horas conta?" e
  "reaberta continua encerrada?" **deixam de existir**.
- **Como a eficiência é apurada no ciclo**: cada hora apontada no ciclo, em ordem de data, é classificada como **dentro** ou **acima** do
  orçado do item (acumulado do item até aquela hora, contando o que foi executado antes do ciclo). O estouro cai em quem apontou depois de o
  item passar do vendido. É a mesma contabilidade da tendência do painel (`carregarTendencia`).
  - **Eficiência Individual (produtividade)** = horas do consultor dentro ÷ horas do consultor, nos itens da área, no ciclo.
  - **Eficiência Global** = o mesmo, somando todos os consultores nos itens da área. Meta publicada na abertura do ciclo.
  - Diferença consciente do regulamento: o texto fala em Σ orçado ÷ Σ executado das tarefas encerradas; sem data de encerramento essa conta
    não existe, e a versão "dentro ÷ executado" tem teto de 100% (não passa de 100% quando se executa menos que o orçado). A meta tem que ser
    escrita nesta escala. **Confirmar com a Gerência** na abertura do 1º ciclo.
  - **Amostra mínima**: consultor com menos de N horas (padrão 10 h) executadas nos itens da área no ciclo fica "sem base" (nunca 0% falso).
- **Tarefa da área** = `depexe` do item da proposta ∈ `departamentosArea` (padrão 8 e 9).
- **Apontamento online**: indicador automático por consultor, definição A (só Start/Stop ao vivo) ou B (A + Senior no mesmo dia), parâmetro do ciclo.
  Meta tem que ser calibrada (mediana 41,5% pela A em ago-out/2026; 10 de 32 consultores com 0%).
- **Cronograma**: desativado (0,2% de preenchimento). Os demais indicadores (retrabalho, qualidade técnica, aderência) são manuais.
- **Fase 1 NÃO inclui** lançamentos do gestor nem a apuração com snapshot (isso é Fase 2). A Fase 1 entrega ciclos e parâmetros com trava,
  participantes e adesão, o motor, a prévia ao vivo e as telas de gestão e "Meu plano".
- **Pendentes de decisão da Gerência** (viram parâmetro do ciclo, nada bloqueia): definição de online (A ou B); amostra mínima; meta global e
  metas dos indicadores; se o ciclo "não apurado" quebra a sequência (padrão: não quebra).

## O que a exploração mostrou (decide o desenho)

- **A eficiência do painel NÃO é a do regulamento.**
  - Hoje `eficiencia(dentro, executado)` em `backend/src/domain/eficienciaPropostas.ts` mede quanto do executado ficou
    dentro do orçado, com teto de 100%.
  - Não tem filtro de período e ignora propostas Executadas (`SITPRO_ATIVIDADES_VISIVEIS = [4,7]`).
  - **Consequência: motor novo, sem mexer na definição do painel.** Reaproveita o carregamento de dados e o "realizado".
- **Encerramento de tarefa.** A única data confiável é o 1º `AtividadeHistoricoMovimentacao.movidoEm` numa coluna
  `QuadroColuna.ehFinal`. Mesma regra do SLA de `GET /atividades/indicadores` (`routes/atividades.ts` ~644-667).
- **Orçado por tarefa (alocação):** `atividades_consultor.qtdhor` (mais `horasExcedentes` = `tetoDaAtividade`).
- **Executado por tarefa:** `realizadoDasAtividades` (`domain/tetoAtividade.ts`), por `seqati`.
- **Apontamento online versus retroativo.**
  - `AtividadeSessaoExecucao.origem` não separa os dois.
  - Os sinais que existem:
    - sessão criada aberta (`fim` nulo na criação, `criadoEm` ≈ `inicio`) é online;
    - sessão de `SolicitacaoApontamento.sessaoId`, sessão do `POST /apontamentos/manual` do gestor e `RatItem` com
      `origemCaxHub=false` (lançado no Senior) são retroativas.
  - Precisa validação em dado real.
- **Valor-hora do contrato** (`contratos_consultores.vlrhor`): só cerca de 31 de 117, sem vigência nem histórico.
  - Não existe marcação PJ/CLT.
  - Por isso a base vem da adesão; o contrato aparece só como sugestão.
- **Infraestrutura reaproveitável:**
  - auditoria: `audit/taxonomia.ts`, `criarEventoAuditoria`, `podeVerEntidade`;
  - sino: `criarNotificacao`, `notificarConsultorPorCodfor`, `destinoDaNotificacao`;
  - PDF de página de impressão: `lib/relatorioPdf.ts`, `gerarPdfDaPagina`;
  - escopo: `contextoProjeto.ts` (`resolverContextoConsultor`, `codforsDoTime`, `gerenciaDepartamento`) e
    `domain/eficienciaAcesso.ts`;
  - menu: flags `gestorOuAdmin` e `souConsultor` no `Sidebar.tsx`;
  - testes: `backend/scripts/verificar-*.ts` (puras) e `backend/prisma/verificar*Api.ts` (API).
- **Área de Consultoria:** depexe 8 (Consultoria ERP) e 9 (Consultoria HCM) em `DEPEXE_LABELS`. Fica configurável no ciclo.

## Restrição de execução: a outra sessão no mesmo painel

A pasta `D:\Projeto com IA\CaxHub` está na branch `painel-eficiencia-fase2` com 40 arquivos sem commit, de outra sessão.
**Nada deste plano começa nessa pasta.**
- Trabalho numa **worktree própria** (`CaxHub-plano-evolucao`, branch `plano-evolucao`), criada a partir da `main` depois
  que a fase 2 for mesclada. Se ela não estiver mesclada, criar a partir de `painel-eficiencia-fase2` com o Vitor sabendo.
- O código novo fica quase todo em arquivos próprios.
- Arquivos compartilhados com a fase 2, tocados com cuidado e mesclados por último: `schema.prisma`, `server.ts`,
  `App.tsx`, `Sidebar.tsx`, `audit/taxonomia.ts`, `routes/auditoria.ts`, `NotificacoesSino.tsx`.

## Desenho

### Modelo de dados (Prisma, tabelas novas `plano_evolucao_*`, migration à mão)

- **`PlanoCiclo`**
  - Campos: `id`, `ano`, `semestre`, `inicio`, `fim`.
  - `status`: rascunho → publicado → em_apuracao → encerrado.
  - `publicadoEm/Por`.
  - Parâmetros do item 12:
    - `metaEficienciaGlobal` (%), `departamentosArea` (int[], padrão {8,9});
    - `certificacoesExigidas` e `atividadesElegiveisClientes` (texto);
    - `notaMinimaEficienciaIndividual` (% dos pesos, padrão 100);
    - `orcadoComExcedentes` (bool);
    - as datas do calendário 3.2 (corte, apuração, devolutiva, contestação, encerramento).
  - **Parâmetros travados após publicar** (o regulamento proíbe mudar com o ciclo em andamento): o backend recusa PUT.
- **`PlanoCicloIndicador`**
  - Campos: `cicloId`, `chave`, `tipo` (automático/manual), `peso`, `meta`, `ordem`.
  - Chaves: `produtividade`, `apontamento_online`, `cronograma`, `qualidade_tecnica`, `aderencia_processos`, `retrabalho`.
- **`PlanoParticipante`**
  - Campos: `codemp`, `codfor`, `dataAdesao` (termo assinado), `versaoRegulamento` ("3.1"), `primeiroCicloId`, `status`
    (ativo/encerrado), `encerradoEm/motivo`.
- **`PlanoValorBase`** (histórico)
  - Campos: `participanteId`, `valorHoraBase`, `desde`.
  - `motivo`: adesão, efetivação ou reajuste contratual.
- **`PlanoApuracao`** (participante × ciclo)
  - Status: em_andamento, apurado, devolutiva, encerrado ou não_apurado.
  - Portão:
    - `contratoAtivoNoCiclo` e `interrupcaoDias` (prorrogação do item 3.3);
    - `competenciasPct`.
  - Requisitos lançados pelo gestor:
    - Certificações (cumpriu e observação);
    - Clientes (média e nº de respostas; regra: menos de 3 respostas = cumprido, senão média ≥ 8,0);
    - Case (cumpriu e observação);
    - indicadores manuais.
  - **Snapshot congelado na apuração** (JSON): indicadores automáticos, pontuação da eficiência individual, resultado global.
  - Resultado: `pontuacao`, `ciclosConsecutivosAntes`, `reforcador`, `percentual`, `valorHoraCiclo`, `efetivou`.
  - Devolutiva: `devolutivaEm`, `houveContestacao`, `contestacaoTexto`, `desfecho`.
  - Tudo auditado.
- **`PlanoCicloResultadoGlobal`**
  - Campos: `cicloId`, `orcadoMin`, `executadoMin`, `indice`, `meta`, `atingiu`, `tarefas`, `calculadoEm` (snapshot).

### Motor (funções puras em `backend/src/domain/planoEvolucao/`, testáveis sem banco)

- **`regras.ts`**
  - Regra 4+1:
    - os 4 individuais cumpridos dão 4, mais 1 se a meta global for atingida;
    - qualquer individual falho, ou portão (competências < 80%), dá 0 e "descumprido";
    - contrato inativo dá "não apurado".
  - Reforçador = 0,5 × ciclos consecutivos cumpridos antes do atual, desde a última efetivação ou reinício.
  - Percentual = pontuação + reforçador.
  - Valor = base × (1 + %).
  - Descumprimento: volta à base vigente e zera a sequência.
  - Global não atingido: não quebra a sequência.
  - Efetivação no 10º consecutivo: o valor do ciclo vira a nova base e a sequência recomeça.
  - Sempre sobre a base, nunca sobre o ciclo anterior.
- **`calendario.ts`**: semestre civil, datas D+150/D+170/D+175/D+180, prorrogação por interrupção > 30 dias.
- **`indicadores.ts`**: indicadores automáticos por consultor no ciclo, todos sobre **alocações encerradas no ciclo**
  (1ª entrada em coluna `ehFinal` com `movidoEm` dentro do ciclo):
  - **produtividade**: Σ orçado ÷ Σ executado × 100;
  - **cronograma**: % encerradas até a `dataPrevistaFim`, só as que têm data prevista;
  - **apontamento online**: % dos minutos executados no ciclo vindos de sessão Start/Stop ao vivo, sobre o total
    (sessões e RAT do Senior).
  - Indicador sem base suficiente devolve "sem base", nunca 0% falso (regra do KPI honesto).
- **`eficienciaIndividual.ts`**: atingiu a meta de cada indicador soma o peso; requisito cumprido se a soma ≥
  `notaMinimaEficienciaIndividual`. Os manuais entram pelo lançamento do gestor.
- **`eficienciaGlobal.ts`**: tarefas encerradas no ciclo cujo item da proposta tem depexe ∈ `departamentosArea`;
  índice = Σ orçado ÷ Σ executado × 100; atingiu se ≥ meta.
- **Dados:** `planoEvolucaoDados.ts`, com SQL de alocações encerradas no período e minutos online/retroativos.
  Reaproveita `realizadoDasAtividades` e `filtroRatItemRealizado`, sem segunda definição de realizado.

### API (`backend/src/routes/planoEvolucao.ts`)

- **Admin** (Diretoria e Gestão de Pessoas):
  - CRUD de ciclo e indicadores, publicar (trava) e encerrar;
  - participantes e adesão, histórico da base;
  - exportar CSV do valor hora por consultor e ciclo (para o faturamento e o aditivo; o CaxHub não paga, informa).
- **Gestor do departamento** (`gerenciaDepartamento` e `codforsDoTime`), só o time dele; admin vê tudo:
  - prévia ao vivo;
  - lançar portão, requisitos e indicadores manuais;
  - apurar (gera o snapshot), devolutiva, contestação e desfecho.
- **Consultor** (`/meu`, guarda por handler): só a própria apuração e prévia.
- Auditoria: entidades `plano_ciclo`, `plano_participante`, `plano_apuracao`, com branch em `podeVerEntidade`.
- Sino: "ciclo publicado" e "resultado disponível para devolutiva".

### Telas (dentro de Gestão de Projetos › Eficiência)

- **`/projetos/eficiencia/plano-evolucao`** (gestorOuAdmin), com link a partir do Painel de Eficiência. Abas:
  - **Ciclo atual:** prévia por consultor, com indicadores ao vivo, requisitos lançados, status e valor projetado;
    mais o índice global da área contra a meta.
  - **Apuração:** gaveta por consultor para lançar portão e requisitos, apurar e registrar devolutiva e contestação.
  - **Ciclos e parâmetros:** admin.
  - **Participantes:** adesão, base e histórico de ciclos com o reforçador.
  - **Como calculamos:** regras do regulamento com a matriz.
- **Memória de cálculo:** página de impressão com PDF via `gerarPdfDaPagina`, mostrando os 5 requisitos, o portão, o
  reforçador e o valor hora.
- **`/projetos/meu-plano`** (souConsultor): ciclo atual, eficiência individual parcial, eficiência global da área,
  requisitos, valor projetado e histórico. Sem colegas.
- **Arquivos novos:** `frontend/src/pages/projetos/PlanoEvolucao.tsx`, `MeuPlano.tsx`,
  `components/planoEvolucao/*`, `lib/planoEvolucao.ts`.

## Fases e datas

- **Fase 0 — base e integração** (antes de codar, 1 a 2 dias):
  - worktree própria após a fase 2;
  - medir em dado real o preenchimento de `dataPrevistaFim`, o uso de coluna final como encerramento e a
    classificação online/retroativa;
  - verificar as tarefas da área por depexe.
  - O resultado decide quais indicadores automáticos ficam ativos no 1º ciclo.
- **Fase 1 — até 15/12/2026, no ar antes de 01/01/2027:**
  - modelo, migrations e motor puro com testes;
  - ciclos e parâmetros com trava;
  - participantes e adesão;
  - indicadores e índice global ao vivo (prévia);
  - telas de gestão e "Meu plano".
  - O 1º ciclo é publicado em 01/01/2027.
- **Ensaio — fevereiro de 2027:** apuração simulada do 2º semestre de 2026 com dados reais, para a gestão validar
  números e metas antes da apuração real.
- **Fase 2 — até 30/04/2027** (a apuração do 1º ciclo começa em 31/05/2027):
  - lançamentos do gestor e apuração com snapshot;
  - memória de cálculo em PDF;
  - devolutiva e contestação;
  - encerramento, efetivação e CSV.

## Pontos a confirmar com a Gerência (não bloqueiam a Fase 1, viram parâmetro ou regra documentada)

1. **Ciclo "não apurado"** (contrato inativo): quebra a sequência dos 10 ciclos? O texto só diz que "não conta".
   Padrão proposto: não conta e não quebra; o encerramento do contrato encerra a participação (item 14).
2. **Orçado com ou sem horas excedentes autorizadas:** fica como parâmetro do ciclo.
3. **"Tarefa da área":** pelo depexe do item da proposta (proposto) ou pelo time do consultor.
4. **Quem é "Gestão de Pessoas" no CaxHub:** proposto o papel admin.

## Verificação

- **Motor puro** (`scripts/verificar-plano-evolucao.ts`):
  - matriz completa do item 7.3;
  - cenários A, B, C e D do item 8 como casos de teste, com os valores do documento;
  - portão < 80%, menos de 3 avaliações de cliente, prorrogação e efetivação com nova base.
- **API** (`prisma/verificarPlanoEvolucaoApi.ts`):
  - trava dos parâmetros publicados;
  - escopo do gestor (só o time) e consultor só o dele (404 no resto);
  - snapshot imutável após apurar;
  - auditoria.
- **Indicadores:** conferir 2 ou 3 consultores contra cálculo manual no banco (SQL direto), mais o índice global.
- **Validação:** `tsc` e `vite build`; telas no Edge headless nos dois temas e a 390 px; deploy na VPS da Soeltech
  (roteiro em `deploy-vps-soeltech`) só com pedido explícito.
