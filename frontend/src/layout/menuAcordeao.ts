// Menu lateral em acordeão (04/11/2026, regra do Vitor trazida do CaxHub_Dash): abrir um grupo fecha o que estava aberto no MESMO nível,
// nos grupos de topo (Financeiro a Receber, Gestão de Projetos…) e nos subgrupos de um mesmo grupo (ex.: Comercial › Gestão de Metas).
// O subgrupo aberto fica guardado quando o grupo pai fecha: reabrindo o pai, ele volta como estava. Funções puras, com teste.

/** Grupo/subgrupo → os rótulos do mesmo nível (ele incluso). */
export type IrmaosDoMenu = ReadonlyMap<string, readonly string[]>;

/** Monta os níveis do menu: os grupos de topo entre si e, dentro de cada grupo, os seus subgrupos entre si. */
export function irmaosDoMenu(grupos: readonly { label: string; subgrupos: readonly string[] }[]): IrmaosDoMenu {
  const mapa = new Map<string, readonly string[]>();
  const topo = grupos.map((g) => g.label);
  for (const g of grupos) {
    mapa.set(g.label, topo);
    for (const s of g.subgrupos) mapa.set(s, g.subgrupos);
  }
  return mapa;
}

/** Abre `rotulo` fechando os irmãos dele (só do mesmo nível: subgrupos de outros grupos ficam guardados). */
export function abrirNoAcordeao(abertos: ReadonlySet<string>, rotulo: string, irmaos: IrmaosDoMenu): Set<string> {
  const proximo = new Set(abertos);
  for (const irmao of irmaos.get(rotulo) ?? []) if (irmao !== rotulo) proximo.delete(irmao);
  proximo.add(rotulo);
  return proximo;
}

/** Clique no grupo: aberto fecha; fechado abre em acordeão. */
export function alternarNoAcordeao(abertos: ReadonlySet<string>, rotulo: string, irmaos: IrmaosDoMenu): Set<string> {
  if (!abertos.has(rotulo)) return abrirNoAcordeao(abertos, rotulo, irmaos);
  const proximo = new Set(abertos);
  proximo.delete(rotulo);
  return proximo;
}

/** Abre o caminho da tela atual (grupo e, se houver, subgrupo), em acordeão. Devolve o mesmo Set quando nada muda. */
export function abrirCaminho(abertos: ReadonlySet<string>, caminho: readonly string[], irmaos: IrmaosDoMenu): ReadonlySet<string> {
  const proximo = caminho.reduce<ReadonlySet<string>>((atual, rotulo) => abrirNoAcordeao(atual, rotulo, irmaos), abertos);
  const igual = proximo.size === abertos.size && [...proximo].every((r) => abertos.has(r));
  return igual ? abertos : proximo;
}
