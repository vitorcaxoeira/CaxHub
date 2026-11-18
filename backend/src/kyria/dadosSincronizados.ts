import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { pkFieldsDoModel } from "../sync/recorteRetroativo";
import { converterValorInterno, ErroValorInterno } from "./valorCampoInterno";
import { colunasDoJob, listarDadosDoJob, type ColunaDados as ColunaMotor, type ResultadoDados } from "../sync/dadosSincronizados";
import type { FiltroColuna } from "../sync/filtroColunaLocal";
import type { OrdemColuna } from "../sync/ordemColuna";
import type { KyriaSyncJobDescriptor } from "./registry";

// Consulta/edição dos dados JÁ SINCRONIZADOS (Administração > Integração Kyria > "Ver dados",
// 18/09/2026, pedido do Vitor) — diferente de tudo mais nesta pasta, isto GRAVA em cima de dado
// real, não é mais spec. Por isso o escopo do que pode ser editado é estrito: só campo marcado
// como interno (nomeOrigem null) e mantido (manter true) no KyriaFieldMapping registrado — nunca
// um campo que veio da API, esse só o job de sync escreve.
//
// Resolver local, mais largo que sync/recorteRetroativo.ts:delegatePorTabelaLocal — aquele não
// expõe `skip` nem `update` no tipo de retorno (só precisava de count/updateMany/findMany sem
// paginação pra varredura de removidos). Em vez de alargar um helper de um módulo
// conceitualmente "Fase 5 do plano de filtros do Senior" com capacidade que só a Kyria precisa,
// esta é uma versão própria pequena, mesma técnica de dmmf.
type Model = (typeof Prisma.dmmf.datamodel.models)[number];

function resolverModel(nome: string, porTabela: boolean): Model | null {
  return Prisma.dmmf.datamodel.models.find((m) => (porTabela ? m.dbName : m.name) === nome) ?? null;
}

function resolverDelegate(model: Model) {
  const nomeDelegate = model.name.charAt(0).toLowerCase() + model.name.slice(1);
  return (prisma as unknown as Record<string, any>)[nomeDelegate];
}

// Nome do campo Prisma (camelCase) a partir do nome da coluna Postgres — nomeInterno já é
// snake_case (a própria coluna), mas o `data` de um update do Prisma quer o nome do FIELD, que
// diverge quando há `@map` (ex.: KyriaTeam.parentTeamId tem nomeInterno "parent_team_id"). Mesma
// técnica de sync/catalogoCampos.ts:campoLocal (dbName ?? name).
function campoPrismaPorColuna(model: Model, coluna: string): string | null {
  return model.fields.find((f) => (f.dbName ?? f.name) === coluna)?.name ?? null;
}

// `JSON.stringify` (por trás de `res.json`) não sabe serializar `bigint` — estoura com "Do not
// know how to serialize a BigInt". Achado real (22/09/2026): o modal genérico de registro
// relacionado (`buscarRegistrosRelacionados` abaixo) quebrava inteiro ao abrir `Cliente` porque
// `cgccpf` é BigInt no schema. Vira string no transporte; não quebra a escrita de volta —
// `editarCampoInterno` manda esse valor pro Prisma em `data: { [campo]: valor }`, e o Prisma
// aceita string pra campo BigInt em write (coage sozinho), mesmo comportamento de hoje pra um
// campo Int vindo como string de um <select> HTML.
function paraJson(valor: unknown): unknown {
  return typeof valor === "bigint" ? valor.toString() : valor;
}

// `delegate.findMany(...)` devolve o objeto do Prisma chaveado pelo nome do CAMPO (camelCase:
// "statusKey"), mas `coluna.nomeInterno` é o nome da COLUNA Postgres (snake_case: "status_key",
// o que fica registrado no mapeamento e o que o frontend usa pra ler `linha[nomeInterno]`).
// Quando os dois nomes coincidem (campo sem `@map`) não dava pra notar, mas todo campo COM
// `@map` (a maioria de KyriaTicket, e já também parentTeamId/domainUrl/createdAt/updatedAt nos
// recursos mais antigos) ficava com "—" na tela, sem erro nenhum — achado real (22/09/2026,
// Vitor: "está mostrando somente alguns dados da tabela"). Reaproveita `campoPrismaPorColuna`
// (mesma tradução nomeInterno -> campo Prisma que `editarCampoInterno` já usa) pra montar um
// objeto novo, chaveado do jeito que a tela espera — e já sai seguro pra `res.json` (ver `paraJson`).
function remapearItens(itensBrutos: Record<string, unknown>[], colunas: ColunaDados[], model: Model): Record<string, unknown>[] {
  const camposPrisma = colunas.map((c) => ({ nomeInterno: c.nomeInterno, campoPrisma: campoPrismaPorColuna(model, c.nomeInterno) }));
  return itensBrutos.map((itemBruto) => {
    const remapeado: Record<string, unknown> = {};
    for (const { nomeInterno, campoPrisma } of camposPrisma) {
      remapeado[nomeInterno] = campoPrisma ? paraJson(itemBruto[campoPrisma]) : undefined;
    }
    return remapeado;
  });
}

function clampPagina(valor: unknown, min: number, max: number, padrao: number): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * Condição pra uma linha poder RECEBER vínculo num campo interno (rentabilidade, ajuste 03 de
 * 17/11/2026): só membro com papel `attendant` é relacionado a um consultor — solicitante, gestor
 * etc. não apontam hora e não entram no custo. Chaveada por `tabelaLocal.coluna`; a validação é do
 * backend (editarCampoInterno) e a tela só usa isto pra não oferecer "vincular" onde não vale.
 * Remover um vínculo já existente NUNCA é bloqueado (valor null).
 */
const RESTRICOES_VINCULO: Record<string, { coluna: string; valor: string; motivo: string }> = {
  "kyria_members.codusu": {
    coluna: "role",
    valor: "attendant",
    motivo: "Só membro com papel \"attendant\" (atendente) é vinculado a consultor.",
  },
};

export interface RestricaoVinculo {
  /** Campo Prisma da linha que precisa ter `valor` (a tela lê `linha[campo]`). */
  campo: string;
  valor: string;
  motivo: string;
}

export interface ColunaDados {
  nomeInterno: string;
  ehInterno: boolean;
  relacionamentoModelo: string | null;
  relacionamentoCampo: string | null;
  relacionamentoCampoDescricao: string | null;
}

/**
 * Coluna da tela "Ver dados": as do motor genérico do espelho (nome do campo Prisma, tipo, operadores
 * de filtro...) mais o que é do Kyria — o nome da COLUNA no Postgres (`rotulo`, snake_case, o que o
 * mapeamento registra e o que o admin reconhece) e, quando o mapeamento marca o campo como interno,
 * o relacionamento que permite vincular/trocar/remover o registro relacionado.
 */
export interface ColunaKyria extends ColunaMotor {
  rotulo: string;
  ehInterno: boolean;
  vinculoRestrito: RestricaoVinculo | null;
  relacionamentoModelo: string | null;
  relacionamentoCampo: string | null;
  relacionamentoCampoDescricao: string | null;
}

export interface ListaDadosKyria extends ResultadoDados {
  colunas: ColunaKyria[];
  // Por coluna (nome do campo) com relacionamentoCampoDescricao registrado: mapa "valor bruto" ->
  // rótulo legível ("123" -> "ACME LTDA"), resolvido em lote só pras linhas da página.
  descricoes: Record<string, Record<string, string>>;
}

/**
 * Colunas do espelho (todas as escalares do model, como no "Ver dados" do ERP) cruzadas com o
 * mapeamento registrado pra marcar quais são internas/editáveis. Sem mapeamento registrado, nenhuma
 * é interna — degrada com segurança (mostra o dado, não deixa editar sem saber o que é seguro).
 */
async function resolverColunas(job: KyriaSyncJobDescriptor, model: Model): Promise<ColunaKyria[]> {
  const recurso = await prisma.kyriaResourceMapping.findUnique({
    where: { resourcePath: job.path },
    include: { campos: { where: { manter: true } } },
  });
  const mapeadoPorColuna = new Map((recurso?.campos ?? []).map((c) => [c.nomeInterno, c]));

  return colunasDoJob(job).map((coluna) => {
    const rotulo = model.fields.find((f) => f.name === coluna.nome)?.dbName ?? coluna.nome;
    const mapeado = mapeadoPorColuna.get(rotulo);
    const restricao = RESTRICOES_VINCULO[`${job.tabelaLocal}.${rotulo}`];
    const campoCondicao = restricao ? campoPrismaPorColuna(model, restricao.coluna) : null;
    return {
      ...coluna,
      rotulo,
      ehInterno: mapeado ? mapeado.nomeOrigem === null : false,
      vinculoRestrito: restricao && campoCondicao ? { campo: campoCondicao, valor: restricao.valor, motivo: restricao.motivo } : null,
      relacionamentoModelo: mapeado?.relacionamentoModelo ?? null,
      relacionamentoCampo: mapeado?.relacionamentoCampo ?? null,
      relacionamentoCampoDescricao: mapeado?.relacionamentoCampoDescricao ?? null,
    };
  });
}

/**
 * Resolve em lote o rótulo legível de cada coluna com relacionamento+descrição registrados —
 * uma consulta por coluna (não por linha): junta os valores distintos da página, busca só
 * `relacionamentoCampo`+`relacionamentoCampoDescricao` da tabela relacionada com um `IN`, monta um
 * mapa "valor -> rótulo". Coluna sem relacionamentoCampoDescricao registrado nem entra no
 * resultado (tela mostra só o valor cru).
 */
async function resolverDescricoes(colunas: ColunaKyria[], itens: Record<string, unknown>[]): Promise<Record<string, Record<string, string>>> {
  const resultado: Record<string, Record<string, string>> = {};

  for (const coluna of colunas) {
    if (!coluna.ehInterno || !coluna.relacionamentoModelo || !coluna.relacionamentoCampo || !coluna.relacionamentoCampoDescricao) continue;

    const valores = [...new Set(itens.map((item) => item[coluna.nome]).filter((v) => v !== null && v !== undefined))];
    if (valores.length === 0) continue;

    const modelo = resolverModel(coluna.relacionamentoModelo, false);
    if (!modelo) continue;
    const delegate = resolverDelegate(modelo);

    const linhas = await delegate.findMany({
      where: { [coluna.relacionamentoCampo]: { in: valores } },
      select: { [coluna.relacionamentoCampo]: true, [coluna.relacionamentoCampoDescricao]: true },
    });

    const mapa: Record<string, string> = {};
    for (const linha of linhas) {
      const chave = String(linha[coluna.relacionamentoCampo as string]);
      const rotulo = linha[coluna.relacionamentoCampoDescricao as string];
      if (rotulo !== null && rotulo !== undefined) mapa[chave] = String(rotulo);
    }
    resultado[coluna.nome] = mapa;
  }

  return resultado;
}

/**
 * Linhas já sincronizadas da tabela do job, tudo no SERVIDOR (17/11/2026, pedido do Vitor: mesma
 * tela do "Ver dados" do ERP) — busca, filtro por coluna, ordem e paginação pelo motor genérico
 * (sync/dadosSincronizados.ts), que serve a qualquer tamanho de tabela. Antes a tela carregava a
 * tabela inteira; com kyria_time_entries (dezenas de milhares de linhas) isso deixou de caber.
 */
export async function listarDadosKyria(
  job: KyriaSyncJobDescriptor,
  opcoes: { page: number; pageSize: number; busca: string; filtros: FiltroColuna[]; ordem: OrdemColuna[] }
): Promise<ListaDadosKyria> {
  const model = resolverModel(job.tabelaLocal, true);
  if (!model) throw new Error(`Model Prisma não encontrado pra tabela local "${job.tabelaLocal}".`);

  const [resultado, colunas] = await Promise.all([listarDadosDoJob(job, opcoes), resolverColunas(job, model)]);
  const descricoes = await resolverDescricoes(colunas, resultado.itens);

  return { ...resultado, colunas, descricoes };
}

/**
 * Edita um campo INTERNO de uma linha já sincronizada — nunca um campo vindo da API (isso é
 * validado aqui, não confiado ao chamador). Quando o campo tem relacionamento registrado, o
 * valor só é aceito se corresponder a uma linha de verdade da tabela relacionada.
 */
export async function editarCampoInterno(job: KyriaSyncJobDescriptor, id: string, campo: string, valor: unknown): Promise<Record<string, unknown>> {
  const recurso = await prisma.kyriaResourceMapping.findUnique({
    where: { resourcePath: job.path },
    include: { campos: true },
  });
  const campoMapeado = recurso?.campos.find((c) => c.nomeInterno === campo);
  if (!recurso || !campoMapeado) throw new ErroValidacao(`Campo "${campo}" não está registrado no mapeamento de "${job.path}".`);
  if (campoMapeado.nomeOrigem !== null) throw new ErroValidacao(`Campo "${campo}" vem da API — só campo interno pode ser editado aqui.`);
  if (!campoMapeado.manter) throw new ErroValidacao(`Campo "${campo}" está marcado como "não manter" no mapeamento.`);

  // `valor === null` = REMOVER o vínculo (25/09/2026) ou LIMPAR o campo (18/11/2026, campo interno que não é vínculo, ex.: um Boolean): não há
  // registro relacionado pra conferir — o campo simplesmente volta a ficar vazio, e só se a coluna aceitar nulo (conferido mais abaixo).
  const ehRelacionamento = !!(campoMapeado.relacionamentoModelo && campoMapeado.relacionamentoCampo);
  if (valor !== null && campoMapeado.relacionamentoModelo && campoMapeado.relacionamentoCampo) {
    const modeloRelacionado = resolverModel(campoMapeado.relacionamentoModelo, false);
    if (!modeloRelacionado) throw new ErroValidacao(`Model relacionado "${campoMapeado.relacionamentoModelo}" não existe mais no schema.`);
    const delegateRelacionado = resolverDelegate(modeloRelacionado);
    const existe = await delegateRelacionado.findFirst({ where: { [campoMapeado.relacionamentoCampo]: valor } });
    if (!existe) {
      throw new ErroValidacao(`Nenhum registro de "${campoMapeado.relacionamentoModelo}" tem ${campoMapeado.relacionamentoCampo} = ${JSON.stringify(valor)}.`);
    }
  }

  const model = resolverModel(job.tabelaLocal, true);
  if (!model) throw new Error(`Model Prisma não encontrado pra tabela local "${job.tabelaLocal}".`);
  const campoPrisma = campoPrismaPorColuna(model, campo);
  if (!campoPrisma) throw new ErroValidacao(`Coluna "${campo}" não existe no model "${model.name}".`);
  if (valor === null && model.fields.find((f) => f.name === campoPrisma)?.isRequired) {
    throw new ErroValidacao(`Coluna "${campo}" é obrigatória — não dá pra remover o valor.`);
  }

  // A rota só manda UM `id` (um segmento de URL) — funciona pras tabelas Kyria de hoje, todas
  // com PK simples (`id: String @id`). Nenhuma tem PK composta ainda; se um dia tiver, isto
  // precisa de um `id` estruturado (ex.: "codemp:codusu") em vez do valor único assumido aqui.
  const pk = pkFieldsDoModel(job.tabelaLocal);
  if (pk.length !== 1) throw new Error(`"Ver dados" só suporta tabela com PK simples — "${job.tabelaLocal}" tem PK composta (${pk.join(", ")}).`);
  const delegate = resolverDelegate(model);

  const restricao = valor === null ? undefined : RESTRICOES_VINCULO[`${job.tabelaLocal}.${campo}`];
  if (restricao) {
    const campoCondicao = campoPrismaPorColuna(model, restricao.coluna);
    const atual = campoCondicao ? await delegate.findUnique({ where: { [pk[0]]: id }, select: { [campoCondicao]: true } }) : null;
    if (!atual) throw new ErroValidacao(`Registro "${id}" não encontrado em "${job.tabelaLocal}".`);
    if (String(atual[campoCondicao as string]) !== restricao.valor) throw new ErroValidacao(restricao.motivo);
  }

  // Campo interno que NÃO é vínculo (18/11/2026): o valor é conferido pelo TIPO da coluna (Boolean, texto, inteiro, número) — um valor de tipo
  // errado nunca chega ao Prisma. Vínculo continua sendo conferido contra a tabela relacionada, lá em cima.
  let valorFinal: unknown = valor;
  if (!ehRelacionamento) {
    try {
      valorFinal = converterValorInterno(model.fields.find((f) => f.name === campoPrisma)?.type ?? "", valor);
    } catch (erro) {
      if (erro instanceof ErroValorInterno) throw new ErroValidacao(`Campo "${campo}": ${erro.message}`);
      throw erro;
    }
  }

  const linhaAtualizada = await delegate.update({ where: { [pk[0]]: id }, data: { [campoPrisma]: valorFinal } });

  // Remapeado pra chave nomeInterno (coluna do Postgres, não campo Prisma
  // cru) — o frontend hoje descarta esse retorno (DadosKyria.tsx só recarrega a página
  // depois do PATCH), então não corrige bug visível nenhum, mas mantém a resposta consistente
  // com o resto da API em vez de vazar o nome do campo Prisma e um BigInt cru.
  const colunas: ColunaDados[] = recurso.campos
    .filter((c) => c.manter)
    .map((c) => ({
      nomeInterno: c.nomeInterno,
      ehInterno: c.nomeOrigem === null,
      relacionamentoModelo: c.relacionamentoModelo,
      relacionamentoCampo: c.relacionamentoCampo,
      relacionamentoCampoDescricao: c.relacionamentoCampoDescricao,
    }));
  return remapearItens([linhaAtualizada], colunas, model)[0];
}

export interface ListaRelacionados {
  total: number;
  page: number;
  pageSize: number;
  colunas: string[];
  itens: Record<string, unknown>[];
}

/**
 * Busca/lista linhas de QUALQUER model interno, pro seletor de registro relacionado — genérico,
 * sem código específico por tabela. `busca` filtra por `contains` (case-insensitive) OR em todo
 * campo escalar String do model.
 */
export async function buscarRegistrosRelacionados(nomeModelo: string, busca: string, pageRaw: unknown, pageSizeRaw: unknown): Promise<ListaRelacionados> {
  const model = resolverModel(nomeModelo, false);
  if (!model) throw new ErroValidacao(`Model "${nomeModelo}" não existe.`);
  const delegate = resolverDelegate(model);
  const camposEscalares = model.fields.filter((f) => f.kind === "scalar");
  const camposString = camposEscalares.filter((f) => f.type === "String").map((f) => f.name);

  const page = clampPagina(pageRaw, 1, Number.MAX_SAFE_INTEGER, 1);
  // Teto 500 (não 100): o modal de seleção (DadosKyria.tsx) pede até 500 de uma vez só pra
  // decidir se a tabela é pequena o bastante pra filtro de coluna no cliente (== "índice") ou
  // grande demais (cai de volta pra busca+paginação no servidor, sem funil). Default (20)
  // continua baixo — só quem pede explicitamente um pageSize maior paga o custo.
  const pageSize = clampPagina(pageSizeRaw, 1, 500, 20);
  const where =
    busca.trim() && camposString.length > 0
      ? { OR: camposString.map((campo) => ({ [campo]: { contains: busca.trim(), mode: "insensitive" as const } })) }
      : undefined;

  const [total, itensBrutos] = await Promise.all([
    delegate.count({ where }),
    delegate.findMany({ where, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  // Genérico sobre ~75 models — não dá pra saber de antemão quais têm campo BigInt (ex.:
  // Cliente.cgccpf). `paraJson` em cada valor de cada linha, não só nos campos escalares
  // listados: `findMany` sem `select` devolve TODOS os campos do model, incluindo os de
  // relação/agregação que nem entram em `camposEscalares`.
  const itens = itensBrutos.map((item: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(item).map(([chave, valor]) => [chave, paraJson(valor)]))
  );

  return { total, page, pageSize, colunas: camposEscalares.map((f) => f.name), itens };
}

/** Erro de validação de negócio — a rota traduz isso pra 400 (não 500, ver syncKyriaDados.ts). */
export class ErroValidacao extends Error {}
