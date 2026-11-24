// Lista fechada de valores ("domínio" do Senior) documentada no schema.prisma com três barras, ex.:
//   /// Domínio "LSitLot": 1=A Contabilizar, 2=Contabilizado, 3=Excluído, 4=Desativado
// O texto chega em tempo de execução por Prisma.dmmf (field.documentation). Usado pelas telas "Ver dados"/"Removidos" (21/10/2026,
// pedido do Vitor) para o funil oferecer a lista completa e a tabela/chips mostrarem "código · rótulo". Funções puras, com teste.
//
// Formatos encontrados nos 92 campos documentados:
//   - itens separados por vírgula ("1=A, 2=B") ou só por espaço ("9=Digitado 8=Impresso");
//   - comentário de várias linhas, que o dmmf entrega com "\n" LITERAL (barra + n) entre as linhas;
//   - observação final entre parênteses com "=" ("(0 = não classificado, fora do domínio oficial)"), que não é item;
//   - código com zero à esquerda ("08=Consultoria ERP") em coluna inteira, onde o valor gravado é 8;
//   - comentário depois do último item, separado por travessão ("N=Não — indicativo se ...");
//   - só o NOME, sem itens ('Domínio "LSimNao"' ou '"LSitTit": mesmo domínio de TituloReceber.sittit'): resolvido pelo catálogo de
//     domínios montado a partir dos outros campos que definem os itens (catalogoDeDominios).

export interface OpcaoDominio {
  /** Valor como fica no filtro (texto): em coluna inteira, sem zero à esquerda ("08" vira "8"). */
  valor: string;
  rotulo: string;
}

export interface Dominio {
  nome: string;
  opcoes: OpcaoDominio[];
}

interface ItemBruto {
  codigo: string;
  rotulo: string;
}

// Código colado no "=" (sem espaço antes), precedido de início, espaço, vírgula ou ponto e vírgula. "0 = não ..." não casa.
const CODIGO = /(^|[\s,;])([A-Za-z0-9_]{1,12})=(?=\S)/g;

/** Nome do domínio e itens como estão no texto (código ainda sem normalizar). `null` se o texto não declara domínio. */
export function lerDominioBruto(documentation: string | undefined | null): { nome: string; itens: ItemBruto[] } | null {
  if (!documentation) return null;
  const m = /Dom[ií]nio\s+"([^"]+)"\s*:?\s*([\s\S]*)/.exec(documentation);
  if (!m) return null;
  const nome = m[1];
  let resto = m[2].replace(/\\n/g, " ").replace(/\r?\n/g, " ");
  // Observação final entre parênteses com "=" (não é item).
  resto = resto.replace(/\s*\([^()]*=[^()]*\)\s*$/, "");

  const achados: { codigo: string; inicio: number; fimCodigo: number }[] = [];
  for (const a of resto.matchAll(CODIGO)) {
    const inicio = (a.index ?? 0) + a[1].length;
    achados.push({ codigo: a[2], inicio, fimCodigo: inicio + a[2].length + 1 });
  }
  const itens: ItemBruto[] = [];
  achados.forEach((a, i) => {
    const fim = i + 1 < achados.length ? achados[i + 1].inicio : resto.length;
    // Comentário depois do item, separado por travessão, não faz parte do rótulo.
    const rotulo = resto
      .slice(a.fimCodigo, fim)
      .split(/\s[—–]\s/)[0]
      .trim()
      .replace(/[,;]+$/, "")
      .trim();
    if (rotulo) itens.push({ codigo: a.codigo, rotulo });
  });
  return { nome, itens };
}

/** Itens no formato do filtro, pelo tipo do campo: em Int/BigInt o código vira número sem zero à esquerda (e não numérico sai). */
export function normalizarItens(itens: ItemBruto[], tipoPrisma: string): OpcaoDominio[] {
  const inteiro = tipoPrisma === "Int" || tipoPrisma === "BigInt";
  const opcoes: OpcaoDominio[] = [];
  const vistos = new Set<string>();
  for (const { codigo, rotulo } of itens) {
    let valor = codigo;
    if (inteiro) {
      if (!/^-?\d+$/.test(valor)) continue;
      valor = String(Number(valor));
    }
    if (vistos.has(valor)) continue;
    vistos.add(valor);
    opcoes.push({ valor, rotulo });
  }
  return opcoes;
}

export function lerDominio(documentation: string | undefined | null, tipoPrisma: string): Dominio | null {
  const bruto = lerDominioBruto(documentation);
  if (!bruto) return null;
  const opcoes = normalizarItens(bruto.itens, tipoPrisma);
  return opcoes.length > 0 ? { nome: bruto.nome, opcoes } : null;
}

/** Catálogo nome do domínio -> itens, a partir de todos os campos documentados (o primeiro que define itens vence). */
export function catalogoDeDominios(documentacoes: (string | undefined | null)[]): Map<string, ItemBruto[]> {
  const catalogo = new Map<string, ItemBruto[]>();
  for (const doc of documentacoes) {
    const b = lerDominioBruto(doc);
    if (b && b.itens.length > 0 && !catalogo.has(b.nome)) catalogo.set(b.nome, b.itens);
  }
  return catalogo;
}

/** Domínio do campo: os itens do próprio texto ou, se ele só cita o nome, os do catálogo. */
export function dominioDoCampo(documentation: string | undefined | null, tipoPrisma: string, catalogo: Map<string, ItemBruto[]>): Dominio | null {
  const bruto = lerDominioBruto(documentation);
  if (!bruto) return null;
  const itens = bruto.itens.length > 0 ? bruto.itens : catalogo.get(bruto.nome) ?? [];
  const opcoes = normalizarItens(itens, tipoPrisma);
  return opcoes.length > 0 ? { nome: bruto.nome, opcoes } : null;
}
