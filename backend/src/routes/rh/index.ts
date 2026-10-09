import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { requireAuth, requireRole } from "../../auth/middleware";
import { prisma } from "../../db/prisma";
import { FiltroRh, lerFiltro, veIndividual } from "../../domain/rh/filtros";
import { TIPO_COLABORADOR } from "../../domain/rh/dominios";
import { quadro } from "../../domain/rh/quadro";
import { folha } from "../../domain/rh/folha";
import { rescisoes } from "../../domain/rh/rescisoes";
import { reajustes } from "../../domain/rh/reajustes";
import { turnover } from "../../domain/rh/turnover";
import { absenteismo } from "../../domain/rh/absenteismo";
import { ponto } from "../../domain/rh/ponto";
import { jornada } from "../../domain/rh/jornada";
import { ferias } from "../../domain/rh/ferias";
import { dre } from "../../domain/rh/dre";

// Módulo RH (Senior HCM): todas as telas leem do espelho local (hcm_*), nunca do Senior ao vivo.
// Só o admin acessa (dado sensível: folha, salário individual, rescisão) e ele vê tudo, inclusive nome e
// valor individual. Um papel só-agregado, se vier, usa a supressão de grupos pequenos de domain/rh/comum.ts.
export const rhRouter = Router();
rhRouter.use(requireAuth, requireRole("admin"));

function handleError(res: Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[rh:${label}]`, message);
  res.status(500).json({ error: message });
}

// Telas que medem a jornada CLT (ponto, absenteísmo, férias): sem escolha do usuário, só empregados.
// Terceiros e parceiros não têm férias por período aquisitivo e o ponto deles distorce o índice (na
// Soeltech, os "terceiros" têm 67% de ausência por falta lançada sem escala real).
const SO_EMPREGADOS = [1];

type Calculo = (f: FiltroRh, individual: boolean) => Promise<object>;

function tela(caminho: string, rotulo: string, calcular: Calculo, tipcolPadrao?: number[]) {
  rhRouter.get(caminho, async (req: Request, res: Response) => {
    try {
      const f = lerFiltro(req, tipcolPadrao);
      const individual = veIndividual(req);
      const dados = await calcular(f, individual);
      res.json({
        ...dados,
        acesso: { individual },
        filtro: { ...f, tipcol: f.tipcol ?? null },
      });
    } catch (error) {
      handleError(res, error, rotulo);
    }
  });
}

tela("/quadro", "quadro", quadro);
tela("/folha", "folha", folha);
tela("/rescisoes", "rescisoes", rescisoes);
tela("/reajustes", "reajustes", reajustes);
tela("/turnover", "turnover", turnover);
tela("/absenteismo", "absenteismo", absenteismo, SO_EMPREGADOS);
tela("/ponto", "ponto", ponto, SO_EMPREGADOS);
tela("/jornada", "jornada", jornada, SO_EMPREGADOS);
tela("/ferias", "ferias", ferias, SO_EMPREGADOS);
tela("/dre", "dre", dre, SO_EMPREGADOS);

// GET /filtros: opções do filtro único + até onde os dados vão. Centros de custo, locais e cargos
// aparecem só se há (ou houve) colaborador neles.
rhRouter.get("/filtros", async (_req, res) => {
  try {
    const [empresas, filiais, centros, locais, cargos, limites, sync] = await Promise.all([
      prisma.$queryRaw<{ valor: number; rotulo: string }[]>(Prisma.sql`
        SELECT e.numemp AS valor, COALESCE(NULLIF(btrim(e.apeemp), ''), btrim(e.nomemp)) AS rotulo FROM hcm_empresas e ORDER BY 2`),
      prisma.$queryRaw<{ valor: number; empresa: number; rotulo: string }[]>(Prisma.sql`
        SELECT fl.codfil AS valor, fl.numemp AS empresa, COALESCE(NULLIF(btrim(fl.nomfil), ''), btrim(fl.razsoc)) AS rotulo FROM hcm_filiais fl ORDER BY 3`),
      prisma.$queryRaw<{ valor: string; empresa: number; rotulo: string }[]>(Prisma.sql`
        SELECT cc.codccu AS valor, cc.numemp AS empresa, COALESCE(NULLIF(btrim(cc.nomccu), ''), cc.codccu) AS rotulo
        FROM hcm_centros_custo cc WHERE EXISTS (SELECT 1 FROM hcm_colaboradores c WHERE c.numemp = cc.numemp AND c.codccu = cc.codccu) ORDER BY 3`),
      prisma.$queryRaw<{ valor: number; rotulo: string }[]>(Prisma.sql`
        SELECT l.numloc AS valor, COALESCE(NULLIF(btrim(l.nomloc), ''), l.numloc::text) AS rotulo
        FROM hcm_locais l WHERE EXISTS (SELECT 1 FROM hcm_colaboradores c WHERE c.taborg = l.taborg AND c.numloc = l.numloc) ORDER BY 2`),
      prisma.$queryRaw<{ valor: string; rotulo: string }[]>(Prisma.sql`
        SELECT (ca.estcar::text || ':' || ca.codcar) AS valor, COALESCE(NULLIF(btrim(ca.titred), ''), ca.codcar) AS rotulo
        FROM hcm_cargos ca WHERE EXISTS (SELECT 1 FROM hcm_colaboradores c WHERE c.estcar = ca.estcar AND c.codcar = ca.codcar) ORDER BY 2`),
      prisma.$queryRaw<{ primeira_admissao: Date | null; ultima_apuracao: Date | null; ultima_competencia: Date | null }[]>(Prisma.sql`
        SELECT (SELECT min(datadm) FROM hcm_colaboradores) AS primeira_admissao,
               (SELECT max(datapu) FROM hcm_apuracao_ponto) AS ultima_apuracao,
               (SELECT max(perref) FROM hcm_calculos_folha WHERE sitcal IN ('T', 'P')) AS ultima_competencia`),
      prisma.$queryRaw<{ ultima: Date | null }[]>(Prisma.sql`
        SELECT max("runAt") AS ultima FROM "SyncLog" WHERE "jobName" LIKE 'hcm-%' AND status = 'success'`),
    ]);
    res.json({
      empresas,
      filiais,
      centrosDeCusto: centros,
      locais,
      cargos,
      tiposDeColaborador: Object.entries(TIPO_COLABORADOR).map(([valor, rotulo]) => ({ valor: Number(valor), rotulo })),
      dados: {
        primeiraAdmissao: limites[0]?.primeira_admissao ?? null,
        ultimaApuracaoDePonto: limites[0]?.ultima_apuracao ?? null,
        ultimaCompetenciaDeFolha: limites[0]?.ultima_competencia ?? null,
        ultimaSincronizacao: sync[0]?.ultima ?? null,
      },
    });
  } catch (error) {
    handleError(res, error, "filtros");
  }
});
