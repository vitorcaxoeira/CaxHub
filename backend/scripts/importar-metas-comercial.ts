// Importa metas e realizado do Comercial de um JSON (extraído da planilha META <ano>.xlsx) para a Gestão de Metas.
// Idempotente: roda de novo e só atualiza; cria o ano se não existir; NÃO apaga nada que já esteja lançado.
// Rodar: node_modules/.bin/ts-node --transpile-only scripts/importar-metas-comercial.ts <arquivo.json> [--gravar]
// Sem --gravar é só ensaio: valida e mostra o que faria. Formato do JSON:
//   { ano, empresa:[{codigo, metaAnual}],
//     participantes:[{codusu, funcao?, indicadores:[{codigo, rotulo?}], metaAnual?:{<codigo>: valor}, mesesDaMeta?:[meses],
//                     lancamentos:[{codigo, mes, meta|null, realizado|null, observacao?}]}],
//     naoAtribuido:{ indicadores:[...], lancamentos:[...] } }
// `metaAnual` da pessoa é distribuída pelos pesos do ano (nos `mesesDaMeta`, padrão o ano todo) e preenche só as metas mensais que o JSON
// não trouxe. O JSON tem dado real da empresa: fica fora do repositório.
import "dotenv/config";
import { readFileSync } from "fs";
import { prisma } from "../src/db/prisma";
import { nomeConsultor } from "../src/domain/contextoProjeto";
import { distribuirPorPesos, mesesDe, PESOS_PADRAO } from "../src/domain/metasComercial/calculo";

interface Lanc {
  codigo: string;
  mes: number;
  meta?: number | null;
  realizado?: number | null;
  observacao?: string | null;
}
interface IndPessoa {
  codigo: string;
  rotulo?: string;
}
interface Entrada {
  ano: number;
  empresa: Array<{ codigo: string; metaAnual: number | null }>;
  participantes: Array<{ codusu: number; funcao?: string; indicadores: IndPessoa[]; metaAnual?: Record<string, number | null>; mesesDaMeta?: number[]; lancamentos: Lanc[] }>;
  naoAtribuido: { indicadores: IndPessoa[]; lancamentos: Lanc[] };
}

async function main() {
  const [arquivo, ...flags] = process.argv.slice(2);
  if (!arquivo) throw new Error("Informe o arquivo JSON");
  const gravar = flags.includes("--gravar");
  const e: Entrada = JSON.parse(readFileSync(arquivo, "utf-8"));

  const admin = await prisma.user.findFirst({ where: { role: { name: "admin" }, status: "ativo" }, orderBy: { id: "asc" }, select: { id: true } });
  if (!admin) throw new Error("sem usuário admin para registrar a autoria");
  const inds = new Map((await prisma.metaComercialIndicador.findMany()).map((i) => [i.codigo, i]));
  const ind = (codigo: string) => {
    const i = inds.get(codigo);
    if (!i) throw new Error(`indicador desconhecido: ${codigo}`);
    return i;
  };

  console.log(`${gravar ? "GRAVANDO" : "ENSAIO"} — ano ${e.ano}`);
  await prisma.$transaction(
    async (tx) => {
      await tx.metaComercialAno.upsert({
        where: { ano: e.ano },
        create: { ano: e.ano, pesosMensais: PESOS_PADRAO, criadoPor: admin.id },
        update: {},
      });
      const ano = await tx.metaComercialAno.findUniqueOrThrow({ where: { ano: e.ano } });
      const pesos = ano.pesosMensais.map(Number);

      for (const m of e.empresa) {
        if (m.metaAnual == null) continue;
        await tx.metaComercialEmpresa.upsert({
          where: { ano_indicadorId: { ano: e.ano, indicadorId: ind(m.codigo).id } },
          create: { ano: e.ano, indicadorId: ind(m.codigo).id, metaAnual: m.metaAnual },
          update: { metaAnual: m.metaAnual },
        });
      }
      console.log(`  metas da empresa: ${e.empresa.filter((m) => m.metaAnual != null).length}`);

      async function pessoa(id: number, indicadores: IndPessoa[], lancs: Lanc[]) {
        for (const [ordem, i] of indicadores.entries()) {
          await tx.metaComercialParticipanteIndicador.upsert({
            where: { participanteId_indicadorId: { participanteId: id, indicadorId: ind(i.codigo).id } },
            create: { participanteId: id, indicadorId: ind(i.codigo).id, rotulo: i.rotulo ?? null, ordem },
            update: { rotulo: i.rotulo ?? null, ordem },
          });
        }
        for (const l of lancs) {
          const meta = l.meta ?? null;
          const realizado = l.realizado ?? null;
          await tx.metaComercialLancamento.upsert({
            where: { participanteId_indicadorId_mes: { participanteId: id, indicadorId: ind(l.codigo).id, mes: l.mes } },
            create: { participanteId: id, indicadorId: ind(l.codigo).id, mes: l.mes, meta, realizado, observacao: l.observacao ?? null, lancadoPor: admin.id },
            // Só sobrescreve o que o JSON informou; o que a gestora já ajustou na tela e o JSON não traz fica como está.
            update: { ...(l.meta !== undefined && l.meta !== null ? { meta } : {}), ...(realizado !== null ? { realizado } : {}), ...(l.observacao ? { observacao: l.observacao } : {}), lancadoPor: admin.id, lancadoEm: new Date() },
          });
        }
      }

      let ordem = 0;
      for (const p of e.participantes) {
        const consultor = await tx.consultor.findFirst({ where: { codusu: p.codusu } });
        if (!consultor?.codfor) throw new Error(`consultor codusu ${p.codusu} sem codfor`);
        const nome = nomeConsultor(consultor);
        const part = await tx.metaComercialParticipante.upsert({
          where: { ano_codfor: { ano: e.ano, codfor: consultor.codfor } },
          create: { ano: e.ano, codfor: consultor.codfor, nome, funcao: p.funcao ?? null, ordem: ++ordem },
          update: { funcao: p.funcao ?? null },
        });
        // Metas mensais da pessoa: distribuídas pelos pesos, só onde o JSON não trouxe meta.
        const lancs = p.lancamentos.map((l) => ({ ...l }));
        for (const [codigo, valor] of Object.entries(p.metaAnual ?? {})) {
          if (valor == null) continue;
          const meses = distribuirPorPesos(valor, pesos, p.mesesDaMeta);
          for (const mes of p.mesesDaMeta ?? mesesDe(1, 12)) {
            const existente = lancs.find((l) => l.codigo === codigo && l.mes === mes);
            if (existente) existente.meta = existente.meta ?? meses[mes - 1];
            else lancs.push({ codigo, mes, meta: meses[mes - 1], realizado: null });
          }
        }
        await pessoa(part.id, p.indicadores, lancs);
        console.log(`  ${nome}: ${p.indicadores.length} indicadores, ${lancs.length} lançamentos`);
      }
      const na = await tx.metaComercialParticipante.findFirst({ where: { ano: e.ano, naoAtribuido: true } });
      const naId =
        na?.id ??
        (await tx.metaComercialParticipante.create({ data: { ano: e.ano, codfor: null, nome: "Não atribuído", naoAtribuido: true, ordem: 999 } })).id;
      await pessoa(naId, e.naoAtribuido.indicadores, e.naoAtribuido.lancamentos);
      console.log(`  Não atribuído: ${e.naoAtribuido.lancamentos.length} lançamentos`);

      if (!gravar) throw new Error("ENSAIO_OK");
    },
    { timeout: 60000 }
  ).catch((err) => {
    if (err instanceof Error && err.message === "ENSAIO_OK") {
      console.log("Ensaio concluído: nada foi gravado (use --gravar).");
      return;
    }
    throw err;
  });
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
