// Painel de Eficiência — vendido x executado x alocado por item de proposta.
//
// Funções PURAS (sem Prisma), pra a conta ser testável sem banco e ter um lugar só. Todo valor
// de horas aqui está em MINUTOS, como no Senior (`qtdhor`, `horfim - horini`).
//
// Origem das regras: "Cockpit de Propostas" do líder (D:\Projeto com IA\Exemplos). A conta foi
// portada igual; mudou a FONTE dos números (dado vivo, valor-hora real do item em vez de
// parâmetro digitado). As definições estão na aba "Como calculamos" do painel, geradas de LIMIARES.

export type Tom = "ok" | "warn" | "bad" | "off";

// Como o ESTOURO da proposta é lido:
//  - "item": soma do estouro de cada item (um item acima do vendido já conta, mesmo que outro item da proposta tenha saldo). Padrão.
//  - "proposta": só o total (executado − vendido da proposta inteira); o saldo de um item compensa o estouro de outro.
// Só muda proposta, cliente e carteira. Horas por item, eficiência/carga do consultor (por alocação) e carga pendente não mudam.
export type ModoEstouro = "item" | "proposta";
export const MODOS_ESTOURO: ModoEstouro[] = ["item", "proposta"];
export const modoEstouroValido = (v: unknown): ModoEstouro => (v === "proposta" ? "proposta" : "item");

// fatser do item que vira receita direta (S = Faturamento Normal, A = Antecipado). Os demais (N sem faturamento, C comercial,
// H suporte, I investimento) entram no valor do painel, mas são apontados à parte como "sem faturamento".
export const FATSER_FATURAVEL = ["S", "A"] as const;
const semFaturamento = (fatser: string | null) => fatser != null && fatser.trim() !== "" && !(FATSER_FATURAVEL as readonly string[]).includes(fatser.trim().toUpperCase());

// Constantes da conta. Vão no payload (`meta.limiares`) pra aba "Como calculamos" nunca divergir
// do que o backend de fato aplica.
export const LIMIARES = {
  // Consumo a partir do qual o item está "perto do limite". Mesmo valor de LIMIAR_AVISO_TETO
  // (domain/tetoAtividade.ts) e de LIMIAR_ALERTA_CONSUMO do frontend.
  pertoDoLimite: 0.8,
  // Proposta só vira "Estouro" a partir de 1 h acima do vendido; menos que isso é "Atenção".
  estouroMinimoMin: 60,
  // Estouro crítico: 40 h ou mais acima do vendido, ou consumo de 125% ou mais.
  criticoMin: 2400,
  criticoConsumo: 1.25,
  // Meses de carteira (carga pendente ÷ capacidade mensal): até 1,5 ok, até 3 atenção, acima sobrecarga.
  mesesAtencao: 1.5,
  mesesSobrecarga: 3,
  // Capacidade mensal em projeto quando o usuário não informa outra (h/mês).
  capacidadePadraoHorasMes: 120,
  // Eficiência: >= 95% ok, >= 80% atenção, abaixo disso crítico.
  eficienciaOk: 0.95,
  eficienciaAtencao: 0.8,
  // Proposta atípica (fora da curva): consumo de 300% ou mais E 200 h ou mais acima do vendido. Distorce
  // totais e médias da carteira; o painel avisa e deixa o usuário ocultar (nunca oculta sozinho).
  atipicaConsumo: 3,
  atipicaAcimaMin: 12000,
} as const;

export interface ItemEntrada {
  codemp: number;
  codpro: number;
  seqite: number;
  descricao: string;
  servico: string | null;
  depexe: number | null;
  fatser: string | null;
  vendido: number; // minutos
  valhor: number | null; // R$/h
  executado: number; // minutos — TODO o apontado no item (por codpro+seqite), não só o vinculado a alocação
}

export interface PropostaEntrada {
  codemp: number;
  codpro: number;
  codcli: number;
  cliente: string;
  sitpro: number | null;
  modpro: number | null;
  depexe: number | null;
  interna: boolean;
  itens: ItemEntrada[];
}

// Uma alocação (AtividadeConsultor ativa). `alocado` já é o TETO (qtdhor + horasExcedentes) e
// `executado` o realizado dela pela regra de domain/tetoAtividade.ts — nunca uma segunda definição.
export interface AlocacaoEntrada {
  codemp: number;
  codpro: number;
  seqite: number;
  codfor: number;
  alocado: number;
  executado: number;
}

export interface ConsultorNoItem {
  codfor: number;
  alocado: number;
  executado: number;
  pendente: number;
  revisar: number;
}

export interface ItemCalculado {
  seqite: number;
  descricao: string;
  servico: string | null;
  depexe: number | null;
  fatser: string | null;
  vendido: number;
  valhor: number | null;
  executado: number;
  consumo: number | null; // null = sem vendido e com execução
  situacao: Tom;
  dentro: number; // executado dentro do vendido
  acima: number; // estouro
  saldo: number;
  impacto: number; // R$ do estouro, no valor-hora do próprio item
  // Em R$ ao valor-hora de VENDA do item (não é faturamento nem custo). Item sem valor-hora fica zerado.
  valorVendido: number;
  valorExecutado: number;
  valorSaldo: number;
  /** fatser fora de Normal/Antecipado: o valor existe, mas não é receita direta. */
  semFaturamento: boolean;
  semAlocacao: number; // executado do item que nenhuma alocação ativa explica
  // Só os consultores que o usuário pode ver (o time dele; admin vê todos).
  consultores: ConsultorNoItem[];
  // Soma dos demais (fora do time do gestor), sem nome.
  outros: { alocado: number; executado: number };
}

export interface PropostaCalculada {
  codemp: number;
  codpro: number;
  codcli: number;
  cliente: string;
  sitpro: number | null;
  modpro: number | null;
  depexe: number | null;
  interna: boolean;
  vendido: number;
  executado: number;
  dentro: number;
  acima: number;
  saldo: number;
  impacto: number;
  /** Os dois jeitos de ler o estouro, sempre calculados: `acima` acima é o do modo escolhido; estes dois servem pra mostrar o outro. */
  acimaPorItem: number;
  acimaGlobal: number;
  /** R$ ao valor-hora de venda (ver ItemCalculado). `valorSaldo` segue o modo, como `saldo`. */
  valorVendido: number;
  valorExecutado: number;
  valorSaldo: number;
  /** Parte do valor vendido que está em itens sem faturamento direto (N, C, H, I). */
  valorSemFaturamento: number;
  semAlocacao: number;
  consumo: number | null;
  eficiencia: number | null;
  situacao: Tom;
  critico: boolean;
  itensPorSituacao: Record<Tom, number>;
  itens: ItemCalculado[];
}

const zeroSituacoes = (): Record<Tom, number> => ({ ok: 0, warn: 0, bad: 0, off: 0 });

export function situacaoDoItem(vendido: number, executado: number): Tom {
  if (executado <= 0) return "off";
  if (executado > vendido) return "bad";
  return executado / vendido >= LIMIARES.pertoDoLimite ? "warn" : "ok";
}

// "Eficiência" = horas executadas DENTRO do vendido ÷ horas executadas. 100% = nenhuma hora
// passou do vendido; 120 h num item de 100 h = 83%.
export function eficiencia(dentro: number, executado: number): number | null {
  return executado > 0 ? dentro / executado : null;
}

export function tomEficiencia(valor: number | null): Tom {
  if (valor == null) return "off";
  if (valor >= LIMIARES.eficienciaOk) return "ok";
  if (valor >= LIMIARES.eficienciaAtencao) return "warn";
  return "bad";
}

export function tomMeses(meses: number): Tom {
  if (meses > LIMIARES.mesesSobrecarga) return "bad";
  if (meses > LIMIARES.mesesAtencao) return "warn";
  return "ok";
}

export function calcularItem(
  item: ItemEntrada,
  alocacoes: AlocacaoEntrada[],
  visiveis: Set<number> | null,
  ignorados: Set<number> | null = null
): ItemCalculado {
  const executado = Math.max(0, item.executado);
  const vendido = Math.max(0, item.vendido);
  const dentro = Math.min(executado, vendido);
  const acima = Math.max(0, executado - vendido);
  const saldo = Math.max(0, vendido - executado);

  // Várias alocações do mesmo consultor no item viram uma linha só (alocado e executado somados).
  const porConsultor = new Map<number, { alocado: number; executado: number }>();
  let executadoPorAlocados = 0;
  for (const a of alocacoes) {
    const atual = porConsultor.get(a.codfor) ?? { alocado: 0, executado: 0 };
    atual.alocado += a.alocado;
    atual.executado += a.executado;
    porConsultor.set(a.codfor, atual);
    executadoPorAlocados += a.executado;
  }

  const consultores: ConsultorNoItem[] = [];
  const outros = { alocado: 0, executado: 0 };
  for (const [codfor, v] of porConsultor) {
    // Fora do recorte da tela OU ignorado pela pessoa: vira "outros" (sem nome, fora de equipe, carga e mapa). As horas do ITEM
    // (vendido, executado, estouro) não mudam: consultor ignorado só sai dos indicadores da equipe, não da proposta.
    if ((visiveis != null && !visiveis.has(codfor)) || ignorados?.has(codfor)) {
      outros.alocado += v.alocado;
      outros.executado += v.executado;
      continue;
    }
    // Carga pendente: o que ainda cabe na alocação do consultor E no saldo do item. O que sobra
    // da alocação sem saldo no item é "a revisar" (alocação em item que já consumiu o vendido).
    const restanteAlocacao = Math.max(0, v.alocado - v.executado);
    const pendente = Math.min(restanteAlocacao, saldo);
    consultores.push({ codfor, alocado: v.alocado, executado: v.executado, pendente, revisar: restanteAlocacao - pendente });
  }

  return {
    seqite: item.seqite,
    descricao: item.descricao,
    servico: item.servico,
    depexe: item.depexe,
    fatser: item.fatser,
    vendido,
    valhor: item.valhor,
    executado,
    consumo: vendido > 0 ? executado / vendido : executado > 0 ? null : 0,
    situacao: situacaoDoItem(vendido, executado),
    dentro,
    acima,
    saldo,
    impacto: item.valhor != null && item.valhor > 0 ? (acima / 60) * item.valhor : 0,
    valorVendido: item.valhor != null && item.valhor > 0 ? (vendido / 60) * item.valhor : 0,
    valorExecutado: item.valhor != null && item.valhor > 0 ? (executado / 60) * item.valhor : 0,
    valorSaldo: item.valhor != null && item.valhor > 0 ? (saldo / 60) * item.valhor : 0,
    semFaturamento: semFaturamento(item.fatser),
    semAlocacao: Math.max(0, executado - executadoPorAlocados),
    consultores,
    outros,
  };
}

export function calcularProposta(
  proposta: PropostaEntrada,
  alocacoesPorItem: Map<string, AlocacaoEntrada[]>,
  visiveis: Set<number> | null,
  ignorados: Set<number> | null = null,
  modo: ModoEstouro = "item"
): PropostaCalculada {
  const itens = proposta.itens.map((i) =>
    calcularItem(i, alocacoesPorItem.get(chaveItem(i.codemp, i.codpro, i.seqite)) ?? [], visiveis, ignorados)
  );
  const soma = (f: (i: ItemCalculado) => number) => itens.reduce((t, i) => t + f(i), 0);
  const vendido = soma((i) => i.vendido);
  const executado = soma((i) => i.executado);
  const acimaPorItem = soma((i) => i.acima);
  const acimaGlobal = Math.max(0, executado - vendido);
  // Valor-hora MÉDIO da proposta (só itens com vendido e valor-hora): é o preço do estouro quando ele é lido pela proposta inteira,
  // já que o excedente global não pertence a um item só.
  const comValor = itens.filter((i) => i.vendido > 0 && i.valhor != null && i.valhor > 0);
  const minutosComValor = comValor.reduce((t, i) => t + i.vendido, 0);
  const valhorMedio = minutosComValor > 0 ? comValor.reduce((t, i) => t + i.vendido * (i.valhor as number), 0) / minutosComValor : 0;
  const global = modo === "proposta";
  const acima = global ? acimaGlobal : acimaPorItem;
  const dentro = global ? Math.min(executado, vendido) : soma((i) => i.dentro);
  const saldo = global ? Math.max(0, vendido - executado) : soma((i) => i.saldo);
  const impacto = global ? (acimaGlobal / 60) * valhorMedio : soma((i) => i.impacto);
  const valorVendido = soma((i) => i.valorVendido);
  const valorExecutado = soma((i) => i.valorExecutado);
  const valorSaldo = global ? Math.max(0, valorVendido - valorExecutado) : soma((i) => i.valorSaldo);
  const itensPorSituacao = zeroSituacoes();
  for (const i of itens) itensPorSituacao[i.situacao]++;

  const consumo = vendido > 0 ? executado / vendido : executado > 0 ? null : 0;
  const situacao: Tom =
    executado === 0
      ? "off"
      : acima >= LIMIARES.estouroMinimoMin
        ? "bad"
        : itensPorSituacao.warn > 0 || itensPorSituacao.bad > 0
          ? "warn"
          : "ok";

  return {
    codemp: proposta.codemp,
    codpro: proposta.codpro,
    codcli: proposta.codcli,
    cliente: proposta.cliente,
    sitpro: proposta.sitpro,
    modpro: proposta.modpro,
    depexe: proposta.depexe,
    interna: proposta.interna,
    vendido,
    executado,
    dentro,
    acima,
    saldo,
    impacto,
    acimaPorItem,
    acimaGlobal,
    valorVendido,
    valorExecutado,
    valorSaldo,
    valorSemFaturamento: itens.filter((i) => i.semFaturamento).reduce((t, i) => t + i.valorVendido, 0),
    semAlocacao: soma((i) => i.semAlocacao),
    consumo,
    eficiencia: eficiencia(dentro, executado),
    situacao,
    critico: situacao === "bad" && (acima >= LIMIARES.criticoMin || (consumo ?? Infinity) >= LIMIARES.criticoConsumo),
    itensPorSituacao,
    itens,
  };
}

export const chaveItem = (codemp: number, codpro: number, seqite: number) => `${codemp}-${codpro}-${seqite}`;

export function indexarAlocacoes(alocacoes: AlocacaoEntrada[]): Map<string, AlocacaoEntrada[]> {
  const mapa = new Map<string, AlocacaoEntrada[]>();
  for (const a of alocacoes) {
    const k = chaveItem(a.codemp, a.codpro, a.seqite);
    const lista = mapa.get(k);
    if (lista) lista.push(a);
    else mapa.set(k, [a]);
  }
  return mapa;
}

// ---------- Equipe ----------

export interface ConsultorCalculado {
  codfor: number;
  alocado: number;
  executado: number;
  dentro: number; // executado dentro da alocação
  pendente: number;
  revisar: number;
  eficiencia: number | null;
  meses: number;
  propostasComSaldo: number;
  porProposta: { codemp: number; codpro: number; alocado: number; executado: number; pendente: number; revisar: number }[];
}

// Agrega por consultor a partir das propostas já calculadas (só entram consultores visíveis).
export function calcularConsultores(propostas: PropostaCalculada[], capacidadeMensalMin: number): ConsultorCalculado[] {
  const mapa = new Map<number, ConsultorCalculado>();
  for (const p of propostas) {
    for (const i of p.itens) {
      for (const c of i.consultores) {
        const m =
          mapa.get(c.codfor) ??
          { codfor: c.codfor, alocado: 0, executado: 0, dentro: 0, pendente: 0, revisar: 0, eficiencia: null, meses: 0, propostasComSaldo: 0, porProposta: [] };
        m.alocado += c.alocado;
        m.executado += c.executado;
        m.dentro += Math.min(c.executado, c.alocado);
        m.pendente += c.pendente;
        m.revisar += c.revisar;
        let pp = m.porProposta.find((x) => x.codemp === p.codemp && x.codpro === p.codpro);
        if (!pp) {
          pp = { codemp: p.codemp, codpro: p.codpro, alocado: 0, executado: 0, pendente: 0, revisar: 0 };
          m.porProposta.push(pp);
        }
        pp.alocado += c.alocado;
        pp.executado += c.executado;
        pp.pendente += c.pendente;
        pp.revisar += c.revisar;
        mapa.set(c.codfor, m);
      }
    }
  }
  return [...mapa.values()].map((m) => ({
    ...m,
    eficiencia: eficiencia(m.dentro, m.executado),
    meses: capacidadeMensalMin > 0 ? m.pendente / capacidadeMensalMin : 0,
    propostasComSaldo: m.porProposta.filter((x) => x.pendente > 0).length,
  }));
}

// ---------- Carteira ----------

export interface ResumoCarteira {
  propostas: number;
  vendido: number;
  executado: number;
  dentro: number;
  acima: number;
  saldo: number;
  impacto: number;
  semAlocacao: number;
  eficiencia: number | null;
  propostasPorSituacao: Record<Tom, number>;
  itensPorSituacao: Record<Tom, number>;
  itensPertoDoLimite: number;
  saldoPertoDoLimite: number;
}

export function resumirCarteira(propostas: PropostaCalculada[]): ResumoCarteira {
  const r: ResumoCarteira = {
    propostas: propostas.length,
    vendido: 0, executado: 0, dentro: 0, acima: 0, saldo: 0, impacto: 0, semAlocacao: 0,
    eficiencia: null,
    propostasPorSituacao: zeroSituacoes(),
    itensPorSituacao: zeroSituacoes(),
    itensPertoDoLimite: 0,
    saldoPertoDoLimite: 0,
  };
  for (const p of propostas) {
    r.vendido += p.vendido;
    r.executado += p.executado;
    r.dentro += p.dentro;
    r.acima += p.acima;
    r.saldo += p.saldo;
    r.impacto += p.impacto;
    r.semAlocacao += p.semAlocacao;
    r.propostasPorSituacao[p.situacao]++;
    for (const k of ["ok", "warn", "bad", "off"] as Tom[]) r.itensPorSituacao[k] += p.itensPorSituacao[k];
    for (const i of p.itens) {
      if (i.situacao === "warn") {
        r.itensPertoDoLimite++;
        r.saldoPertoDoLimite += i.saldo;
      }
    }
  }
  r.eficiencia = eficiencia(r.dentro, r.executado);
  return r;
}

// Uma definição só de "proposta atípica": usada pela aba Qualidade e pelo botão "Ocultar atípicas".
// Consumo `null` = sem vendido e com execução (consumo infinito), que conta como acima do limite.
export function ehAtipica(p: Pick<PropostaCalculada, "consumo" | "acima">): boolean {
  return (p.consumo == null || p.consumo >= LIMIARES.atipicaConsumo) && p.acima >= LIMIARES.atipicaAcimaMin;
}

export interface FaixaConsumo {
  chave: string;
  rotulo: string;
  tom: Tom;
  propostas: number;
  vendido: number;
}

const FAIXAS: { chave: string; rotulo: string; tom: Tom; pertence: (p: PropostaCalculada, c: number) => boolean }[] = [
  { chave: "naoini", rotulo: "Não iniciadas", tom: "off", pertence: (p) => p.executado === 0 },
  { chave: "b1", rotulo: "Até 50%", tom: "ok", pertence: (p, c) => p.executado > 0 && c <= 0.5 },
  { chave: "b2", rotulo: "50% a 80%", tom: "ok", pertence: (_p, c) => c > 0.5 && c <= 0.8 },
  { chave: "b3", rotulo: "80% a 100%", tom: "warn", pertence: (_p, c) => c > 0.8 && c <= 1 },
  { chave: "b4", rotulo: "100% a 150%", tom: "bad", pertence: (_p, c) => c > 1 && c <= 1.5 },
  { chave: "b5", rotulo: "Acima de 150%", tom: "bad", pertence: (_p, c) => c > 1.5 },
];

// Proposta sem vendido e com execução cai em "Acima de 150%" (consumo infinito).
export function faixasDeConsumo(propostas: PropostaCalculada[]): FaixaConsumo[] {
  return FAIXAS.map((f) => {
    const lista = propostas.filter((p) => f.pertence(p, p.consumo ?? Infinity));
    return { chave: f.chave, rotulo: f.rotulo, tom: f.tom, propostas: lista.length, vendido: lista.reduce((t, p) => t + p.vendido, 0) };
  });
}

export function faixaDaProposta(p: PropostaCalculada): string {
  const c = p.consumo ?? Infinity;
  return FAIXAS.find((f) => f.pertence(p, c))?.chave ?? "naoini";
}

export interface ParetoLinha {
  codemp: number;
  codpro: number;
  cliente: string;
  acima: number;
  consumo: number | null;
  impacto: number;
  acumulado: number; // fração do estouro total, 0..1
}

export function paretoDoEstouro(propostas: PropostaCalculada[], limite = 8): { linhas: ParetoLinha[]; top3: number } {
  const total = propostas.reduce((t, p) => t + p.acima, 0);
  const ordenadas = propostas.filter((p) => p.acima > 0).sort((a, b) => b.acima - a.acima);
  let acc = 0;
  const linhas = ordenadas.slice(0, limite).map((p) => {
    acc += p.acima;
    return { codemp: p.codemp, codpro: p.codpro, cliente: p.cliente, acima: p.acima, consumo: p.consumo, impacto: p.impacto, acumulado: total > 0 ? acc / total : 0 };
  });
  const top3 = total > 0 ? ordenadas.slice(0, 3).reduce((t, p) => t + p.acima, 0) / total : 0;
  return { linhas, top3 };
}

// ---------- Clientes ----------

export interface ClienteCalculado {
  codcli: number;
  cliente: string;
  interna: boolean;
  propostas: number;
  propostasComEstouro: number;
  vendido: number;
  executado: number;
  dentro: number;
  acima: number;
  saldo: number;
  impacto: number;
  consumo: number | null;
  eficiencia: number | null;
  situacao: Tom;
}

export function calcularClientes(propostas: PropostaCalculada[]): ClienteCalculado[] {
  const mapa = new Map<number, ClienteCalculado>();
  for (const p of propostas) {
    const c =
      mapa.get(p.codcli) ??
      { codcli: p.codcli, cliente: p.cliente, interna: p.interna, propostas: 0, propostasComEstouro: 0, vendido: 0, executado: 0, dentro: 0, acima: 0, saldo: 0, impacto: 0, consumo: 0, eficiencia: null, situacao: "off" as Tom };
    c.propostas++;
    if (p.situacao === "bad") c.propostasComEstouro++;
    c.vendido += p.vendido;
    c.executado += p.executado;
    c.dentro += p.dentro;
    c.acima += p.acima;
    c.saldo += p.saldo;
    c.impacto += p.impacto;
    mapa.set(p.codcli, c);
  }
  return [...mapa.values()].map((c) => ({
    ...c,
    consumo: c.vendido > 0 ? c.executado / c.vendido : c.executado > 0 ? null : 0,
    eficiencia: eficiencia(c.dentro, c.executado),
    situacao: c.executado === 0 ? "off" : c.acima >= LIMIARES.estouroMinimoMin ? "bad" : c.executado / Math.max(1, c.vendido) >= LIMIARES.pertoDoLimite ? "warn" : "ok",
  }));
}

// ---------- Alertas ----------

export type AlvoAlerta =
  | { tipo: "proposta"; codemp: number; codpro: number }
  | { tipo: "consultor"; codfor: number }
  | { tipo: "aba"; aba: "propostas" | "equipe" | "qualidade" | "acoes"; filtro?: string };

export interface Alerta {
  severidade: Tom;
  rotulo: string;
  peso: number;
  titulo: string;
  detalhe: string;
  alvo: AlvoAlerta;
  /** Texto sugerido pro botão "Criar ação" (Plano de ação). Ausente = alerta que não vira ação. */
  acaoSugerida?: string;
}

const fmtH = (min: number) => `${Math.round(min / 60).toLocaleString("pt-BR")} h`;
const fmtPct = (x: number | null) => (x == null || !isFinite(x) ? "—" : `${Math.round(x * 100)}%`);

export function montarAlertas(
  propostas: PropostaCalculada[],
  consultores: ConsultorCalculado[],
  nomes: Map<number, string>
): Alerta[] {
  const alertas: Alerta[] = [];
  const resumo = resumirCarteira(propostas);

  const estouradas = propostas.filter((p) => p.situacao === "bad").sort((a, b) => b.acima - a.acima);
  for (const p of estouradas.slice(0, 4)) {
    const itensEstourados = p.itensPorSituacao.bad;
    alertas.push({
      severidade: p.critico ? "bad" : "warn",
      rotulo: p.critico ? "Crítico" : "Alto",
      peso: p.acima,
      titulo: `${p.cliente} · PS ${p.codpro}`,
      detalhe: `${fmtH(p.acima)} acima do vendido${p.impacto > 0 ? ` (R$ ${Math.round(p.impacto).toLocaleString("pt-BR")})` : ""} · ${fmtPct(p.consumo)} consumido · ${itensEstourados} ite${itensEstourados > 1 ? "ns" : "m"} estourado${itensEstourados > 1 ? "s" : ""}`,
      alvo: { tipo: "proposta", codemp: p.codemp, codpro: p.codpro },
      acaoSugerida: `Alinhar aditivo ou replanejamento da PS ${p.codpro} com o cliente`,
    });
  }
  const criticas = estouradas.filter((p) => p.critico);
  if (criticas.length > 4) {
    const resto = criticas.slice(4);
    alertas.push({
      severidade: "bad",
      rotulo: "Crítico",
      peso: Math.max(0, (estouradas[3]?.acima ?? 0) - 1),
      titulo: `Mais ${resto.length} proposta${resto.length > 1 ? "s" : ""} com estouro crítico`,
      detalhe: `${fmtH(resto.reduce((t, p) => t + p.acima, 0))} acima do vendido somadas.`,
      alvo: { tipo: "aba", aba: "propostas", filtro: "estouro" },
      acaoSugerida: "Tratar as propostas com estouro crítico",
    });
  }

  if (resumo.itensPertoDoLimite > 0) {
    alertas.push({
      severidade: "warn",
      rotulo: "Prevenção",
      peso: resumo.saldoPertoDoLimite + 1200,
      titulo: `${resumo.itensPertoDoLimite} ite${resumo.itensPertoDoLimite > 1 ? "ns" : "m"} com mais de 80% do vendido consumido`,
      detalhe: `Restam ${fmtH(resumo.saldoPertoDoLimite)} antes de estourar. Confirme o avanço real com os consultores.`,
      alvo: { tipo: "aba", aba: "propostas", filtro: "atencao" },
      acaoSugerida: "Levantar o avanço real dos itens com mais de 80% do vendido consumido",
    });
  }

  for (const c of consultores.filter((x) => x.meses > LIMIARES.mesesSobrecarga).sort((a, b) => b.meses - a.meses)) {
    alertas.push({
      severidade: "warn",
      rotulo: "Capacidade",
      peso: c.pendente,
      titulo: `${nomes.get(c.codfor) ?? `Consultor ${c.codfor}`} com ${c.meses.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} meses de carteira`,
      detalhe: `${fmtH(c.pendente)} pendentes em ${c.propostasComSaldo} propostas. Avalie redistribuir ou repriorizar.`,
      alvo: { tipo: "consultor", codfor: c.codfor },
      acaoSugerida: `Redistribuir parte da carteira de ${nomes.get(c.codfor) ?? `consultor ${c.codfor}`}`,
    });
  }

  const revisar = consultores.reduce((t, c) => t + c.revisar, 0);
  if (revisar >= 60) {
    alertas.push({
      severidade: "warn",
      rotulo: "Alocação",
      peso: revisar * 0.5,
      titulo: `${fmtH(revisar)} alocadas em itens sem saldo`,
      detalhe: "Consultores alocados em itens que já consumiram o vendido. Revisar ou formalizar aditivo.",
      alvo: { tipo: "aba", aba: "qualidade" },
      acaoSugerida: "Revisar as alocações em itens sem saldo",
    });
  }

  if (resumo.semAlocacao >= 60) {
    const frac = resumo.executado > 0 ? resumo.semAlocacao / resumo.executado : 0;
    alertas.push({
      severidade: frac > 0.1 ? "bad" : "warn",
      rotulo: "Apontamento",
      peso: resumo.semAlocacao * 0.5,
      titulo: `${fmtH(resumo.semAlocacao)} apontadas sem consultor alocado`,
      detalhe: `${fmtPct(frac)} do executado sem dono no item.`,
      alvo: { tipo: "aba", aba: "qualidade" },
      acaoSugerida: "Corrigir a alocação dos itens com apontamento sem consultor",
    });
  }

  const semInicio = propostas.filter((p) => p.sitpro === 4 && p.executado === 0);
  if (semInicio.length > 0) {
    const horas = semInicio.reduce((t, p) => t + p.vendido, 0);
    alertas.push({
      severidade: "off",
      rotulo: "Agenda",
      peso: horas * 0.3,
      titulo: `${semInicio.length} proposta${semInicio.length > 1 ? "s" : ""} aprovada${semInicio.length > 1 ? "s" : ""} sem início`,
      detalhe: `${fmtH(horas)} vendidas aguardando agendamento.`,
      alvo: { tipo: "aba", aba: "propostas", filtro: "naoini" },
      acaoSugerida: "Agendar o início das propostas aprovadas",
    });
  }

  return ordenarAlertas(alertas);
}

// Crítico primeiro, depois por peso (impacto em horas). Exportada porque a rota ainda acrescenta o alerta de ações
// atrasadas (que vem do banco, não da conta de horas) e precisa reordenar.
export function ordenarAlertas(alertas: Alerta[]): Alerta[] {
  return [...alertas].sort((a, b) => Number(b.severidade === "bad") - Number(a.severidade === "bad") || b.peso - a.peso);
}
