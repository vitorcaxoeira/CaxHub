import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../ui/Toast";
import { formatarValorDado } from "./TabelaDadosImportados";
import type { ColunaApi } from "./ThColuna";
import type { DefColuna } from "./useColunasConfiguraveis";
import type { FuncaoResumo } from "./resumo";

/**
 * Campos de tabelas relacionadas como colunas (12/11/2026, par de consultas/camposRelacionados.ts no backend): além das colunas que a tela declara,
 * a pessoa liga qualquer campo da tabela da lista e das relacionadas (ex.: Gestão Propostas -> campos da proposta e do cliente). Os NOMES ligados
 * ficam no servidor, por usuário e por lista (GET/PUT /api/perfil/campos-extras/:chave, mesma chave da arrumação das colunas); vão como `campos`
 * em toda chamada da lista (página, resumo, valores, CSV, PDF), e a resposta traz a descrição de cada coluna extra (`fonte`), de onde saem as
 * `DefColuna` genéricas daqui. O catálogo para escolher (GET `<url>/campos`) só é buscado quando a pessoa abre "Mais campos" ou já tem campos
 * ligados (para os títulos do dicionário do Senior). Só funciona em lista cuja rota declara `fontes` (ListaConsultavel.fontes).
 */

export interface CampoDoCatalogo {
  nome: string;
  tipo: ColunaApi["tipo"];
  /** Descrição do dicionário do Senior ("Nome fantasia do cliente"); sem ele, o nome técnico do campo. */
  titulo: string;
  descritivo: boolean;
  dominio?: { valor: string; rotulo: string }[];
}

export interface FonteDoCatalogo {
  id: string;
  titulo: string;
  campos: CampoDoCatalogo[];
}

/** O que o painel "Colunas" precisa para oferecer "Mais campos". */
export interface ExtrasDoPainel {
  /** Catálogo por fonte; null enquanto não buscou. */
  fontes: FonteDoCatalogo[] | null;
  carregando: boolean;
  erro: string | null;
  /** Nomes (`<fonte>__<campo>`) ligados como coluna. */
  selecionados: ReadonlySet<string>;
  /** Busca o catálogo (uma vez). */
  carregar: () => void;
  /** Liga (no fim da lista de colunas) ou desliga o campo. */
  alternar: (nome: string) => void;
}

const RESUMOS_CODIGO: FuncaoResumo[] = ["contagem", "vazios"];
const SEM_CAMPOS: string[] = [];

/** Valor de um campo extra na célula: domínio como "código · rótulo", data em dd/mm/aaaa, decimal em pt-BR, sim/não. */
export function formatarCampoExtra(valor: unknown, coluna: Pick<ColunaApi, "tipo" | "dominio">): string {
  if (coluna.tipo === "decimal" && !coluna.dominio && valor != null && Number.isFinite(Number(valor))) {
    return Number(valor).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  }
  return formatarValorDado(valor, coluna);
}

export function useCamposRelacionados<T>({
  chave,
  url,
  params,
  ativo,
  colunas,
  aoRemover,
}: {
  /** Chave da arrumação das colunas da lista (a mesma de useColunasConfiguraveis). */
  chave: string;
  url: string;
  /** Filtros do topo da tela: a rota `<url>/campos` monta a lista antes de descrever o catálogo, e algumas telas exigem parâmetros. */
  params: Record<string, unknown>;
  ativo: boolean;
  /** `colunas` da última resposta da lista. */
  colunas: ColunaApi[] | undefined;
  /** Chamado ao desligar um campo: a tela larga o filtro e a ordem que ainda citam a coluna (o servidor recusaria o pedido). */
  aoRemover?: (nome: string) => void;
}) {
  const { mostrar } = useToast();
  const [campos, setCampos] = useState<string[]>(SEM_CAMPOS);
  // Sem a função ligada não há o que esperar.
  const [pronto, setPronto] = useState(!ativo);
  const [fontes, setFontes] = useState<FonteDoCatalogo[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const urlPreferencia = `/api/perfil/campos-extras/${encodeURIComponent(chave)}`;

  useEffect(() => {
    if (!ativo) return;
    let cancelado = false;
    setPronto(false);
    axios
      .get<{ campos: string[] }>(urlPreferencia)
      .then(({ data }) => !cancelado && setCampos(data.campos))
      // Sem a preferência a lista abre sem campos extras; não vale incomodar com aviso.
      .catch(() => undefined)
      .finally(() => !cancelado && setPronto(true));
    return () => {
      cancelado = true;
    };
  }, [ativo, urlPreferencia]);

  const paramsDoCatalogo = JSON.stringify(params);
  const carregar = useCallback(() => {
    if (!ativo || fontes || carregando) return;
    setCarregando(true);
    setErro(null);
    axios
      .get<{ fontes: FonteDoCatalogo[] }>(`${url}/campos`, { params: JSON.parse(paramsDoCatalogo) })
      .then(({ data }) => setFontes(data.fontes))
      .catch((e) => setErro(axios.isAxiosError(e) ? (e.response?.data?.error ?? "Não foi possível carregar os campos") : "Não foi possível carregar os campos"))
      .finally(() => setCarregando(false));
  }, [ativo, fontes, carregando, url, paramsDoCatalogo]);

  // Já tem campo ligado: busca o catálogo para os títulos do dicionário (a lista funciona sem ele, só com o nome técnico).
  const temCampos = campos.length > 0;
  useEffect(() => {
    if (pronto && temCampos && !fontes && !erro) carregar();
  }, [pronto, temCampos, fontes, erro, carregar]);

  const alternar = useCallback(
    (nome: string) => {
      const removendo = campos.includes(nome);
      const proximo = removendo ? campos.filter((c) => c !== nome) : [...campos, nome];
      setCampos(proximo);
      if (removendo) aoRemover?.(nome);
      axios.put(urlPreferencia, { campos: proximo }).catch(() => mostrar("Não foi possível guardar os campos escolhidos", "warning"));
    },
    [campos, aoRemover, urlPreferencia, mostrar],
  );

  const selecionados = useMemo(() => new Set(campos), [campos]);
  const catalogo = useMemo(() => {
    const campo = new Map<string, CampoDoCatalogo>();
    const fonte = new Map<string, string>();
    for (const f of fontes ?? []) {
      fonte.set(f.id, f.titulo);
      for (const c of f.campos) campo.set(c.nome, c);
    }
    return { campo, fonte };
  }, [fontes]);

  const defs = useMemo<DefColuna<T, unknown>[]>(
    () =>
      (colunas ?? [])
        .filter((c) => c.fonte && selecionados.has(c.nome))
        .map((c) => {
          const info = catalogo.campo.get(c.nome);
          const fonteTitulo = catalogo.fonte.get(c.fonte!) ?? c.fonte!;
          const campoTitulo = info?.titulo ?? c.titulo ?? c.nome;
          const numerica = (c.tipo === "inteiro" || c.tipo === "decimal") && !c.dominio;
          const formatar = (v: unknown) => formatarCampoExtra(v, c);
          const valor = (l: T) => formatar((l as Record<string, unknown>)[c.nome]);
          return {
            nome: c.nome,
            titulo: `${fonteTitulo} · ${campoTitulo}`,
            dica: `${fonteTitulo}: ${campoTitulo} (${c.nome.split("__")[1]})`,
            direita: numerica,
            largura: c.dominio ? 200 : c.tipo === "data" ? 110 : numerica ? 110 : 160,
            classe: numerica ? "tabular-nums text-sm text-foreground" : "text-sm text-foreground",
            texto: valor,
            title: valor,
            render: valor,
            formatarValor: formatar,
            resumos: c.dominio ? RESUMOS_CODIGO : undefined,
          };
        }),
    [colunas, selecionados, catalogo],
  );

  const painel = useMemo<ExtrasDoPainel>(
    () => ({ fontes, carregando, erro, selecionados, carregar, alternar }),
    [fontes, carregando, erro, selecionados, carregar, alternar],
  );

  return {
    /** A lista só deve buscar depois que os campos salvos chegaram (senão a primeira busca vem sem eles e a tela pisca). */
    pronto,
    /** Valor do parâmetro `campos` (undefined = nenhum). */
    param: campos.length > 0 ? campos.join(",") : undefined,
    defs,
    painel: ativo ? painel : undefined,
  };
}
