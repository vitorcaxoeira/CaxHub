import { Consultor } from "@prisma/client";
import { prisma } from "../db/prisma";
import { DEPEXE_COMERCIAL, DEPEXE_DIRETORIA } from "./propostasDominio";

// Contexto de autorização do módulo de Gestão de Projetos. "Líder Técnico" e
// "Consultor" não são papéis (Role) — são derivados dinamicamente de
// DepartamentoGestor/DepartamentoTime, o mesmo mecanismo já usado em
// GET /dashboard/meu-perfil. Ver plano "Módulo Gestão de Projetos — Fase 0".
export interface ContextoConsultor {
  consultor: Consultor | null;
  departamentosGerenciados: number[]; // depexe onde o usuário é usuges (Líder Técnico)
  departamentosTime: number[]; // depexe onde o usuário é integrante do time (Consultor)
}

export async function resolverContextoConsultor(email: string): Promise<ContextoConsultor> {
  const consultor = await prisma.consultor.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });

  if (!consultor) {
    return { consultor: null, departamentosGerenciados: [], departamentosTime: [] };
  }

  const [gestorDe, timeDe] = await Promise.all([
    prisma.departamentoGestor.findMany({
      where: { codemp: consultor.codemp, usuges: BigInt(consultor.codusu) },
      select: { depexe: true },
    }),
    prisma.departamentoTime.findMany({
      where: { codemp: consultor.codemp, codusu: BigInt(consultor.codusu), sitreg: "A" },
      select: { depexe: true },
    }),
  ]);

  return {
    consultor,
    departamentosGerenciados: gestorDe.map((d) => d.depexe),
    departamentosTime: timeDe.map((d) => d.depexe),
  };
}

// Consultores ativos dos departamentos informados (o "time" de um Líder Técnico). Mora
// aqui, e não numa rota, porque duas telas dependem da MESMA definição de time: o seletor
// de consultor do apontamento manual e o filtro de consultor das RATs. Se cada uma
// derivasse o time do seu próprio jeito, elas divergiriam.
//
// O caminho é DepartamentoTime -> Consultor, e a conversão de tipo é obrigatória:
// `DepartamentoTime.codusu` é BigInt e `Consultor.codusu` é Int. Consultor sem `codfor`
// fica fora — sem ele não há como amarrar a atividades nem a RATs.
export async function consultoresDosDepartamentos(depexes: number[]): Promise<Consultor[]> {
  if (depexes.length === 0) return [];
  const doTime = await prisma.departamentoTime.findMany({
    where: { depexe: { in: depexes }, sitreg: "A" },
    select: { codemp: true, codusu: true },
  });
  if (doTime.length === 0) return [];
  return prisma.consultor.findMany({
    where: {
      OR: doTime.map((t) => ({ codemp: t.codemp, codusu: Number(t.codusu) })),
      codfor: { not: null },
    },
  });
}

// Departamentos que têm alguém no time. É o universo de onde se escolhe gente pra
// trabalhar — diferente da lista estática de DEPEXE_LABELS, que inclui departamento sem
// ninguém dentro, e diferente da tabela Consultor, que espelha o cadastro de FORNECEDORES
// do Senior e traz muito mais nome que time.
//
// Consumido pela lista de consultores da Jornada e pelo seletor de departamento do modal
// de alocação — se cada tela derivasse por conta própria, uma ofereceria departamento que
// a outra não reconhece.
export async function departamentosComTime(): Promise<number[]> {
  const registros = await prisma.departamentoTime.findMany({
    where: { sitreg: "A" },
    distinct: ["depexe"],
    select: { depexe: true },
  });
  return registros.map((r) => r.depexe);
}

// Codfors por quem o usuário pode olhar/lançar como "time": os consultores dos
// departamentos que ele gerencia mais ele próprio. `null` = sem restrição (admin).
export async function codforsDoTime(role: string, contexto: ContextoConsultor): Promise<Set<number> | null> {
  if (role === "admin") return null;
  const doTime = await consultoresDosDepartamentos(contexto.departamentosGerenciados);
  const codfors = new Set<number>();
  for (const c of doTime) if (c.codfor != null) codfors.add(c.codfor);
  if (contexto.consultor?.codfor != null) codfors.add(contexto.consultor.codfor);
  return codfors;
}

export function nomeConsultor(c: { codfor: number | null; nomcom: string | null; nomfor: string | null }): string {
  return c.nomcom ?? c.nomfor ?? `Fornecedor ${c.codfor}`;
}

export interface ConsultorFiltravel {
  codfor: number;
  nome: string;
}

// Consultores que este usuário pode escolher pra agir/ver em nome deles: admin recebe todo
// mundo com codfor cadastrado; senão, o time dos departamentos que gerencia. O próprio
// usuário entra sempre, mesmo fora do time (gestor também aponta/vê o painel dele). Mora
// aqui, não numa rota, porque mais de uma tela precisa da MESMA definição — hoje o seletor
// de consultor do apontamento manual (GET /apontamentos/consultores) e o filtro de
// consultor do Dashboard inicial (GET /dashboard/consultores-filtraveis); divergir entre
// elas ofereceria nomes diferentes pro mesmo usuário em telas diferentes.
//
// `conhab = 1` (USU_VBI00Cons do Senior) é quem filtra aqui — 18/08/2026, a pedido do Vitor.
// Aplicado igual pra todo mundo, inclusive o próprio usuário: se ele mesmo não estiver
// habilitado, também não entra na lista, pra não ter uma exceção difícil de explicar.
export async function consultoresFiltraveis(role: string, contexto: ContextoConsultor): Promise<ConsultorFiltravel[]> {
  const doTime =
    role === "admin"
      ? await prisma.consultor.findMany({ where: { codfor: { not: null }, conhab: 1 } })
      : (await consultoresDosDepartamentos(contexto.departamentosGerenciados)).filter((c) => c.conhab === 1);

  const porCodfor = new Map<number, string>();
  if (contexto.consultor?.codfor != null && contexto.consultor.conhab === 1) {
    porCodfor.set(contexto.consultor.codfor, nomeConsultor(contexto.consultor));
  }
  for (const c of doTime) {
    if (c.codfor != null) porCodfor.set(c.codfor, nomeConsultor(c));
  }

  return [...porCodfor.entries()].map(([codfor, nome]) => ({ codfor, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
}

// "Sou o gestor DESTE departamento" — a pergunta que não passa por podeExecutarAcao.
// Existe porque `editar` deixou de servir pra isso: desde 31/07/2026 ela também é
// liberada pro dono da atividade, e há decisões que só o gestor pode tomar (autorizar
// horas excedentes, abrir o cronograma da proposta).
export function gerenciaDepartamento(role: string, contexto: ContextoConsultor, depexe: number): boolean {
  return role === "admin" || contexto.departamentosGerenciados.includes(depexe);
}

// "Admin, Gestor Comercial ou Diretoria" — alçada pra DECIDIR a configuração de uma proposta
// (as 3 flags de PropostaModoAlocacao: bloqueiaExcedenteEstrutura, bloqueiaApontamento,
// bloqueiaExcedente). Conjunto propositalmente mais estreito que podeGerenciarProposta
// (routes/alocacao.ts), onde entra qualquer gestor com UM item na proposta — largo demais
// pro peso dessas três decisões.
//
// Escrito sobre gerenciaDepartamento: admin já entra de graça lá dentro, e trocar o gestor de
// um desses dois departamentos no Senior muda o aprovador sozinho, sem deploy. Não há papel
// "diretoria" no CaxHub — Diretoria é o departamento 0 (ver DEPEXE_DIRETORIA).
export function podeAprovarConfiguracaoProposta(role: string, contexto: ContextoConsultor): boolean {
  return gerenciaDepartamento(role, contexto, DEPEXE_COMERCIAL) || gerenciaDepartamento(role, contexto, DEPEXE_DIRETORIA);
}

// Nome de quem gerencia um departamento — o mesmo JOIN que notificarGestoresDoDepartamento
// (domain/notificacoes.ts) já faz para notificação, aqui para EXIBIÇÃO (badge de gestor no
// card de Aprovações, 24/08/2026). Em lote: uma query para todos os departamentos pedidos,
// não uma por solicitação — mesmo espírito de depexePorAtividade (duplicada nos 3 routers
// de solicitações), chaveado por "codemp-depexe" porque DepartamentoGestor é PK composta.
export async function gestorNomePorDepartamento(pares: { codemp: number; depexe: number }[]): Promise<Map<string, string>> {
  const resultado = new Map<string, string>();
  const unicos = [...new Map(pares.map((p) => [`${p.codemp}-${p.depexe}`, p])).values()];
  if (unicos.length === 0) return resultado;

  const gestores = await prisma.departamentoGestor.findMany({
    where: { OR: unicos.map((p) => ({ codemp: p.codemp, depexe: p.depexe })) },
  });
  if (gestores.length === 0) return resultado;

  const consultores = await prisma.consultor.findMany({
    where: { OR: gestores.map((g) => ({ codemp: g.codemp, codusu: Number(g.usuges) })) },
  });
  const nomePorConsultor = new Map(consultores.map((c) => [`${c.codemp}-${c.codusu}`, nomeConsultor(c)]));

  const porDepartamento = new Map<string, string[]>();
  for (const g of gestores) {
    const nome = nomePorConsultor.get(`${g.codemp}-${Number(g.usuges)}`);
    if (!nome) continue; // usuges sem Consultor casando — mesmo silêncio de notificarGestoresDoDepartamento
    const chave = `${g.codemp}-${g.depexe}`;
    porDepartamento.set(chave, [...(porDepartamento.get(chave) ?? []), nome]);
  }
  for (const [chave, nomes] of porDepartamento) resultado.set(chave, nomes.join(" e "));
  return resultado;
}

export type AcaoProjeto =
  | "visualizar"
  | "criar"
  | "editar"
  | "mover"
  | "excluir"
  | "aprovar"
  | "exportar"
  | "importar"
  | "lancarApontamento";

interface AtividadeParaPermissao {
  depexe: number;
  codfor: number;
}

// "criar" habilitado nesta fase pra área de Alocação (Líder Técnico distribui horas de
// um item de proposta entre os consultores do próprio time).
const ACOES_LIDER_TECNICO: AcaoProjeto[] = ["visualizar", "criar", "editar", "mover", "aprovar", "excluir"];

// role vem do JWT (req.user.role) — o mesmo papel usado pelo requireRole() das rotas.
export function podeExecutarAcao(
  role: string,
  contexto: ContextoConsultor,
  acao: AcaoProjeto,
  atividade: AtividadeParaPermissao
): boolean {
  if (role === "admin") return true;
  if (role === "comercial") return acao === "visualizar";

  if (contexto.departamentosGerenciados.includes(atividade.depexe)) {
    // O Líder Técnico PODE lançar apontamento por qualquer consultor do departamento que
    // gerencia. Isso foi uma revisão consciente (30/07/2026): antes a regra aqui exigia
    // `contexto.consultor?.codfor === atividade.codfor`, com o argumento de que gerenciar
    // o time não é a mesma coisa que ter trabalhado na atividade. Na prática o gestor
    // precisa registrar tempo de quem esqueceu de apontar, e nada se perde em
    // rastreabilidade: o apontamento continua pertencendo a quem executou (a RAT nasce
    // com o `codfor` da atividade, ver buscarOuCriarRatRascunho em routes/apontamentos.ts)
    // e o AuditEvento grava o usuário logado, então fica registrado quem lançou.
    //
    // A liberação é SÓ deste ramo. No ramo de `departamentosTime` abaixo a exigência
    // continua: colega de time não lança por colega.
    return acao === "lancarApontamento" || ACOES_LIDER_TECNICO.includes(acao);
  }

  if (contexto.departamentosTime.includes(atividade.depexe)) {
    if (acao === "visualizar") return true;
    if (acao === "mover" || acao === "editar" || acao === "lancarApontamento") {
      return contexto.consultor?.codfor === atividade.codfor;
    }
    return false;
  }

  // Atividade alocada PRA MIM, em departamento que não é meu. Antes caía no `false`
  // abaixo: o consultor recebia a alocação e não conseguia nem ver a atividade, muito
  // menos iniciar. Alocar é justamente o ato de dizer "essa pessoa vai executar isso",
  // então o vínculo com o executor vale mesmo quando o item é de outro departamento
  // (medido em 30/07/2026: 4 das 101 atividades de um consultor caíam nesse buraco).
  //
  // Libera só o que o executor precisa pra trabalhar — as mesmas quatro ações que o ramo
  // de `departamentosTime` já dá pro dono da atividade. Aprovar, criar e excluir seguem
  // sendo de quem gerencia o departamento.
  // `> 0` não é paranoia: várias chamadas de alocacao.ts passam `codfor: 0` como sentinela
  // de "não se aplica a um consultor específico" (ações de estrutura do item). Sem esta
  // guarda, um Consultor que viesse do Senior com codfor 0 casaria com todas elas e
  // ganharia `editar` em item de qualquer departamento. Hoje o menor codfor da base é 2,
  // então é uma trava preventiva.
  const meuCodfor = contexto.consultor?.codfor;
  if (meuCodfor != null && meuCodfor > 0 && meuCodfor === atividade.codfor) {
    return acao === "visualizar" || acao === "mover" || acao === "editar" || acao === "lancarApontamento";
  }

  return false;
}
