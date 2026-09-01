// Monta o "Complemento Hist." legível de um lançamento contábil a partir do template guardado
// em E046HPD (espelhado localmente como HistoricoPadrao) — o Senior NÃO grava a frase pronta
// em LancamentoContabil.cpllct, grava só os PARÂMETROS ("607543","Senior Sistemas S.A."), e
// monta o texto na hora de exibir substituindo os placeholders `*NUM`/`*ALF` do template
// (HistoricoPadrao.deshpd, ex. "Vlr. Ref. Compra conf. NF *NUM de *ALF") na ordem em que
// aparecem. A chave de junção é `LancamentoContabil.codhpd` — NÃO `orilct` (o mesmo orilct usa
// códigos de histórico diferentes conforme a rotina exata, cada um com seu próprio número de
// parâmetros; mapeado ao vivo contra o dicionário de dados do Senior em 01/09/2026).
//
// Funções puras — quem chama já busca `HistoricoPadrao` em lote (nunca aqui, pra não virar
// N+1 numa lista de lançamentos) e passa o template já resolvido.

// "607543","Senior Sistemas S.A." -> ["607543", "Senior Sistemas S.A."]. Aspas duplicadas
// escapadas dentro de um parâmetro (convenção CSV: `""` = `"` literal) são desfeitas.
export function parseParametrosHistorico(cpllct: string): string[] {
  const parametros: string[] = [];
  let atual = "";
  let dentroDeAspas = false;
  for (let i = 0; i < cpllct.length; i++) {
    const c = cpllct[i];
    if (dentroDeAspas) {
      if (c === '"') {
        if (cpllct[i + 1] === '"') {
          atual += '"';
          i++;
        } else {
          dentroDeAspas = false;
        }
      } else {
        atual += c;
      }
    } else if (c === '"') {
      dentroDeAspas = true;
    } else if (c === ",") {
      parametros.push(atual);
      atual = "";
    }
    // Caractere fora de aspas que não seja vírgula (ex. espaço entre parâmetros) é ignorado —
    // não deveria existir no formato real, mas não é motivo pra quebrar o parse.
  }
  parametros.push(atual);
  return parametros;
}

// *NUM (numérico), *ALF (alfanumérico), *DMA (data) confirmados ao vivo contra amostra real de
// E046HPD/E640LCT em 01/09/2026. Um tipo de placeholder não coberto aqui não quebra nada — só
// faz `montarHistorico` cair no fallback (cpllct cru) por contagem não bater, nunca mostra
// texto errado.
const PLACEHOLDER = /\*NUM|\*ALF|\*DMA/g;

// Substitui os placeholders do template pelos parâmetros, na ordem em que aparecem no texto —
// a distinção NUM/ALF é só validação de entrada no Senior, não muda a substituição em si.
// `null` = contagem de parâmetros não bate com o template (não dá pra montar com segurança);
// quem chama cai pro `cpllct` cru nesse caso, nunca mostra um texto incorreto.
export function montarHistorico(template: string, parametros: string[]): string | null {
  const placeholders = template.match(PLACEHOLDER) ?? [];
  if (placeholders.length !== parametros.length) return null;
  let indice = 0;
  return template.replace(PLACEHOLDER, () => parametros[indice++]);
}

// Ponto de entrada único: recebe o `cpllct` cru e o template JÁ BUSCADO (undefined/null se o
// lançamento não tem `codhpd` ou o código não foi achado em HistoricoPadrao) e devolve o texto
// final com todo fallback já decidido — nunca lança, nunca mostra texto errado.
export function formatarHistorico(cpllct: string | null, deshpd: string | undefined | null): string | null {
  if (cpllct == null) return null;
  if (!deshpd) return cpllct;
  return montarHistorico(deshpd, parseParametrosHistorico(cpllct)) ?? cpllct;
}
