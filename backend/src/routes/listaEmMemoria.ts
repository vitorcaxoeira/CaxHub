import type { Request, Response, Router } from "express";
import { ErroEntradaConsulta } from "../consultas/consultaColunas";
import { type ColunaMemoria, type Linha, paginaDaLista, prepararLista, resumoDaLista, valoresDaLista } from "../consultas/listaEmMemoria";
import { lerInteiro } from "./parametrosConsulta";

// Lista de uma tela com filtro e ordem por coluna, resumo no rodapé e colunas calculadas, aplicados EM MEMÓRIA sobre as linhas que a rota já
// monta (03/11/2026). Mesmo contrato de registrarListaConsultavel (o frontend usa ListaServidor nos dois casos):
//   GET <caminho>          { colunas, calculadasComProblema, itens, total, totais, page, pageSize }
//   GET <caminho>/resumo   rodapé sobre TODAS as linhas do filtro
//   GET <caminho>/valores  aba "Valores" do funil
// Para telas que leem com Prisma e regra de acesso: `carregar` devolve as linhas JÁ recortadas pela permissão e pelos filtros do topo, na
// ordem padrão da tela. O recorte de permissão continua todo dentro da rota.

export interface ListaEmMemoria {
  linhas: Linha[];
  colunas: ColunaMemoria[];
  /** Colunas numéricas somadas sobre todas as linhas do filtro (o total do cabeçalho/rodapé da tela); voltam em `totais`. */
  totais?: string[];
  /** Campos a mais na resposta da lista (ex.: KPIs por status), calculados pela rota sobre o recorte dela. */
  extras?: Record<string, unknown>;
  pageSizePadrao?: number;
}

const MAX_PAGINA = 200;

function erroHttp(res: Response, erro: unknown, rotulo: string) {
  if (erro instanceof ErroEntradaConsulta) return res.status(erro.status).json({ error: erro.message });
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  console.error(`[lista-memoria:${rotulo}]`, mensagem);
  return res.status(500).json({ error: mensagem });
}

export function registrarListaEmMemoria(
  router: Router,
  caminho: string,
  carregar: (req: Request) => Promise<ListaEmMemoria>,
  rotulo: string,
) {
  const sub = (s: string) => (caminho === "/" ? s : `${caminho}${s}`);
  // Registradas ANTES da lista: num router com `/:id`, o `/resumo` e o `/valores` não podem cair na rota de detalhe.
  router.get(sub("/resumo"), async (req, res) => {
    try {
      const lista = await carregar(req);
      res.json(resumoDaLista(prepararLista(lista.colunas, lista.linhas, req.query as Record<string, unknown>), req.query as Record<string, unknown>));
    } catch (erro) {
      erroHttp(res, erro, `${rotulo}-resumo`);
    }
  });

  router.get(sub("/valores"), async (req, res) => {
    try {
      const q = req.query as Record<string, unknown>;
      const lista = await carregar(req);
      res.json(valoresDaLista(prepararLista(lista.colunas, lista.linhas, q), typeof q.coluna === "string" ? q.coluna : "", typeof q.termo === "string" ? q.termo : ""));
    } catch (erro) {
      erroHttp(res, erro, `${rotulo}-valores`);
    }
  });

  router.get(caminho, async (req, res) => {
    try {
      const q = req.query as Record<string, unknown>;
      const lista = await carregar(req);
      const page = lerInteiro(q.page, 1, 1, 100000);
      const pageSize = lerInteiro(q.pageSize, lista.pageSizePadrao ?? 50, 1, MAX_PAGINA);
      res.json({ ...(lista.extras ?? {}), ...paginaDaLista(prepararLista(lista.colunas, lista.linhas, q), { page, pageSize, totais: lista.totais }) });
    } catch (erro) {
      erroHttp(res, erro, rotulo);
    }
  });
}
