import { NextFunction, Response, Router } from "express";
import { Prisma } from "@prisma/client";
import { AuthenticatedRequest, requireAuth } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EventoAuditoriaTipo } from "../audit/taxonomia";
import { entidadeIdMetaComercialAno, entidadeIdMetaComercialIndicador } from "../audit/identidadeEntidade";
import { consultoresDosDepartamentos, nomeConsultor } from "../domain/contextoProjeto";
import { faturamentoMensal } from "../domain/faturamentoItens";
import { DEPEXE_COMERCIAL } from "../domain/propostasDominio";
import { podeGerirMetasComercial } from "../domain/metasComercial/acesso";
import { Acumulacao, mesesDoPeriodo, PESOS_PADRAO, validarPesos } from "../domain/metasComercial/calculo";
import { montarPainel, Painel } from "../domain/metasComercial/painel";

// Gestão de Metas do Comercial (menu Comercial › Gestão de Metas). Acesso: admin e gestor do departamento Comercial (depexe 2), via
// DepartamentoGestor — não é papel. Em sincronia com RequireGestorOuAdmin depexe={DEPEXE_COMERCIAL} em App.tsx e o item do Sidebar.
export const metasComercialRouter = Router();

async function exigirAdminOuGestorComercial(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!(await podeGerirMetasComercial(req.user!.userId, req.user!.role))) {
      res.status(403).json({ error: "Sem permissão para acessar este recurso" });
      return;
    }
    next();
  } catch (error) {
    handleError(res, error, "acesso");
  }
}

metasComercialRouter.use(requireAuth, exigirAdminOuGestorComercial);

function handleError(res: Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[metas-comercial:${label}]`, message);
  res.status(500).json({ error: message });
}

// ---------------------------------------------------------------- utilitários

const LIMITE_VALOR = 1e12;
const UNIDADES = ["BRL", "HORAS", "QTD"];
const ACUMULACOES: Acumulacao[] = ["SOMA", "SALDO"];

/** undefined = campo ausente (não mexer); null = limpar; NaN = inválido. */
function numeroOpcional(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= LIMITE_VALOR ? v : NaN;
}

const textoOpcional = (v: unknown, max: number): string | null | undefined | false => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return false;
  const t = v.trim();
  return t.length > max ? false : t === "" ? null : t;
};

function anoDoParametro(v: string): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
}

const idDoParametro = (v: string) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const dec = (d: Prisma.Decimal | null) => (d == null ? null : Number(d));

function auditar(
  tx: Prisma.TransactionClient,
  req: AuthenticatedRequest,
  alvo: { id: string; rotulo: string },
  eventoTipo: EventoAuditoriaTipo,
  metadata: Record<string, unknown> | null = null
) {
  return criarEventoAuditoria(
    {
      origem: "tela",
      usuarioId: req.user!.userId,
      entidadeTipo: ENTIDADES_AUDITORIA.META_COMERCIAL,
      entidadeId: alvo.id,
      entidadeRotulo: alvo.rotulo,
      eventoTipo,
      metadata,
      correlationId: req.correlationId!,
    },
    tx
  );
}

const rotuloAno = (ano: number) => `Metas do Comercial ${ano}`;

// ---------------------------------------------------------------- indicadores

async function indicadoresComUso() {
  const [lista, emEmpresa, emPessoas, emLanc] = await Promise.all([
    prisma.metaComercialIndicador.findMany({ orderBy: [{ ordem: "asc" }, { id: "asc" }] }),
    prisma.metaComercialEmpresa.groupBy({ by: ["indicadorId"] }),
    prisma.metaComercialParticipanteIndicador.groupBy({ by: ["indicadorId"] }),
    prisma.metaComercialLancamento.groupBy({ by: ["indicadorId"] }),
  ]);
  const usados = new Set([...emEmpresa, ...emPessoas, ...emLanc].map((x) => x.indicadorId));
  return lista.map((i) => ({
    id: i.id,
    codigo: i.codigo,
    nome: i.nome,
    unidade: i.unidade,
    acumulacao: i.acumulacao as Acumulacao,
    origem: i.origem,
    ordem: i.ordem,
    ativo: i.ativo,
    emUso: usados.has(i.id),
  }));
}

metasComercialRouter.get("/indicadores", async (_req, res) => {
  try {
    res.json({ indicadores: await indicadoresComUso() });
  } catch (error) {
    handleError(res, error, "indicadores");
  }
});

const slugCodigo = (nome: string) =>
  nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36) || "INDICADOR";

metasComercialRouter.post("/indicadores", async (req: AuthenticatedRequest, res) => {
  try {
    const nome = typeof req.body?.nome === "string" ? req.body.nome.trim() : "";
    const unidade = String(req.body?.unidade ?? "");
    const acumulacao = String(req.body?.acumulacao ?? "SOMA") as Acumulacao;
    if (!nome || nome.length > 80) {
      res.status(400).json({ error: "Informe o nome do indicador (até 80 caracteres)" });
      return;
    }
    if (!UNIDADES.includes(unidade)) {
      res.status(400).json({ error: "Unidade inválida (BRL, HORAS ou QTD)" });
      return;
    }
    if (!ACUMULACOES.includes(acumulacao)) {
      res.status(400).json({ error: "Acumulação inválida (SOMA ou SALDO)" });
      return;
    }
    if (await prisma.metaComercialIndicador.findFirst({ where: { nome: { equals: nome, mode: "insensitive" } } })) {
      res.status(409).json({ error: "Já existe um indicador com este nome" });
      return;
    }
    const base = slugCodigo(nome);
    let codigo = base;
    for (let n = 2; await prisma.metaComercialIndicador.findUnique({ where: { codigo } }); n++) codigo = `${base}_${n}`;
    const maxOrdem = await prisma.metaComercialIndicador.aggregate({ _max: { ordem: true } });
    const criado = await prisma.$transaction(async (tx) => {
      const novo = await tx.metaComercialIndicador.create({ data: { codigo, nome, unidade, acumulacao, origem: "MANUAL", ordem: (maxOrdem._max.ordem ?? 0) + 1 } });
      await auditar(tx, req, { id: entidadeIdMetaComercialIndicador(novo.id), rotulo: `Indicador ${nome}` }, "META_COMERCIAL_INDICADOR_CRIADO", { codigo, unidade, acumulacao });
      return novo;
    });
    res.status(201).json({ id: criado.id });
  } catch (error) {
    handleError(res, error, "indicador-criar");
  }
});

metasComercialRouter.put("/indicadores/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDoParametro(req.params.id);
    const atual = id == null ? null : await prisma.metaComercialIndicador.findUnique({ where: { id } });
    if (!atual) {
      res.status(404).json({ error: "Indicador não encontrado" });
      return;
    }
    const emUso = (await indicadoresComUso()).find((i) => i.id === atual.id)?.emUso ?? false;
    const data: Prisma.MetaComercialIndicadorUpdateInput = {};
    if (req.body?.nome !== undefined) {
      const nome = typeof req.body.nome === "string" ? req.body.nome.trim() : "";
      if (!nome || nome.length > 80) {
        res.status(400).json({ error: "Informe o nome do indicador (até 80 caracteres)" });
        return;
      }
      const igual = await prisma.metaComercialIndicador.findFirst({ where: { nome: { equals: nome, mode: "insensitive" }, id: { not: atual.id } } });
      if (igual) {
        res.status(409).json({ error: "Já existe um indicador com este nome" });
        return;
      }
      data.nome = nome;
    }
    if (req.body?.ativo !== undefined) {
      if (typeof req.body.ativo !== "boolean") {
        res.status(400).json({ error: "Campo 'ativo' inválido" });
        return;
      }
      data.ativo = req.body.ativo;
    }
    if (req.body?.ordem !== undefined) {
      if (!Number.isInteger(req.body.ordem)) {
        res.status(400).json({ error: "Campo 'ordem' inválido" });
        return;
      }
      data.ordem = req.body.ordem;
    }
    // Unidade e acumulação mudam o significado dos números já lançados: só enquanto o indicador não foi usado.
    for (const campo of ["unidade", "acumulacao"] as const) {
      if (req.body?.[campo] === undefined || req.body[campo] === atual[campo]) continue;
      const lista = campo === "unidade" ? UNIDADES : ACUMULACOES;
      if (!lista.includes(req.body[campo])) {
        res.status(400).json({ error: `Campo '${campo}' inválido` });
        return;
      }
      if (emUso || atual.origem !== "MANUAL") {
        res.status(409).json({ error: `Não dá para mudar ${campo === "unidade" ? "a unidade" : "a acumulação"} de um indicador que já tem metas ou lançamentos` });
        return;
      }
      data[campo] = req.body[campo];
    }
    if (Object.keys(data).length === 0) {
      res.json({ ok: true });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.metaComercialIndicador.update({ where: { id: atual.id }, data });
      await auditar(tx, req, { id: entidadeIdMetaComercialIndicador(atual.id), rotulo: `Indicador ${atual.nome}` }, "META_COMERCIAL_INDICADOR_ALTERADO", { alterado: Object.keys(data) });
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "indicador-alterar");
  }
});

// ---------------------------------------------------------------- anos (planejamento)

type AnoCompleto = Prisma.MetaComercialAnoGetPayload<{ include: { empresa: true; participantes: { include: { indicadores: true } } } }>;

const INCLUDE_ANO = { empresa: true, participantes: { include: { indicadores: true }, orderBy: [{ ordem: "asc" as const }, { id: "asc" as const }] } };

function anoDto(a: AnoCompleto) {
  return {
    ano: a.ano,
    pesosMensais: a.pesosMensais.map(Number),
    observacao: a.observacao,
    empresa: a.empresa.map((e) => ({ indicadorId: e.indicadorId, metaAnual: Number(e.metaAnual) })),
    participantes: a.participantes.map((p) => ({
      id: p.id,
      codfor: p.codfor,
      nome: p.nome,
      funcao: p.funcao,
      naoAtribuido: p.naoAtribuido,
      ordem: p.ordem,
      ativo: p.ativo,
      indicadores: [...p.indicadores].sort((x, y) => x.ordem - y.ordem).map((i) => ({ indicadorId: i.indicadorId, rotulo: i.rotulo, ordem: i.ordem })),
    })),
  };
}

metasComercialRouter.get("/anos", async (_req, res) => {
  try {
    const anos = await prisma.metaComercialAno.findMany({ orderBy: { ano: "desc" }, include: { _count: { select: { participantes: true } } } });
    res.json({ anos: anos.map((a) => ({ ano: a.ano, participantes: Math.max(0, a._count.participantes - 1) })) });
  } catch (error) {
    handleError(res, error, "anos");
  }
});

metasComercialRouter.post("/anos", async (req: AuthenticatedRequest, res) => {
  try {
    const ano = typeof req.body?.ano === "number" && Number.isInteger(req.body.ano) && req.body.ano >= 2000 && req.body.ano <= 2100 ? req.body.ano : null;
    if (ano == null) {
      res.status(400).json({ error: "Ano inválido" });
      return;
    }
    if (await prisma.metaComercialAno.findUnique({ where: { ano } })) {
      res.status(409).json({ error: `Já existem metas cadastradas para ${ano}` });
      return;
    }
    const copiarDe = req.body?.copiarDe == null ? null : Number(req.body.copiarDe);
    const origem = copiarDe == null ? null : await prisma.metaComercialAno.findUnique({ where: { ano: copiarDe }, include: INCLUDE_ANO });
    if (copiarDe != null && !origem) {
      res.status(400).json({ error: `Não há metas de ${copiarDe} para copiar` });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.metaComercialAno.create({
        data: { ano, pesosMensais: origem ? origem.pesosMensais : PESOS_PADRAO, criadoPor: req.user!.userId },
      });
      if (origem) {
        await tx.metaComercialEmpresa.createMany({ data: origem.empresa.map((e) => ({ ano, indicadorId: e.indicadorId, metaAnual: e.metaAnual })) });
      }
      // A linha "Não atribuído" existe em todo ano; as demais pessoas vêm da cópia (sem lançamentos).
      const fonte = origem?.participantes ?? [];
      const naoAtribuido = fonte.find((p) => p.naoAtribuido);
      await tx.metaComercialParticipante.create({
        data: {
          ano,
          codfor: null,
          nome: "Não atribuído",
          naoAtribuido: true,
          ordem: 999,
          indicadores: { create: (naoAtribuido?.indicadores ?? []).map((i) => ({ indicadorId: i.indicadorId, rotulo: i.rotulo, ordem: i.ordem })) },
        },
      });
      for (const p of fonte.filter((x) => !x.naoAtribuido)) {
        await tx.metaComercialParticipante.create({
          data: {
            ano,
            codfor: p.codfor,
            nome: p.nome,
            funcao: p.funcao,
            ordem: p.ordem,
            ativo: p.ativo,
            indicadores: { create: p.indicadores.map((i) => ({ indicadorId: i.indicadorId, rotulo: i.rotulo, ordem: i.ordem })) },
          },
        });
      }
      await auditar(tx, req, { id: entidadeIdMetaComercialAno(ano), rotulo: rotuloAno(ano) }, "META_COMERCIAL_ANO_CRIADO", { copiadoDe: origem?.ano ?? null });
    });
    res.status(201).json({ ano });
  } catch (error) {
    handleError(res, error, "ano-criar");
  }
});

metasComercialRouter.get("/anos/:ano", async (req, res) => {
  try {
    const ano = anoDoParametro(req.params.ano);
    const a = ano == null ? null : await prisma.metaComercialAno.findUnique({ where: { ano }, include: INCLUDE_ANO });
    if (!a) {
      res.status(404).json({ error: "Ano não encontrado" });
      return;
    }
    // Meta do faturamento no Senior (USU_TMetaAnual, só leitura) como referência ao digitar a meta da empresa.
    const metasSenior = await prisma.metaAnual.findMany({ where: { anomet: a.ano } });
    res.json({
      ...anoDto(a),
      referenciaSenior: metasSenior.length > 0 ? { metaAnualFaturamento: metasSenior.reduce((s, m) => s + Number(m.vlrmet), 0), crescimentoEsperado: Number(metasSenior[0].percre) } : null,
    });
  } catch (error) {
    handleError(res, error, "ano");
  }
});

metasComercialRouter.put("/anos/:ano", async (req: AuthenticatedRequest, res) => {
  try {
    const ano = anoDoParametro(req.params.ano);
    const atual = ano == null ? null : await prisma.metaComercialAno.findUnique({ where: { ano }, include: { empresa: true } });
    if (!atual) {
      res.status(404).json({ error: "Ano não encontrado" });
      return;
    }
    const erroPesos = validarPesos(req.body?.pesosMensais);
    if (erroPesos) {
      res.status(400).json({ error: erroPesos });
      return;
    }
    const observacao = textoOpcional(req.body?.observacao, 500);
    if (observacao === false) {
      res.status(400).json({ error: "Observação inválida (até 500 caracteres)" });
      return;
    }
    const empresa: Array<{ indicadorId: number; metaAnual: number }> = [];
    for (const e of Array.isArray(req.body?.empresa) ? req.body.empresa : []) {
      const metaAnual = numeroOpcional(e?.metaAnual);
      if (!Number.isInteger(e?.indicadorId) || typeof metaAnual !== "number" || Number.isNaN(metaAnual)) {
        res.status(400).json({ error: "Meta da empresa inválida: informe indicador e um valor não negativo" });
        return;
      }
      if (empresa.some((x) => x.indicadorId === e.indicadorId)) {
        res.status(400).json({ error: "Indicador repetido nas metas da empresa" });
        return;
      }
      empresa.push({ indicadorId: e.indicadorId, metaAnual });
    }
    const existentes = await prisma.metaComercialIndicador.findMany({ where: { id: { in: empresa.map((e) => e.indicadorId) } }, select: { id: true, nome: true } });
    if (existentes.length !== empresa.length) {
      res.status(400).json({ error: "Há indicador inexistente nas metas da empresa" });
      return;
    }
    const nomeDe = new Map(existentes.map((i) => [i.id, i.nome]));
    const antes = new Map(atual.empresa.map((e) => [e.indicadorId, Number(e.metaAnual)]));
    const mudancas: Array<{ indicador: string; de: number | null; para: number | null }> = [];
    for (const e of empresa) if (antes.get(e.indicadorId) !== e.metaAnual) mudancas.push({ indicador: nomeDe.get(e.indicadorId)!, de: antes.get(e.indicadorId) ?? null, para: e.metaAnual });
    const removidos = atual.empresa.filter((e) => !empresa.some((x) => x.indicadorId === e.indicadorId));
    if (removidos.length > 0) {
      const nomes = await prisma.metaComercialIndicador.findMany({ where: { id: { in: removidos.map((r) => r.indicadorId) } }, select: { id: true, nome: true } });
      for (const r of removidos) mudancas.push({ indicador: nomes.find((n) => n.id === r.indicadorId)?.nome ?? String(r.indicadorId), de: Number(r.metaAnual), para: null });
    }
    const pesosAntes = atual.pesosMensais.map(Number);
    const pesosAlterados = pesosAntes.some((p, i) => Math.abs(p - req.body.pesosMensais[i]) > 1e-9);
    await prisma.$transaction(async (tx) => {
      await tx.metaComercialAno.update({
        where: { ano: atual.ano },
        data: { pesosMensais: req.body.pesosMensais, observacao: observacao ?? null, atualizadoPor: req.user!.userId, atualizadoEm: new Date() },
      });
      await tx.metaComercialEmpresa.deleteMany({ where: { ano: atual.ano } });
      if (empresa.length > 0) await tx.metaComercialEmpresa.createMany({ data: empresa.map((e) => ({ ano: atual.ano, indicadorId: e.indicadorId, metaAnual: e.metaAnual })) });
      if (pesosAlterados || mudancas.length > 0) {
        await auditar(tx, req, { id: entidadeIdMetaComercialAno(atual.ano), rotulo: rotuloAno(atual.ano) }, "META_COMERCIAL_PLANEJAMENTO_ALTERADO", { pesosAlterados, metasDaEmpresa: mudancas });
      }
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "ano-alterar");
  }
});

// ---------------------------------------------------------------- participantes

metasComercialRouter.get("/elegiveis", async (_req, res) => {
  try {
    const time = await consultoresDosDepartamentos([DEPEXE_COMERCIAL]);
    const lista = time.filter((c) => c.codfor != null).map((c) => ({ codfor: c.codfor as number, nome: nomeConsultor(c) }));
    res.json({ elegiveis: lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) });
  } catch (error) {
    handleError(res, error, "elegiveis");
  }
});

interface IndicadorDaPessoa {
  indicadorId: number;
  rotulo: string | null;
}

/** Valida a lista [{ indicadorId, rotulo? }] do corpo. Devolve a lista limpa ou a mensagem de erro. */
async function lerIndicadoresDaPessoa(bruto: unknown): Promise<{ itens: IndicadorDaPessoa[] } | { erro: string }> {
  if (!Array.isArray(bruto)) return { erro: "Informe os indicadores da pessoa" };
  const itens: IndicadorDaPessoa[] = [];
  for (const b of bruto) {
    const rotulo = textoOpcional(b?.rotulo, 80);
    if (!Number.isInteger(b?.indicadorId) || rotulo === false) return { erro: "Indicador da pessoa inválido" };
    if (itens.some((i) => i.indicadorId === b.indicadorId)) return { erro: "Indicador repetido na mesma pessoa" };
    itens.push({ indicadorId: b.indicadorId, rotulo: rotulo ?? null });
  }
  const existentes = await prisma.metaComercialIndicador.count({ where: { id: { in: itens.map((i) => i.indicadorId) } } });
  if (existentes !== itens.length) return { erro: "Há indicador inexistente na lista da pessoa" };
  return { itens };
}

metasComercialRouter.post("/anos/:ano/participantes", async (req: AuthenticatedRequest, res) => {
  try {
    const ano = anoDoParametro(req.params.ano);
    if (ano == null || !(await prisma.metaComercialAno.findUnique({ where: { ano } }))) {
      res.status(404).json({ error: "Ano não encontrado" });
      return;
    }
    const codfor = req.body?.codfor;
    const time = await consultoresDosDepartamentos([DEPEXE_COMERCIAL]);
    const consultor = Number.isInteger(codfor) ? time.find((c) => c.codfor === codfor) : undefined;
    if (!consultor) {
      res.status(400).json({ error: "Escolha uma pessoa do time do Comercial" });
      return;
    }
    if (await prisma.metaComercialParticipante.findUnique({ where: { ano_codfor: { ano, codfor } } })) {
      res.status(409).json({ error: "Esta pessoa já está nas metas deste ano" });
      return;
    }
    const funcao = textoOpcional(req.body?.funcao, 60);
    if (funcao === false) {
      res.status(400).json({ error: "Função inválida (até 60 caracteres)" });
      return;
    }
    const lidos = await lerIndicadoresDaPessoa(req.body?.indicadores ?? []);
    if ("erro" in lidos) {
      res.status(400).json({ error: lidos.erro });
      return;
    }
    const maxOrdem = await prisma.metaComercialParticipante.aggregate({ where: { ano, naoAtribuido: false }, _max: { ordem: true } });
    const nome = nomeConsultor(consultor);
    const criado = await prisma.$transaction(async (tx) => {
      const p = await tx.metaComercialParticipante.create({
        data: { ano, codfor, nome, funcao: funcao ?? null, ordem: (maxOrdem._max.ordem ?? 0) + 1, indicadores: { create: lidos.itens.map((i, ordem) => ({ ...i, ordem })) } },
      });
      await auditar(tx, req, { id: entidadeIdMetaComercialAno(ano), rotulo: rotuloAno(ano) }, "META_COMERCIAL_PLANEJAMENTO_ALTERADO", { participanteIncluido: nome });
      return p;
    });
    res.status(201).json({ id: criado.id });
  } catch (error) {
    handleError(res, error, "participante-criar");
  }
});

async function carregarParticipante(req: AuthenticatedRequest, res: Response) {
  const ano = anoDoParametro(req.params.ano);
  const id = idDoParametro(req.params.id);
  const p = ano == null || id == null ? null : await prisma.metaComercialParticipante.findFirst({ where: { id, ano }, include: { indicadores: true } });
  if (!p) res.status(404).json({ error: "Participante não encontrado" });
  return p;
}

metasComercialRouter.put("/anos/:ano/participantes/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const p = await carregarParticipante(req, res);
    if (!p) return;
    const data: Prisma.MetaComercialParticipanteUpdateInput = {};
    const funcao = textoOpcional(req.body?.funcao, 60);
    if (funcao === false) {
      res.status(400).json({ error: "Função inválida (até 60 caracteres)" });
      return;
    }
    if (funcao !== undefined) data.funcao = funcao;
    if (req.body?.ativo !== undefined) {
      if (typeof req.body.ativo !== "boolean" || (p.naoAtribuido && !req.body.ativo)) {
        res.status(400).json({ error: "Campo 'ativo' inválido" });
        return;
      }
      data.ativo = req.body.ativo;
    }
    if (req.body?.ordem !== undefined) {
      if (!Number.isInteger(req.body.ordem)) {
        res.status(400).json({ error: "Campo 'ordem' inválido" });
        return;
      }
      data.ordem = req.body.ordem;
    }
    let novos: IndicadorDaPessoa[] | null = null;
    if (req.body?.indicadores !== undefined) {
      const lidos = await lerIndicadoresDaPessoa(req.body.indicadores);
      if ("erro" in lidos) {
        res.status(400).json({ error: lidos.erro });
        return;
      }
      novos = lidos.itens;
      // Tirar um indicador que tem lançamentos apagaria histórico: só se estiver vazio.
      const tirados = p.indicadores.filter((i) => !novos!.some((n) => n.indicadorId === i.indicadorId)).map((i) => i.indicadorId);
      if (tirados.length > 0) {
        const comLanc = await prisma.metaComercialLancamento.findFirst({ where: { participanteId: p.id, indicadorId: { in: tirados } }, include: { indicador: true } });
        if (comLanc) {
          res.status(409).json({ error: `${comLanc.indicador.nome} já tem lançamentos de ${p.nome}; limpe os valores antes de tirar o indicador` });
          return;
        }
      }
    }
    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) await tx.metaComercialParticipante.update({ where: { id: p.id }, data });
      if (novos) {
        await tx.metaComercialParticipanteIndicador.deleteMany({ where: { participanteId: p.id, indicadorId: { notIn: novos.map((n) => n.indicadorId) } } });
        for (const [ordem, n] of novos.entries()) {
          await tx.metaComercialParticipanteIndicador.upsert({
            where: { participanteId_indicadorId: { participanteId: p.id, indicadorId: n.indicadorId } },
            create: { participanteId: p.id, indicadorId: n.indicadorId, rotulo: n.rotulo, ordem },
            update: { rotulo: n.rotulo, ordem },
          });
        }
      }
      await auditar(tx, req, { id: entidadeIdMetaComercialAno(p.ano), rotulo: rotuloAno(p.ano) }, "META_COMERCIAL_PLANEJAMENTO_ALTERADO", {
        participanteAlterado: p.nome,
        campos: [...Object.keys(data), ...(novos ? ["indicadores"] : [])],
      });
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "participante-alterar");
  }
});

metasComercialRouter.delete("/anos/:ano/participantes/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const p = await carregarParticipante(req, res);
    if (!p) return;
    if (p.naoAtribuido) {
      res.status(400).json({ error: "A linha 'Não atribuído' não pode ser excluída" });
      return;
    }
    if (await prisma.metaComercialLancamento.findFirst({ where: { participanteId: p.id } })) {
      res.status(409).json({ error: `${p.nome} já tem lançamentos; desative em vez de excluir` });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.metaComercialParticipante.delete({ where: { id: p.id } });
      await auditar(tx, req, { id: entidadeIdMetaComercialAno(p.ano), rotulo: rotuloAno(p.ano) }, "META_COMERCIAL_PLANEJAMENTO_ALTERADO", { participanteRemovido: p.nome });
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "participante-excluir");
  }
});

// ---------------------------------------------------------------- lançamentos

async function faturamentoDoAno(ano: number): Promise<number[]> {
  const meses = new Array<number>(12).fill(0);
  for (const l of await faturamentoMensal(ano, ano)) if (l.ano === ano) meses[l.mes - 1] = l.valor;
  return meses;
}

metasComercialRouter.get("/anos/:ano/lancamentos", async (req, res) => {
  try {
    const ano = anoDoParametro(req.params.ano);
    if (ano == null || !(await prisma.metaComercialAno.findUnique({ where: { ano } }))) {
      res.status(404).json({ error: "Ano não encontrado" });
      return;
    }
    const [lancs, fat] = await Promise.all([prisma.metaComercialLancamento.findMany({ where: { participante: { ano } } }), faturamentoDoAno(ano)]);
    res.json({
      lancamentos: lancs.map((l) => ({ participanteId: l.participanteId, indicadorId: l.indicadorId, mes: l.mes, meta: dec(l.meta), realizado: dec(l.realizado), observacao: l.observacao })),
      faturamentoSenior: fat,
    });
  } catch (error) {
    handleError(res, error, "lancamentos");
  }
});

const LIMITE_LOTE = 2000;

metasComercialRouter.put("/anos/:ano/lancamentos", async (req: AuthenticatedRequest, res) => {
  try {
    const ano = anoDoParametro(req.params.ano);
    if (ano == null || !(await prisma.metaComercialAno.findUnique({ where: { ano } }))) {
      res.status(404).json({ error: "Ano não encontrado" });
      return;
    }
    const itens: unknown[] = Array.isArray(req.body?.itens) ? req.body.itens : [];
    if (itens.length === 0 || itens.length > LIMITE_LOTE) {
      res.status(400).json({ error: `Envie de 1 a ${LIMITE_LOTE} lançamentos por vez` });
      return;
    }
    const [participantes, indicadores] = await Promise.all([
      prisma.metaComercialParticipante.findMany({ where: { ano }, include: { indicadores: true } }),
      prisma.metaComercialIndicador.findMany(),
    ]);
    const parts = new Map(participantes.map((p) => [p.id, p]));
    const inds = new Map(indicadores.map((i) => [i.id, i]));

    interface Pronto {
      participanteId: number;
      indicadorId: number;
      mes: number;
      meta: number | null | undefined;
      realizado: number | null | undefined;
      observacao: string | null | undefined;
    }
    const prontos: Pronto[] = [];
    const vistos = new Set<string>();
    for (const bruto of itens) {
      const b = (bruto ?? {}) as Record<string, unknown>;
      const p = typeof b.participanteId === "number" ? parts.get(b.participanteId) : undefined;
      const ind = typeof b.indicadorId === "number" ? inds.get(b.indicadorId) : undefined;
      const mes = b.mes;
      if (!p || !ind || typeof mes !== "number" || !Number.isInteger(mes) || mes < 1 || mes > 12) {
        res.status(400).json({ error: "Lançamento inválido: pessoa, indicador ou mês fora das metas do ano" });
        return;
      }
      if (!p.indicadores.some((i) => i.indicadorId === ind.id)) {
        res.status(400).json({ error: `${ind.nome} não está entre os indicadores de ${p.nome}` });
        return;
      }
      const chave = `${p.id}:${ind.id}:${mes}`;
      if (vistos.has(chave)) {
        res.status(400).json({ error: `Lançamento repetido para ${p.nome} / ${ind.nome} / mês ${mes}` });
        return;
      }
      vistos.add(chave);
      const meta = numeroOpcional(b.meta);
      const realizado = numeroOpcional(b.realizado);
      const observacao = textoOpcional(b.observacao, 300);
      if (Number.isNaN(meta) || Number.isNaN(realizado) || observacao === false) {
        res.status(400).json({ error: `Valor inválido em ${p.nome} / ${ind.nome} / mês ${mes}: use números não negativos e observação de até 300 caracteres` });
        return;
      }
      if (realizado != null && ind.origem === "FATURAMENTO_SENIOR") {
        res.status(400).json({ error: `${ind.nome} vem do Senior e não pode ser digitado` });
        return;
      }
      prontos.push({ participanteId: p.id, indicadorId: ind.id, mes, meta, realizado, observacao });
    }

    const existentes = await prisma.metaComercialLancamento.findMany({ where: { participanteId: { in: [...new Set(prontos.map((x) => x.participanteId))] } } });
    const atual = new Map(existentes.map((l) => [`${l.participanteId}:${l.indicadorId}:${l.mes}`, l]));
    const alteracoes: Array<Record<string, unknown>> = [];
    let gravados = 0;
    await prisma.$transaction(
      async (tx) => {
        for (const x of prontos) {
          const antes = atual.get(`${x.participanteId}:${x.indicadorId}:${x.mes}`);
          const meta = x.meta === undefined ? dec(antes?.meta ?? null) : x.meta;
          const realizado = x.realizado === undefined ? dec(antes?.realizado ?? null) : x.realizado;
          const observacao = x.observacao === undefined ? (antes?.observacao ?? null) : x.observacao;
          const mudouMeta = meta !== dec(antes?.meta ?? null);
          const mudouReal = realizado !== dec(antes?.realizado ?? null);
          const mudouObs = observacao !== (antes?.observacao ?? null);
          if (!mudouMeta && !mudouReal && !mudouObs) continue;
          gravados++;
          if (meta == null && realizado == null && observacao == null) {
            if (antes) await tx.metaComercialLancamento.delete({ where: { id: antes.id } });
          } else {
            await tx.metaComercialLancamento.upsert({
              where: { participanteId_indicadorId_mes: { participanteId: x.participanteId, indicadorId: x.indicadorId, mes: x.mes } },
              create: { participanteId: x.participanteId, indicadorId: x.indicadorId, mes: x.mes, meta, realizado, observacao, lancadoPor: req.user!.userId },
              update: { meta, realizado, observacao, lancadoPor: req.user!.userId, lancadoEm: new Date() },
            });
          }
          if (alteracoes.length < 60) {
            alteracoes.push({
              pessoa: parts.get(x.participanteId)!.nome,
              indicador: inds.get(x.indicadorId)!.nome,
              mes: x.mes,
              ...(mudouMeta ? { meta: { de: dec(antes?.meta ?? null), para: meta } } : {}),
              ...(mudouReal ? { realizado: { de: dec(antes?.realizado ?? null), para: realizado } } : {}),
              ...(mudouObs ? { observacao: true } : {}),
            });
          }
        }
        if (gravados > 0) {
          await auditar(tx, req, { id: entidadeIdMetaComercialAno(ano), rotulo: rotuloAno(ano) }, "META_COMERCIAL_LANCAMENTO", { gravados, alteracoes, truncado: gravados > alteracoes.length });
        }
      },
      { timeout: 30000 }
    );
    res.json({ gravados });
  } catch (error) {
    handleError(res, error, "lancamentos-gravar");
  }
});

// ---------------------------------------------------------------- painel

async function montarPainelDoAno(ano: number, periodo: string): Promise<{ painel: Painel } | { erro: string; status: number }> {
  const meses = mesesDoPeriodo(periodo);
  if (!meses) return { erro: "Período inválido (ano, s1, s2, t1..t4, mes-N ou ate-N)", status: 400 };
  const a = await prisma.metaComercialAno.findUnique({ where: { ano }, include: INCLUDE_ANO });
  if (!a) return { erro: "Ano não encontrado", status: 404 };
  const [indicadores, lancs, fat] = await Promise.all([
    prisma.metaComercialIndicador.findMany(),
    prisma.metaComercialLancamento.findMany({ where: { participante: { ano } } }),
    faturamentoDoAno(ano),
  ]);
  const painel = montarPainel({
    ano,
    periodo,
    meses,
    pesos: a.pesosMensais.map(Number),
    indicadores: indicadores.map((i) => ({ id: i.id, codigo: i.codigo, nome: i.nome, unidade: i.unidade, acumulacao: i.acumulacao as Acumulacao, origem: i.origem, ordem: i.ordem })),
    metasEmpresa: new Map(a.empresa.map((e) => [e.indicadorId, Number(e.metaAnual)])),
    participantes: a.participantes
      .filter((p) => p.ativo)
      .map((p) => ({ id: p.id, nome: p.nome, funcao: p.funcao, naoAtribuido: p.naoAtribuido, ordem: p.ordem, indicadores: p.indicadores.map((i) => ({ indicadorId: i.indicadorId, rotulo: i.rotulo, ordem: i.ordem })) })),
    lancamentos: lancs.map((l) => ({ participanteId: l.participanteId, indicadorId: l.indicadorId, mes: l.mes, meta: dec(l.meta), realizado: dec(l.realizado) })),
    faturamentoMensal: fat,
  });
  return { painel };
}

metasComercialRouter.get("/anos/:ano/painel", async (req, res) => {
  try {
    const ano = anoDoParametro(req.params.ano);
    if (ano == null) {
      res.status(404).json({ error: "Ano não encontrado" });
      return;
    }
    const r = await montarPainelDoAno(ano, typeof req.query.periodo === "string" ? req.query.periodo : "ano");
    if ("erro" in r) {
      res.status(r.status).json({ error: r.erro });
      return;
    }
    res.json(r.painel);
  } catch (error) {
    handleError(res, error, "painel");
  }
});

const csvCampo = (v: unknown) => {
  const t = v == null ? "" : String(v);
  return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const csvNum = (n: number | null) => (n == null ? "" : n.toFixed(2).replace(".", ","));
const csvPct = (n: number | null) => (n == null ? "" : (n * 100).toFixed(2).replace(".", ","));

metasComercialRouter.get("/anos/:ano/painel.csv", async (req, res) => {
  try {
    const ano = anoDoParametro(req.params.ano);
    if (ano == null) {
      res.status(404).json({ error: "Ano não encontrado" });
      return;
    }
    const periodo = typeof req.query.periodo === "string" ? req.query.periodo : "ano";
    const r = await montarPainelDoAno(ano, periodo);
    if ("erro" in r) {
      res.status(r.status).json({ error: r.erro });
      return;
    }
    const linha = (escopo: string, pessoa: string, indicador: string, c: { meta: number; realizado: number; atingimento: number | null; saldo: number }) =>
      [escopo, pessoa, indicador, periodo, csvNum(c.meta), csvNum(c.realizado), csvPct(c.atingimento), csvNum(c.saldo)].map(csvCampo).join(";");
    const corpo: string[] = [];
    for (const i of r.painel.indicadores) corpo.push(linha("Empresa", "", i.nome, i.consolidado));
    for (const p of r.painel.pessoas) for (const i of p.indicadores) corpo.push(linha("Pessoa", p.nome, i.rotulo, i.consolidado));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="metas-comercial-${ano}-${periodo}.csv"`);
    // BOM + ponto e vírgula + vírgula decimal: abre direto no Excel em português.
    res.send(`﻿${["Escopo;Pessoa;Indicador;Periodo;Meta;Realizado;Atingimento %;Saldo (meta - realizado)", ...corpo].join("\r\n")}`);
  } catch (error) {
    handleError(res, error, "painel-csv");
  }
});
