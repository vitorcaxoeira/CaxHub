import { Router, Response } from "express";
import { requireAuth, requireRole, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { depexeLabel } from "../domain/propostasDominio";
import { validarPeriodoMensal, valorManualEm } from "../domain/custoHora";
import { linhaDoTempoDoContrato, type LinhaDoTempoValorHora } from "../domain/valorHoraConsultor";
import { contratoFixoDe } from "../domain/contratoFixo";
import { sugerirAtendenteKyria, sugerirColaboradorHcm, type Confianca } from "../domain/vinculoConsultor";
import { RESTRICOES_VINCULO, ROLES_VINCULAVEIS_KYRIA } from "../kyria/dadosSincronizados";

// Administração > Vínculo de Consultores (custo-hora real, bloco C da Rentabilidade, 18/11/2026). Liga cada CONSULTOR (Senior) ao atendente do Kyria
// (de onde vêm as horas dos tickets) e ao funcionário do HCM (de onde vem a folha do CLT). Os dois lados moram em lugares diferentes de propósito:
//   - Kyria: `kyria_members.codusu` — o campo interno que "Ver dados" já grava e que os cálculos de horas já leem (uma só fonte; só `attendant`, `admin` e `manager`).
//   - HCM: `consultor_vinculos` (tabela nativa), um funcionário por consultor (unique).
// O consultor PJ não tem funcionário: o custo dele vem do contrato de compra (E460CTR/CCS/REA), mostrado aqui como valor-hora atual + reajustes.
// Só administrador. Montado em server.ts como "/consultores-vinculos".
export const consultoresVinculosRouter = Router();
consultoresVinculosRouter.use(requireAuth, requireRole("admin"));

function handleError(res: Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[consultores-vinculos:${label}]`, message);
  res.status(500).json({ error: message });
}

/** Id do usuário logado (quem fez a alteração), para a auditoria mínima da tabela. */
const usuarioDe = (req: unknown): number | null => (req as AuthenticatedRequest).user?.userId ?? null;

const MOTIVO_ATENDENTE = RESTRICOES_VINCULO["kyria_members.codusu"].motivo;

/** "numemp-tipcol-numcad" — o identificador do funcionário do HCM na tela. */
const chaveHcm = (numemp: number, tipcol: number, numcad: number) => `${numemp}-${tipcol}-${numcad}`;

function lerHcm(valor: unknown): { numemp: number; tipcol: number; numcad: number } | null {
  if (typeof valor !== "string") return null;
  const m = /^(\d+)-(\d+)-(\d+)$/.exec(valor);
  return m ? { numemp: Number(m[1]), tipcol: Number(m[2]), numcad: Number(m[3]) } : null;
}

const dia = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
const numero = (v: unknown): number | null => (v == null ? null : Number(v));

interface FuncionarioHcm {
  numemp: number;
  tipcol: number;
  numcad: number;
  nomfun: string | null;
  sitafa: number | null;
  dessit: string | null;
  datadm: Date | null;
  datafa: Date | null;
}

function funcionariosHcm(): Promise<FuncionarioHcm[]> {
  return prisma.$queryRaw<FuncionarioHcm[]>`
    SELECT c.numemp, c.tipcol, c.numcad, c.nomfun, c.sitafa, btrim(s.dessit) AS dessit, c.datadm, c.datafa
    FROM hcm_colaboradores c
    LEFT JOIN hcm_situacoes s ON s.codsit = c.sitafa
    WHERE c.removido_em_senior IS NULL
    ORDER BY c.nomfun`;
}

/** "DEMITIDO em 31/01/2024" — o demitido continua na lista (dado histórico: o consultor pode ter sido CLT antes de virar PJ), mas bem marcado. */
function rotuloFuncionario(f: FuncionarioHcm): string {
  const dataFim = f.datafa ? f.datafa.toISOString().slice(0, 10).split("-").reverse().join("/") : null;
  const situacao = f.sitafa === 7 ? `DEMITIDO${dataFim ? ` em ${dataFim}` : ""}` : f.sitafa === 1 || f.sitafa == null ? null : (f.dessit ?? `situação ${f.sitafa}`).toLowerCase();
  return `${f.nomfun ?? "(sem nome)"} · mat. ${f.numcad} · emp ${f.numemp} tipo ${f.tipcol}${situacao ? ` · ${situacao}` : ""}`;
}

type Regime = "pj" | "folha" | "ambos" | "indefinido";

/** Como o custo do consultor será obtido: contrato (PJ), folha (HCM) ou os dois (conferir) ou nenhum (ainda sem custo definido). */
function regimeDoConsultor(temContratoDeValorHora: boolean, temHcm: boolean): Regime {
  if (temContratoDeValorHora && temHcm) return "ambos";
  if (temContratoDeValorHora) return "pj";
  if (temHcm) return "folha";
  return "indefinido";
}

interface ValorHoraResumo {
  /** Contrato de valor fixo: o valor-hora é o vlrhor da view (como na Home) e o histórico de reajuste do Senior não é usado. */
  fixo: boolean;
  precoAtual: number | null;
  reajustes: number;
  ultimoReajuste: string | null;
  divergencia: LinhaDoTempoValorHora["divergencia"];
}

interface ItemContrato {
  seqccs: number;
  preuni: number;
}

/** O item ATIVO do contrato do consultor (o de menor sequência) — onde está o preço unitário = valor-hora. */
function itemAtivoDoContrato(itens: { seqccs: number; preuni: unknown; sitccs: string }[]): ItemContrato | null {
  const ativos = itens.filter((i) => i.sitccs === "A").sort((a, b) => a.seqccs - b.seqccs);
  return ativos.length > 0 ? { seqccs: ativos[0].seqccs, preuni: Number(ativos[0].preuni) } : null;
}

async function carregarContratos(codemps: number[]) {
  const contratos = await prisma.contratoConsultor.findMany({ where: { codemp: { in: codemps }, removidoEmSenior: null, numctr: { not: null } } });
  const numctrs = contratos.map((c) => c.numctr as number);
  const [itens, reajustes] = numctrs.length
    ? await Promise.all([
        prisma.contratoCompraServico.findMany({ where: { numctr: { in: numctrs }, removidoEmSenior: null } }),
        prisma.contratoCompraReajuste.findMany({ where: { numctr: { in: numctrs }, removidoEmSenior: null }, orderBy: { ultrea: "asc" } }),
      ])
    : [[], []];
  return { contratos, itens, reajustes };
}

type DadosContratos = Awaited<ReturnType<typeof carregarContratos>>;

/** Contrato de VALOR FIXO (codmot 12 com quantidade), como na Home: ver domain/contratoFixo.ts. */
function fixoDoContrato(c: { codmot: number | null; vlrhor: unknown; qtdctr: unknown } | undefined) {
  const vlrhor = numero(c?.vlrhor);
  return c && vlrhor != null ? contratoFixoDe({ codmot: c.codmot, vlrhor, qtdctr: numero(c.qtdctr) }) : null;
}

function resumoDoValorHora(codemp: number, numctr: number, dados: DadosContratos): { resumo: ValorHoraResumo; linha: LinhaDoTempoValorHora; item: ItemContrato | null } {
  const item = itemAtivoDoContrato(dados.itens.filter((i) => i.codemp === codemp && i.numctr === numctr));
  const doItem = item ? dados.reajustes.filter((r) => r.codemp === codemp && r.numctr === numctr && r.seqccs === item.seqccs) : [];
  const contrato = dados.contratos.find((c) => c.codemp === codemp && c.numctr === numctr);
  const linha = linhaDoTempoDoContrato({
    fixo: !!fixoDoContrato(contrato),
    vlrhorDaView: numero(contrato?.vlrhor),
    reajustes: doItem.map((r) => ({ ultrea: dia(r.ultrea) as string, vlrrea: numero(r.vlrrea), vlratu: numero(r.vlratu), perrea: numero(r.perrea), desrea: r.desrea })),
    precoAtualDoItem: item?.preuni ?? null,
  });
  const fixo = !!fixoDoContrato(contrato);
  const ultimo = !fixo && doItem.length > 0 ? dia(doItem[doItem.length - 1].ultrea) : null;
  return {
    resumo: {
      fixo,
      precoAtual: fixo ? numero(contrato?.vlrhor) : (item?.preuni ?? null),
      reajustes: fixo ? 0 : doItem.length,
      ultimoReajuste: ultimo,
      divergencia: linha.divergencia,
    },
    linha,
    item,
  };
}

interface SugestaoLinha {
  valor: string;
  confianca: Confianca;
  motivo: string;
}

/** Tudo que a tela (e a aplicação em lote das sugestões) precisa: uma linha por consultor, as opções e as sugestões. */
async function montarPainel(incluirInativos: boolean) {
  const consultores = await prisma.consultor.findMany({
    where: { removidoEmSenior: null, ...(incluirInativos ? {} : { sitfor: "A" }) },
    include: { vinculo: true },
    orderBy: [{ nomcom: "asc" }, { codusu: "asc" }],
  });
  const codemps = [...new Set(consultores.map((c) => c.codemp))];

  const manuais = await prisma.consultorValorHoraManual.findMany({ select: { codemp: true, codusu: true, vigenciaInicio: true, valor: true } });
  const primeiroDiaDoMes = `${new Date().toISOString().slice(0, 7)}-01`;
  const manualPorConsultor = new Map<string, { vigenciaInicio: string; valor: number }[]>();
  for (const m of manuais) {
    const k = `${m.codemp}-${m.codusu}`;
    manualPorConsultor.set(k, [...(manualPorConsultor.get(k) ?? []), { vigenciaInicio: dia(m.vigenciaInicio) as string, valor: Number(m.valor) }]);
  }

  const [atendentes, funcionarios, dadosContratos, espelhos] = await Promise.all([
    prisma.kyriaMember.findMany({
      where: { OR: [{ role: { in: [...ROLES_VINCULAVEIS_KYRIA] } }, { codusu: { not: null } }] },
      select: { id: true, name: true, email: true, status: true, role: true, codusu: true },
      orderBy: { name: "asc" },
    }),
    funcionariosHcm(),
    carregarContratos(codemps),
    Promise.all([prisma.contratoCompra.count(), prisma.contratoCompraServico.count(), prisma.contratoCompraReajuste.count()]),
  ]);

  const consultorDoMembro = new Map<string, number>();
  const membrosDoConsultor = new Map<number, string[]>();
  for (const m of atendentes) {
    if (m.codusu == null) continue;
    consultorDoMembro.set(m.id, m.codusu);
    membrosDoConsultor.set(m.codusu, [...(membrosDoConsultor.get(m.codusu) ?? []), m.id]);
  }
  const consultorDoFuncionario = new Map<string, number>();
  const vinculos = await prisma.consultorVinculo.findMany({ where: { hcmNumcad: { not: null } } });
  for (const v of vinculos) consultorDoFuncionario.set(chaveHcm(v.hcmNumemp as number, v.hcmTipcol as number, v.hcmNumcad as number), v.codusu);
  const contratoPorConsultor = new Map(dadosContratos.contratos.map((c) => [`${c.codemp}-${c.codusu}`, c]));

  // Quem ainda pode receber sugestão: atendente sem consultor e funcionário sem consultor — DEMITIDOS incluídos (18/11/2026, pedido do Vitor: dado
  // histórico). Um nome que existe como demitido E como ativo (recontratação) fica ambíguo e não é sugerido.
  const atendentesLivres = atendentes.filter((m) => ROLES_VINCULAVEIS_KYRIA.includes(m.role) && m.codusu == null);
  const funcionariosLivres = funcionarios.filter((f) => !consultorDoFuncionario.has(chaveHcm(f.numemp, f.tipcol, f.numcad)));

  const linhas = consultores.map((c) => {
    const contrato = contratoPorConsultor.get(`${c.codemp}-${c.codusu}`) ?? null;
    const temValorHora = !!contrato && contrato.vlrhor != null;
    const valorHora = contrato?.numctr != null ? resumoDoValorHora(c.codemp, contrato.numctr, dadosContratos).resumo : null;
    const hcm = c.vinculo?.hcmNumcad != null ? chaveHcm(c.vinculo.hcmNumemp as number, c.vinculo.hcmTipcol as number, c.vinculo.hcmNumcad) : null;
    const kyriaMemberIds = membrosDoConsultor.get(c.codusu) ?? [];

    let sugestaoKyria: SugestaoLinha | null = null;
    if (kyriaMemberIds.length === 0) {
      const s = sugerirAtendenteKyria(c, atendentesLivres);
      if (s) sugestaoKyria = { valor: s.item.id, confianca: s.confianca, motivo: s.motivo };
    }
    let sugestaoHcm: SugestaoLinha | null = null;
    if (hcm === null) {
      const s = sugerirColaboradorHcm(c, funcionariosLivres);
      if (s) sugestaoHcm = { valor: chaveHcm(s.item.numemp, s.item.tipcol, s.item.numcad), confianca: s.confianca, motivo: s.motivo };
    }

    return {
      codemp: c.codemp,
      codusu: c.codusu,
      nome: (c.nomcom ?? "").trim() || (c.nomfor ?? "").trim() || `Consultor ${c.codusu}`,
      nomeFornecedor: c.nomfor,
      email: c.email,
      ativo: c.sitfor === "A",
      // Conta habilitada no Senior (USU_VBI00Cons.conhab = 1): é o que libera o consultor nas telas de projeto (domain/contextoProjeto.ts).
      contaHabilitada: c.conhab === 1,
      depexe: c.depexe,
      depexeLabel: depexeLabel(c.depexe),
      contrato: contrato ? { numctr: contrato.numctr, codmot: contrato.codmot, vlrhor: numero(contrato.vlrhor), qtdctr: numero(contrato.qtdctr), fixo: fixoDoContrato(contrato) } : null,
      valorHora,
      regime: regimeDoConsultor(temValorHora, hcm !== null),
      kyriaMemberIds,
      hcm,
      valorManual: { vigencias: manualPorConsultor.get(`${c.codemp}-${c.codusu}`)?.length ?? 0, atual: valorManualEm(manualPorConsultor.get(`${c.codemp}-${c.codusu}`) ?? [], primeiroDiaDoMes) },
      contratoMensal: c.vinculo?.contratoMensal ?? false,
      mensalDesde: c.vinculo?.mensalDesde ? dia(c.vinculo.mensalDesde)?.slice(0, 7) ?? null : null,
      mensalAte: c.vinculo?.mensalAte ? dia(c.vinculo.mensalAte)?.slice(0, 7) ?? null : null,
      observacao: c.vinculo?.observacao ?? null,
      sugestaoKyria,
      sugestaoHcm,
    };
  });

  return {
    linhas,
    atendentes: atendentes.map((m) => ({
      value: m.id,
      label: `${m.name} · ${m.email}${m.status === "inactive" ? " · inativo" : ""}${m.role === "attendant" ? "" : ` · ${m.role}`}`,
      vinculadoA: m.codusu,
    })),
    funcionarios: funcionarios.map((f) => ({
      value: chaveHcm(f.numemp, f.tipcol, f.numcad),
      label: rotuloFuncionario(f),
      vinculadoA: consultorDoFuncionario.get(chaveHcm(f.numemp, f.tipcol, f.numcad)) ?? null,
      demitido: f.sitafa === 7,
    })),
    espelhosContrato: { contratos: espelhos[0], itens: espelhos[1], reajustes: espelhos[2] },
  };
}

consultoresVinculosRouter.get("/", async (req, res) => {
  try {
    res.json(await montarPainel(req.query.inativos === "1"));
  } catch (error) {
    handleError(res, error, "get");
  }
});

function lerChaveConsultor(req: { params: { codemp?: string; codusu?: string } }): { codemp: number; codusu: number } | null {
  const codemp = Number(req.params.codemp);
  const codusu = Number(req.params.codusu);
  return Number.isInteger(codemp) && Number.isInteger(codusu) ? { codemp, codusu } : null;
}

// ---------- Kyria ----------

async function gravarVinculoKyria(codusu: number, memberId: string | null): Promise<void> {
  await prisma.$transaction([
    // Um consultor tem UM atendente: tira qualquer outro que apontasse pra ele antes de ligar o novo.
    prisma.kyriaMember.updateMany({ where: { codusu, ...(memberId ? { id: { not: memberId } } : {}) }, data: { codusu: null } }),
    ...(memberId ? [prisma.kyriaMember.update({ where: { id: memberId }, data: { codusu } })] : []),
  ]);
}

consultoresVinculosRouter.put("/:codemp/:codusu/kyria", async (req, res) => {
  try {
    const chave = lerChaveConsultor(req);
    const memberId: unknown = req.body?.memberId;
    if (!chave || (memberId !== null && (typeof memberId !== "string" || !memberId))) {
      res.status(400).json({ error: "codemp, codusu e memberId (id do atendente no Kyria, ou null para remover) são obrigatórios" });
      return;
    }
    const consultor = await prisma.consultor.findUnique({ where: { codemp_codusu: chave }, select: { codusu: true } });
    if (!consultor) {
      res.status(404).json({ error: "Consultor não encontrado" });
      return;
    }
    if (memberId !== null) {
      const membro = await prisma.kyriaMember.findUnique({ where: { id: memberId }, select: { id: true, role: true, codusu: true, name: true } });
      if (!membro) {
        res.status(404).json({ error: "Membro do Kyria não encontrado" });
        return;
      }
      if (!ROLES_VINCULAVEIS_KYRIA.includes(membro.role)) {
        res.status(400).json({ error: MOTIVO_ATENDENTE });
        return;
      }
      if (membro.codusu != null && membro.codusu !== chave.codusu && req.body?.forcar !== true) {
        res.status(409).json({ error: `${membro.name} já está vinculado ao consultor ${membro.codusu}. Confirme para trocar.`, vinculadoA: membro.codusu });
        return;
      }
    }
    await gravarVinculoKyria(chave.codusu, memberId);
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "put-kyria");
  }
});

// ---------- HCM ----------

async function gravarVinculoHcm(codemp: number, codusu: number, hcm: { numemp: number; tipcol: number; numcad: number } | null, atualizadoPor: number | null): Promise<void> {
  const dados = hcm ? { hcmNumemp: hcm.numemp, hcmTipcol: hcm.tipcol, hcmNumcad: hcm.numcad } : { hcmNumemp: null, hcmTipcol: null, hcmNumcad: null };
  await prisma.$transaction([
    // Um funcionário só pode estar em UM consultor (unique): desliga de quem o tinha antes.
    ...(hcm
      ? [
          prisma.consultorVinculo.updateMany({
            where: { hcmNumemp: hcm.numemp, hcmTipcol: hcm.tipcol, hcmNumcad: hcm.numcad, NOT: { codemp, codusu } },
            data: { hcmNumemp: null, hcmTipcol: null, hcmNumcad: null },
          }),
        ]
      : []),
    prisma.consultorVinculo.upsert({
      where: { codemp_codusu: { codemp, codusu } },
      create: { codemp, codusu, ...dados, atualizadoPor },
      update: { ...dados, atualizadoPor },
    }),
  ]);
}

consultoresVinculosRouter.put("/:codemp/:codusu/hcm", async (req, res) => {
  try {
    const chave = lerChaveConsultor(req);
    const bruto: unknown = req.body?.colaborador;
    const hcm = bruto === null ? null : lerHcm(bruto);
    if (!chave || (bruto !== null && !hcm)) {
      res.status(400).json({ error: "codemp, codusu e colaborador (\"numemp-tipcol-numcad\", ou null para remover) são obrigatórios" });
      return;
    }
    const consultor = await prisma.consultor.findUnique({ where: { codemp_codusu: chave }, select: { codusu: true } });
    if (!consultor) {
      res.status(404).json({ error: "Consultor não encontrado" });
      return;
    }
    if (hcm) {
      const existe = await prisma.hcmColaborador.findUnique({ where: { numemp_tipcol_numcad: hcm }, select: { nomfun: true } });
      if (!existe) {
        res.status(404).json({ error: "Funcionário não encontrado no HCM sincronizado" });
        return;
      }
      const dono = await prisma.consultorVinculo.findFirst({ where: { hcmNumemp: hcm.numemp, hcmTipcol: hcm.tipcol, hcmNumcad: hcm.numcad, NOT: { codemp: chave.codemp, codusu: chave.codusu } }, select: { codusu: true } });
      if (dono && req.body?.forcar !== true) {
        res.status(409).json({ error: `${existe.nomfun ?? "Este funcionário"} já está vinculado ao consultor ${dono.codusu}. Confirme para trocar.`, vinculadoA: dono.codusu });
        return;
      }
    }
    await gravarVinculoHcm(chave.codemp, chave.codusu, hcm, usuarioDe(req));
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "put-hcm");
  }
});

// O preço do contrato PJ é MENSAL (e não por hora)? Escolha explícita: o Senior não marca. Muda o custo-hora real (preço ÷ horas da escala).
consultoresVinculosRouter.put("/:codemp/:codusu/contrato-mensal", async (req, res) => {
  try {
    const chave = lerChaveConsultor(req);
    const periodo = validarPeriodoMensal(req.body);
    if (!chave || !periodo.ok) {
      res.status(400).json({ error: periodo.ok ? "codemp e codusu são obrigatórios" : periodo.erro });
      return;
    }
    const dados = { contratoMensal: periodo.valor.mensal, mensalDesde: periodo.valor.desde ? new Date(`${periodo.valor.desde}T00:00:00Z`) : null, mensalAte: periodo.valor.ate ? new Date(`${periodo.valor.ate}T00:00:00Z`) : null };
    const consultor = await prisma.consultor.findUnique({ where: { codemp_codusu: chave }, select: { codusu: true } });
    if (!consultor) {
      res.status(404).json({ error: "Consultor não encontrado" });
      return;
    }
    await prisma.consultorVinculo.upsert({
      where: { codemp_codusu: chave },
      create: { ...chave, ...dados, atualizadoPor: usuarioDe(req) },
      update: { ...dados, atualizadoPor: usuarioDe(req) },
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "put-contrato-mensal");
  }
});

consultoresVinculosRouter.put("/:codemp/:codusu/observacao", async (req, res) => {
  try {
    const chave = lerChaveConsultor(req);
    const texto: unknown = req.body?.observacao;
    if (!chave || (texto !== null && typeof texto !== "string") || (typeof texto === "string" && texto.length > 500)) {
      res.status(400).json({ error: "observacao deve ser um texto de até 500 caracteres (ou null)" });
      return;
    }
    const consultor = await prisma.consultor.findUnique({ where: { codemp_codusu: chave }, select: { codusu: true } });
    if (!consultor) {
      res.status(404).json({ error: "Consultor não encontrado" });
      return;
    }
    const observacao = typeof texto === "string" && texto.trim() !== "" ? texto.trim() : null;
    await prisma.consultorVinculo.upsert({
      where: { codemp_codusu: chave },
      create: { ...chave, observacao, atualizadoPor: usuarioDe(req) },
      update: { observacao, atualizadoPor: usuarioDe(req) },
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "put-observacao");
  }
});

// Aceita as sugestões de CONFIANÇA ALTA de uma vez, só para quem ainda não tem vínculo daquele lado. A média (nome contido, ou só o nome no Kyria)
// nunca entra em lote: precisa de um olho humano.
consultoresVinculosRouter.post("/aplicar-sugestoes", async (req, res) => {
  try {
    const lado: unknown = req.body?.lado;
    if (lado !== "kyria" && lado !== "hcm") {
      res.status(400).json({ error: "lado deve ser \"kyria\" ou \"hcm\"" });
      return;
    }
    const painel = await montarPainel(false);
    let aplicadas = 0;
    // Duas sugestões podem apontar pro MESMO atendente/funcionário (dois consultores de nome parecido): ninguém entra em lote se disputado.
    const usos = new Map<string, number>();
    for (const l of painel.linhas) {
      const s = lado === "kyria" ? l.sugestaoKyria : l.sugestaoHcm;
      if (s && s.confianca === "alta") usos.set(s.valor, (usos.get(s.valor) ?? 0) + 1);
    }
    for (const l of painel.linhas) {
      const s = lado === "kyria" ? l.sugestaoKyria : l.sugestaoHcm;
      if (!s || s.confianca !== "alta" || (usos.get(s.valor) ?? 0) > 1) continue;
      if (lado === "kyria") await gravarVinculoKyria(l.codusu, s.valor);
      else await gravarVinculoHcm(l.codemp, l.codusu, lerHcm(s.valor), usuarioDe(req));
      aplicadas++;
    }
    res.json({ ok: true, aplicadas });
  } catch (error) {
    handleError(res, error, "aplicar-sugestoes");
  }
});

// ---------- Valor-hora (E460) ----------

// Linha do tempo do valor-hora do consultor PJ: o contrato que a view de contratos do Senior aponta pra ele, o item ativo e cada reajuste.
/**
 * Linha do tempo do valor-hora do consultor PJ: o contrato que a view do Senior aponta pra ele, o item ativo, as vigências (valor por mês) e os reajustes.
 * Usada pela tela de Vínculo de Consultores e pela origem do custo-hora (Custo-hora real). Contrato de valor fixo: ver `linhaDoTempoDoContrato`.
 */
export async function historicoValorHoraDoConsultor(chave: { codemp: number; codusu: number }) {
  const contrato = await prisma.contratoConsultor.findUnique({ where: { codemp_codusu: chave } });
  if (!contrato || contrato.numctr == null) return { contrato: null, item: null, vigencias: [], divergencia: null, reajustes: [] };
  const dados = await carregarContratos([chave.codemp]);
  const { linha, item } = resumoDoValorHora(chave.codemp, contrato.numctr, { ...dados, contratos: [contrato] });
  const itemCompleto = item ? dados.itens.find((i) => i.codemp === chave.codemp && i.numctr === contrato.numctr && i.seqccs === item.seqccs) : null;
  const cabecalho = await prisma.contratoCompra.findFirst({ where: { codemp: chave.codemp, numctr: contrato.numctr }, select: { numofi: true, sitctr: true, inivig: true, fimvig: true, ultrea: true, prdrea: true } });
  return {
    contrato: {
      numctr: contrato.numctr,
      codmot: contrato.codmot,
      vlrhor: numero(contrato.vlrhor),
      qtdctr: numero(contrato.qtdctr),
      fixo: fixoDoContrato(contrato),
      situacao: cabecalho?.sitctr ?? null,
      periodicidadeReajusteMeses: cabecalho?.prdrea ?? null,
      ultimoReajuste: dia(cabecalho?.ultrea),
    },
    item: itemCompleto
      ? {
          seqccs: itemCompleto.seqccs,
          servico: itemCompleto.codser,
          precoUnitario: Number(itemCompleto.preuni),
          quantidade: numero(itemCompleto.qtdccs),
          // Retenções só informativas: o custo do PJ é o valor bruto do contrato.
          retencoes: { iss: numero(itemCompleto.periss), irrf: numero(itemCompleto.perirf), inss: numero(itemCompleto.perins), pis: numero(itemCompleto.perpit), csll: numero(itemCompleto.percsl), cofins: numero(itemCompleto.percrt), outras: numero(itemCompleto.perour) },
        }
      : null,
    vigencias: linha.vigencias,
    divergencia: linha.divergencia,
    reajustes: dados.reajustes
      .filter((r) => r.numctr === contrato.numctr && r.seqccs === (item?.seqccs ?? -1))
      .map((r) => ({ data: dia(r.ultrea), valorAnterior: numero(r.vlratu) != null && numero(r.vlrrea) != null ? Number(r.vlratu) - Number(r.vlrrea) : null, valorNovo: numero(r.vlratu), aumento: numero(r.vlrrea), percentual: numero(r.perrea), descricao: r.desrea })),
  };
}

consultoresVinculosRouter.get("/:codemp/:codusu/valor-hora", async (req, res) => {
  try {
    const chave = lerChaveConsultor(req);
    if (!chave) {
      res.status(400).json({ error: "codemp e codusu são obrigatórios" });
      return;
    }
    res.json(await historicoValorHoraDoConsultor(chave));
  } catch (error) {
    handleError(res, error, "valor-hora");
  }
});
