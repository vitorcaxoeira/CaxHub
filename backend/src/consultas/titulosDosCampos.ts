// Títulos legíveis dos campos de uma tabela espelhada, vindos do dicionário de dados do Senior (`desfld`, ex.: "Nome do Cliente"). Reusa o cache
// de 12 h do catálogo de campos (sync/catalogoCampos.ts: mesma chave), então a segunda pessoa a abrir "Mais campos" não paga o SOAP.
// O dicionário é enfeite: sem resposta (ERP fora, tabela sem job, demora) a lista segue com o nome do campo.

const ESPERA_MAXIMA_MS = 8000;

/** `{ nomeDaColunaNoPostgres: descrição }` da tabela local; vazio quando o Senior não responde ou nenhum job espelha a tabela. */
export async function titulosDaTabela(tabelaLocal: string): Promise<Record<string, string>> {
  try {
    // Import tardio: o registry puxa todos os jobs de sync (e o ciclo registry -> jobs -> filtrosAtivos já derrubou o boot uma vez).
    // Os módulos SOAP também ficam em import tardio: listaConsultavel.ts (e o teste dele) não deve exigir a configuração do ERP só para carregar.
    const { TODOS_OS_SYNC_JOBS } = await import("../sync/registry");
    const { comCache } = await import("../soap/metadataCache");
    const { getTableFields } = await import("../soap/metadata");
    const job = TODOS_OS_SYNC_JOBS.find((j) => j.tabelaLocal === tabelaLocal && j.temDicionario);
    if (!job) return {};
    const campos = await Promise.race([
      comCache(`campos:${job.sistema}:${job.tabelaSenior}`, () => getTableFields(job.tabelaSenior, job.sistema)),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ESPERA_MAXIMA_MS)),
    ]);
    if (!campos) return {};
    const descricao = new Map(campos.map((c) => [c.fldnam.toLowerCase(), (c.desfld ?? "").trim()]));
    const saida: Record<string, string> = {};
    for (const c of job.colunas) {
      const d = descricao.get(c.origem.toLowerCase());
      if (d) saida[c.alias] = d;
    }
    return saida;
  } catch (erro) {
    console.error("[campos-relacionados] dicionário do Senior indisponível:", erro instanceof Error ? erro.message : erro);
    return {};
  }
}
