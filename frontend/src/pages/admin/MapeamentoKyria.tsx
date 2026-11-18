import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "../../components/ui/Skeleton";
import { useToast } from "../../components/ui/Toast";
import { SelectBuscavel, OpcaoBuscavel } from "../../components/ui/SelectBuscavel";
import { faltaPreencher, montarCaminho, queryDaPessoa, urlCompleta, type RecursoDoc } from "../../lib/kyriaCaminho";

// Workflow de mapeamento/tipagem de campos (Administração > Integração Kyria > Mapeamento de
// Campos, 18/09/2026, pedido do Vitor). Antes de qualquer endpoint Kyria virar model Prisma +
// job de sync, o admin faz uma pré-visualização real (uma amostra mínima da API), confere o
// tipo inferido de cada campo ao lado do que o OpenAPI declara, e REGISTRA a decisão: manter ou
// não, que tipo Prisma ganha, e como se chama do nosso lado. Registrar aqui NÃO cria/altera
// tabela nenhuma no Postgres — é uma especificação que o desenvolvedor usa depois pra escrever a
// migração de verdade, à mão, revisada (mesma disciplina de sempre). Página separada da tela de
// Sincronização (deliberadamente simples, sem esse fluxo de várias etapas).

const TIPOS = ["String", "Int", "BigInt", "Float", "Decimal", "Boolean", "DateTime", "Json"] as const;
type TipoCampo = (typeof TIPOS)[number];

// Nome interno SEMPRE snake_case minúsculo, a partir do camelCase de origem (ex.: "statusKey" ->
// "status_key") — pedido do Vitor (18/09/2026): aplicado ao carregar o preview E a cada edição
// manual do campo, nunca aceita o texto cru como veio. O backend normaliza de novo antes de
// gravar (mesma função em syncKyriaMapping.ts) — isso aqui é só feedback imediato pro admin.
function paraSnakeCase(nome: string): string {
  return nome
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

// Resposta de GET /api/sync-kyria/mapping/openapi-resources: os GETs da DOCUMENTAÇÃO da API do Kyria (openapi.json lido ao vivo), cada um com os
// mapeamentos já registrados que casam com ele.
interface DocKyria {
  baseUrl: string;
  docsUrl: string;
  versaoDoc: string | null;
  recursos: RecursoDoc[];
  registradosForaDaDoc: { resourceId: number; resourcePath: string; displayName: string }[];
}

interface CampoInternoModelo {
  nome: string;
  tipo: string;
  ehChavePrimaria: boolean;
}

interface ModeloInterno {
  nome: string;
  tabela: string | null;
  campos: CampoInternoModelo[];
}

interface CampoPreview {
  nomeOrigem: string;
  ordem: number;
  tipoInferidoAmostra: string;
  tipoSugerido: string;
  valorExemplo: string;
  tipoOpenApi: string | null;
  nullableOpenApi: boolean | null;
  enumOpenApi: string[] | null;
}

interface ResourcePreview {
  path: string;
  /** URL completa exatamente como o servidor chamou (com limit=1 e as datas do mês corrente quando o sistema preenche). */
  urlChamada: string;
  amostraBruta: unknown;
  campos: CampoPreview[];
}

interface CampoEditavel {
  // null = campo INTERNO — não existe na resposta do Kyria, só do nosso lado (ex.: FK pra outra
  // tabela do CaxHub). Nasce assim pelo botão "Adicionar campo interno", nunca pelo preview.
  nomeOrigem: string | null;
  ordem: number;
  manter: boolean;
  tipoEscolhido: TipoCampo;
  nomeInterno: string;
  nullable: boolean;
  // Tamanho de String (@db.VarChar) — null = sem limite (TEXT). Só usado quando tipoEscolhido
  // = "String".
  tamanho: number | null;
  // Precisão/escala de Decimal (@db.Decimal(precisao, escala)) — só usados quando tipoEscolhido
  // = "Decimal".
  precisao: number | null;
  escala: number | null;
  tipoInferidoAmostra: string | null;
  valorExemplo: string | null;
  tipoOpenApi: string | null;
  nullableOpenApi: boolean | null;
  enumOpenApi: string[] | null;
  // Documentação de relacionamento (opcional, qualquer campo) — "este campo é pensado como FK
  // pra relacionamentoModelo.relacionamentoCampo" no schema real. Não cria FK nenhuma sozinho.
  relacionamentoModelo: string | null;
  relacionamentoCampo: string | null;
  // Campo escalar do mesmo relacionamentoModelo usado como rótulo legível ("123 — ACME LTDA")
  // na tela "Ver dados" — opcional, só faz sentido quando relacionamentoModelo já está definido.
  relacionamentoCampoDescricao: string | null;
}

interface RecursoRegistrado {
  id: number;
  resourcePath: string;
  displayName: string;
  totalCampos: number;
  atualizadoEm: string;
}

interface RecursoDetalhe {
  id: number;
  resourcePath: string;
  displayName: string;
  campos: (CampoEditavel & { id: number })[];
}

function ehTipoObjetoOuArray(tipoInferido: string | null): boolean {
  return tipoInferido === "object" || tipoInferido === "array";
}

function campoPreviewParaEditavel(campo: CampoPreview): CampoEditavel {
  return {
    nomeOrigem: campo.nomeOrigem,
    ordem: campo.ordem,
    manter: true,
    tipoEscolhido: ehTipoObjetoOuArray(campo.tipoInferidoAmostra) ? "Json" : (campo.tipoSugerido as TipoCampo),
    nomeInterno: paraSnakeCase(campo.nomeOrigem),
    // Nulo/desconhecido no OpenAPI vira "assume nullable" (mais seguro deixar o admin apertar
    // pra NOT NULL explicitamente do que travar um sync futuro com um valor null inesperado).
    nullable: campo.nullableOpenApi ?? true,
    tamanho: null,
    precisao: null,
    escala: null,
    tipoInferidoAmostra: campo.tipoInferidoAmostra,
    valorExemplo: campo.valorExemplo,
    tipoOpenApi: campo.tipoOpenApi,
    nullableOpenApi: campo.nullableOpenApi,
    enumOpenApi: campo.enumOpenApi,
    relacionamentoModelo: null,
    relacionamentoCampo: null,
    relacionamentoCampoDescricao: null,
  };
}

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function MapeamentoKyria() {
  const toast = useToast();
  const [doc, setDoc] = useState<DocKyria | null>(null);
  const [registrados, setRegistrados] = useState<RecursoRegistrado[]>([]);
  const [modelosInternos, setModelosInternos] = useState<ModeloInterno[]>([]);
  const [carregandoListas, setCarregandoListas] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Recurso escolhido na lista da documentação (pelo caminho com {parametros}) e os valores dos parâmetros dele. O caminho que vai pro preview sai
  // daqui (montarCaminho); `caminhoForaDaDoc` só existe ao editar um mapeamento cuja rota a documentação não tem mais.
  const [caminhoRecurso, setCaminhoRecurso] = useState("");
  const [valoresCaminho, setValoresCaminho] = useState<Record<string, string>>({});
  const [valoresQuery, setValoresQuery] = useState<Record<string, string>>({});
  const [avancado, setAvancado] = useState(false);
  const [caminhoForaDaDoc, setCaminhoForaDaDoc] = useState<string | null>(null);
  const [urlChamada, setUrlChamada] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [amostraBruta, setAmostraBruta] = useState<unknown>(null);
  const [campos, setCampos] = useState<CampoEditavel[] | null>(null);
  const [prevendo, setPrevendo] = useState(false);
  const [registrando, setRegistrando] = useState(false);

  function carregarListas() {
    setCarregandoListas(true);
    Promise.all([
      // Doc fora do ar (502) não derruba o resto da tela: o erro aparece e as outras listas carregam.
      axios.get<DocKyria>("/api/sync-kyria/mapping/openapi-resources").catch((err) => {
        setErro(err.response?.data?.error ?? "Falha ao ler a documentação da API do Kyria");
        return null;
      }),
      axios.get<{ recursos: RecursoRegistrado[] }>("/api/sync-kyria/mapping"),
      axios.get<{ modelos: ModeloInterno[] }>("/api/sync-kyria/mapping/internal-models"),
    ])
      .then(([docResp, registradosResp, modelosResp]) => {
        setDoc(docResp?.data ?? null);
        setRegistrados(registradosResp.data.recursos);
        setModelosInternos(modelosResp.data.modelos);
        if (docResp) setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar recursos"))
      .finally(() => setCarregandoListas(false));
  }

  useEffect(() => {
    carregarListas();
  }, []);

  const recursoAtual = useMemo(() => doc?.recursos.find((r) => r.caminho === caminhoRecurso) ?? null, [doc, caminhoRecurso]);

  function caminhoAtual(): string {
    if (recursoAtual) return montarCaminho(recursoAtual, valoresCaminho, valoresQuery);
    return caminhoForaDaDoc ?? "";
  }

  const faltando = recursoAtual ? faltaPreencher(recursoAtual, valoresCaminho, valoresQuery) : [];

  function escolherRecurso(caminho: string) {
    setCaminhoRecurso(caminho);
    setValoresCaminho({});
    setValoresQuery({});
    setCaminhoForaDaDoc(null);
    setUrlChamada(null);
  }

  function copiarUrl(url: string) {
    navigator.clipboard?.writeText(url).then(
      () => toast.mostrar("URL copiada.", "success"),
      () => toast.mostrar("Não consegui copiar: selecione o texto e copie.", "warning")
    );
  }

  async function prever() {
    const path = caminhoAtual();
    if (!path) {
      setErro("Escolha um recurso da lista");
      return;
    }
    if (faltando.length > 0) {
      setErro(`Preencha: ${faltando.join(", ")}`);
      return;
    }
    setPrevendo(true);
    setErro(null);
    setCampos(null);
    try {
      const { data } = await axios.post<ResourcePreview>("/api/sync-kyria/mapping/preview", { path });
      setAmostraBruta(data.amostraBruta);
      setUrlChamada(data.urlChamada);
      setCampos(data.campos.map(campoPreviewParaEditavel));
      // Nome de exibição: o do mapeamento já registrado desse recurso, senão o resumo da documentação.
      const jaRegistrado = recursoAtual?.registrados.find((r) => r.resourcePath === path);
      setDisplayName(jaRegistrado?.displayName ?? recursoAtual?.resumo ?? path);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao pré-visualizar o recurso");
    } finally {
      setPrevendo(false);
    }
  }

  function atualizarCampo(indice: number, patch: Partial<CampoEditavel>) {
    setCampos((atual) => (atual ? atual.map((c, i) => (i === indice ? { ...c, ...patch } : c)) : atual));
  }

  // Campo que não existe na resposta do Kyria — só do nosso lado (ex.: FK pra outra tabela do
  // CaxHub). Só aparece com a grade já carregada (depois de um preview, ou editando um recurso
  // já registrado).
  function adicionarCampoInterno() {
    setCampos((atual) => {
      const base = atual ?? [];
      const proximaOrdem = base.length ? Math.max(...base.map((c) => c.ordem)) + 1 : 0;
      return [
        ...base,
        {
          nomeOrigem: null,
          ordem: proximaOrdem,
          manter: true,
          tipoEscolhido: "String",
          nomeInterno: "",
          nullable: true,
          tamanho: null,
          precisao: null,
          escala: null,
          tipoInferidoAmostra: null,
          valorExemplo: null,
          tipoOpenApi: null,
          nullableOpenApi: null,
          enumOpenApi: null,
          relacionamentoModelo: null,
          relacionamentoCampo: null,
          relacionamentoCampoDescricao: null,
        },
      ];
    });
  }

  // Remoção de verdade (não é só desmarcar "Manter") — vale pra qualquer linha, não só interna:
  // uma linha vinda da API pode ser reobtida clicando "Pré-visualizar" de novo, então remover
  // não perde informação.
  function removerCampo(indice: number) {
    setCampos((atual) => (atual ? atual.filter((_, i) => i !== indice) : atual));
  }

  // Opções do seletor "Tabela relacionada" — grupo único ("Tabelas"): a busca do SelectBuscavel
  // já resolve bem os ~50 models sem precisar agrupar por letra.
  const opcoesModelo: OpcaoBuscavel<string>[] = modelosInternos.map((m) => ({
    value: m.nome,
    grupo: "Tabelas",
    rotulo: m.tabela ? `${m.nome} (${m.tabela})` : m.nome,
  }));

  // Lista de recursos: um grupo por primeiro segmento do caminho (tickets, reports...), rótulo "GET /caminho — resumo da documentação".
  const opcoesRecurso: OpcaoBuscavel<string>[] = (doc?.recursos ?? []).map((r) => ({
    value: r.caminho,
    grupo: r.grupo,
    rotulo: `GET ${r.caminho} — ${r.resumo}${r.registrados.length ? " (registrado)" : ""}`,
  }));

  const urlMostrada = caminhoAtual() && doc ? urlCompleta(doc.baseUrl, caminhoAtual()) : null;

  async function registrar() {
    if (!campos || campos.length === 0) return;
    setRegistrando(true);
    setErro(null);
    try {
      const { data } = await axios.post("/api/sync-kyria/mapping/register", {
        path: caminhoAtual(),
        displayName,
        amostraBruta,
        campos,
      });
      carregarListas();
      toast.mostrar(`Mapeamento registrado (recurso #${data.resourceId}).`, "success");
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao registrar o mapeamento");
    } finally {
      setRegistrando(false);
    }
  }

  async function verEditar(resourceId: number) {
    setErro(null);
    try {
      const { data } = await axios.get<RecursoDetalhe>(`/api/sync-kyria/mapping/${resourceId}`);
      // Seleciona o recurso na lista da documentação (com os valores dos parâmetros desse registro); se a rota não está mais na documentação, mostra
      // o caminho salvo e avisa, sem impedir a edição dos campos.
      const casado = doc?.recursos.find((r) => r.registrados.some((x) => x.resourceId === resourceId));
      const registro = casado?.registrados.find((x) => x.resourceId === resourceId);
      setUrlChamada(null);
      if (casado && registro) {
        setCaminhoRecurso(casado.caminho);
        setValoresCaminho(registro.valoresCaminho);
        setValoresQuery(registro.valoresQuery);
        setCaminhoForaDaDoc(null);
        setAvancado(queryDaPessoa(casado).some((p) => !p.obrigatorio && (registro.valoresQuery[p.nome] ?? "") !== ""));
      } else {
        setCaminhoRecurso("");
        setValoresCaminho({});
        setValoresQuery({});
        setCaminhoForaDaDoc(data.resourcePath);
      }
      setDisplayName(data.displayName);
      setAmostraBruta(null);
      setCampos(
        data.campos.map((c) => ({
          nomeOrigem: c.nomeOrigem,
          ordem: c.ordem,
          manter: c.manter,
          tipoEscolhido: c.tipoEscolhido,
          nomeInterno: c.nomeInterno,
          nullable: c.nullable,
          tamanho: c.tamanho,
          precisao: c.precisao,
          escala: c.escala,
          tipoInferidoAmostra: c.tipoInferidoAmostra,
          valorExemplo: c.valorExemplo,
          tipoOpenApi: c.tipoOpenApi,
          nullableOpenApi: c.nullableOpenApi,
          enumOpenApi: c.enumOpenApi,
          relacionamentoModelo: c.relacionamentoModelo,
          relacionamentoCampo: c.relacionamentoCampo,
          relacionamentoCampoDescricao: c.relacionamentoCampoDescricao,
        }))
      );
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao carregar o recurso");
    }
  }

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Administração · Integração Kyria
      </p>

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Mapeamento de Campos</h1>
        <p className="mt-1 text-sm text-muted">
          Antes de um endpoint do Kyria virar tabela de verdade, pré-visualize uma amostra real, confira o tipo de
          cada campo e registre a decisão — isso vira a especificação que orienta a migração, não cria nada no banco
          sozinho.
        </p>
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      <div className="mb-6 rounded-lg border border-border bg-surface p-5">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted">Recurso (documentação da API)</label>
            <SelectBuscavel
              opcoes={opcoesRecurso}
              valor={caminhoRecurso || null}
              onChange={escolherRecurso}
              placeholder={carregandoListas ? "Lendo a documentação..." : "Selecione..."}
              textoVazio="A documentação do Kyria não pôde ser lida"
              placeholderBusca="Buscar por caminho ou resumo..."
              desabilitado={!doc}
              gruposRecolhiveis
              className="w-[26rem] max-w-full"
            />
          </div>
          <button
            onClick={() => setAvancado((v) => !v)}
            aria-pressed={avancado}
            disabled={!recursoAtual}
            title="Mostra também os parâmetros opcionais do recurso"
            className={`rounded-md border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${avancado ? "border-primary bg-primary/10 text-primary" : "border-border text-muted hover:bg-surface-2 hover:text-foreground"}`}
          >
            Avançado
          </button>
          <button
            onClick={prever}
            disabled={prevendo || !caminhoAtual() || faltando.length > 0}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {prevendo ? "Pré-visualizando..." : "Pré-visualizar"}
          </button>
        </div>

        {doc && (
          <p className="mb-3 text-[11px] text-muted">
            Lista lida da documentação do Kyria (versão {doc.versaoDoc ?? "?"}, {doc.recursos.length} endpoints GET) ·{" "}
            <a href={doc.docsUrl} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
              abrir a documentação
            </a>
          </p>
        )}

        {recursoAtual && (
          <div className="mb-3 flex flex-wrap gap-3">
            {recursoAtual.parametrosCaminho.map((p) => (
              <label key={p.nome} className="block text-[11px] font-medium text-muted" title={p.descricao ?? undefined}>
                {p.nome} <span className="text-destructive">*</span>
                <input
                  value={valoresCaminho[p.nome] ?? ""}
                  onChange={(e) => setValoresCaminho((v) => ({ ...v, [p.nome]: e.target.value }))}
                  placeholder="id do registro"
                  className="mt-1 block w-64 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-normal text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            ))}
            {queryDaPessoa(recursoAtual)
              .filter((p) => p.obrigatorio || avancado)
              .map((p) => (
                <label key={p.nome} className="block text-[11px] font-medium text-muted" title={p.descricao ?? undefined}>
                  {p.nome} {p.obrigatorio && <span className="text-destructive">*</span>}
                  {p.enumValores ? (
                    <select
                      value={valoresQuery[p.nome] ?? ""}
                      onChange={(e) => setValoresQuery((v) => ({ ...v, [p.nome]: e.target.value }))}
                      className="mt-1 block w-48 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-normal text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">{p.obrigatorio ? "Selecione..." : "(não enviar)"}</option>
                      {p.enumValores.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={valoresQuery[p.nome] ?? ""}
                      onChange={(e) => setValoresQuery((v) => ({ ...v, [p.nome]: e.target.value }))}
                      className="mt-1 block w-48 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-normal text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  )}
                </label>
              ))}
          </div>
        )}
        {recursoAtual?.parametrosQuery.some((p) => p.preenchidoPeloSistema) && (
          <p className="mb-3 text-[11px] text-muted">
            {recursoAtual.parametrosQuery
              .filter((p) => p.preenchidoPeloSistema)
              .map((p) => p.nome)
              .join(" e ")}
            : o sistema usa o mês corrente na amostra e não grava as datas no recurso.
          </p>
        )}
        {caminhoForaDaDoc && (
          <p className="mb-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12px] text-muted">
            O caminho salvo <span className="font-mono">{caminhoForaDaDoc}</span> não está mais na documentação do Kyria. Dá para editar os campos, mas não pré-visualizar de novo.
          </p>
        )}

        {urlMostrada && (
          <div className="rounded-md border border-border bg-surface-2/60 px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-muted">URL completa da API</p>
                <p className="break-all font-mono text-[12.5px] text-foreground" data-testid="url-completa">
                  {urlMostrada}
                </p>
                {urlChamada && urlChamada !== urlMostrada && (
                  <p className="mt-1 break-all text-[11px] text-muted">
                    Chamada de amostra: <span className="font-mono">{urlChamada}</span>
                  </p>
                )}
              </div>
              <button
                onClick={() => copiarUrl(urlChamada ?? urlMostrada)}
                className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:bg-surface hover:text-foreground"
              >
                Copiar
              </button>
            </div>
          </div>
        )}
      </div>

      {campos && (
        <div className="mb-6 overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 text-sm font-semibold text-foreground">{caminhoAtual()}</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Nome de exibição"
                title={displayName}
                className="w-full max-w-md min-w-0 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={adicionarCampoInterno}
                className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition hover:bg-surface-2"
              >
                + Adicionar campo interno
              </button>
              <button
                onClick={registrar}
                disabled={registrando}
                className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {registrando ? "Registrando..." : "Registrar mapeamento"}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="bg-surface-2 px-2.5 py-2 text-center font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Manter
                  </th>
                  <th className="bg-surface-2 px-2.5 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Campo de origem
                  </th>
                  <th className="bg-surface-2 px-2.5 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Nome interno
                  </th>
                  <th className="bg-surface-2 px-2.5 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Tipo
                  </th>
                  <th className="bg-surface-2 px-2.5 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Tamanho/Precisão
                  </th>
                  <th className="bg-surface-2 px-2.5 py-2 text-center font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Nullable
                  </th>
                  <th className="bg-surface-2 px-2.5 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Exemplo
                  </th>
                  <th className="bg-surface-2 px-2.5 py-2 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Caracteres
                  </th>
                  <th className="bg-surface-2 px-2.5 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    OpenAPI
                  </th>
                  <th className="bg-surface-2 px-2.5 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Tabela relacionada
                  </th>
                  <th className="bg-surface-2 px-2.5 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Campo relacionado
                  </th>
                  <th className="bg-surface-2 px-2.5 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Campo de descrição
                  </th>
                  <th className="bg-surface-2 px-2.5 py-2 text-center font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    {/* remover linha */}
                  </th>
                </tr>
              </thead>
              <tbody>
                {campos.map((campo, indice) => {
                  const travadoEmJson = ehTipoObjetoOuArray(campo.tipoInferidoAmostra);
                  return (
                    <tr key={indice} className="border-t border-border/60">
                      <td className="px-2.5 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={campo.manter}
                          onChange={(e) => atualizarCampo(indice, { manter: e.target.checked })}
                        />
                      </td>
                      <td className="px-2.5 py-2 font-mono text-sm text-foreground">
                        {campo.nomeOrigem ?? <span className="italic text-muted">(campo interno)</span>}
                        {campo.tipoInferidoAmostra === "null" && (
                          <p className="text-[11px] text-warning">amostra veio nula — confirme o tipo</p>
                        )}
                      </td>
                      <td className="px-2.5 py-2">
                        <input
                          value={campo.nomeInterno}
                          onChange={(e) => atualizarCampo(indice, { nomeInterno: paraSnakeCase(e.target.value) })}
                          disabled={!campo.manter}
                          title="Sempre snake_case minúsculo — vira o nome da coluna"
                          className="w-40 rounded-md border border-border bg-surface px-2 py-1 font-mono text-sm text-foreground disabled:opacity-40"
                        />
                      </td>
                      <td className="px-2.5 py-2">
                        <select
                          value={campo.tipoEscolhido}
                          onChange={(e) => atualizarCampo(indice, { tipoEscolhido: e.target.value as TipoCampo })}
                          disabled={!campo.manter || travadoEmJson}
                          className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground disabled:opacity-40"
                        >
                          {TIPOS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2.5 py-2">
                        {campo.tipoEscolhido === "String" && (
                          <input
                            type="number"
                            min={1}
                            value={campo.tamanho ?? ""}
                            onChange={(e) => atualizarCampo(indice, { tamanho: e.target.value ? Number(e.target.value) : null })}
                            disabled={!campo.manter}
                            placeholder="sem limite"
                            title="Tamanho do VarChar — vazio = TEXT sem limite"
                            className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground placeholder:text-[11px] placeholder:text-muted disabled:opacity-40"
                          />
                        )}
                        {campo.tipoEscolhido === "Decimal" && (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={1}
                              value={campo.precisao ?? ""}
                              onChange={(e) => atualizarCampo(indice, { precisao: e.target.value ? Number(e.target.value) : null })}
                              disabled={!campo.manter}
                              placeholder="precisão"
                              title="Precisão — total de dígitos"
                              className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground placeholder:text-[11px] placeholder:text-muted disabled:opacity-40"
                            />
                            <span className="text-muted">,</span>
                            <input
                              type="number"
                              min={0}
                              value={campo.escala ?? ""}
                              onChange={(e) => atualizarCampo(indice, { escala: e.target.value ? Number(e.target.value) : null })}
                              disabled={!campo.manter}
                              placeholder="escala"
                              title="Escala — casas decimais"
                              className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground placeholder:text-[11px] placeholder:text-muted disabled:opacity-40"
                            />
                          </div>
                        )}
                        {campo.tipoEscolhido !== "String" && campo.tipoEscolhido !== "Decimal" && (
                          <span className="text-sm text-muted">—</span>
                        )}
                      </td>
                      <td className="px-2.5 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={campo.nullable}
                          onChange={(e) => atualizarCampo(indice, { nullable: e.target.checked })}
                          disabled={!campo.manter}
                        />
                      </td>
                      <td className="max-w-[220px] truncate px-2.5 py-2 font-mono text-[11px] text-muted" title={campo.valorExemplo ?? ""}>
                        {campo.valorExemplo}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono text-[11px] tabular-nums text-muted">
                        {campo.valorExemplo?.endsWith("…")
                          ? `${campo.valorExemplo.length}+`
                          : campo.valorExemplo?.length ?? 0}
                      </td>
                      <td className="px-2.5 py-2 text-[11px] text-muted">
                        {campo.tipoOpenApi ? (
                          <span title={campo.enumOpenApi ? `enum: ${campo.enumOpenApi.join(", ")}` : undefined}>
                            {campo.tipoOpenApi}
                            {campo.nullableOpenApi ? "?" : ""}
                            {campo.enumOpenApi ? ` [${campo.enumOpenApi.join("|")}]` : ""}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2.5 py-2">
                        <SelectBuscavel<string>
                          opcoes={opcoesModelo}
                          valor={campo.relacionamentoModelo}
                          onChange={(v) =>
                            atualizarCampo(indice, { relacionamentoModelo: v, relacionamentoCampo: null, relacionamentoCampoDescricao: null })
                          }
                          placeholder="Nenhum"
                          textoVazio="Nenhum modelo carregado"
                          className="w-44"
                        />
                      </td>
                      <td className="px-2.5 py-2">
                        <select
                          value={campo.relacionamentoCampo ?? ""}
                          onChange={(e) => {
                            const nomeCampo = e.target.value || null;
                            // Ajusta o Tipo pro tipo real do campo relacionado — evita o
                            // descompasso que aconteceu com "codusu" (registrado como BigInt,
                            // mas Consultor.codusu é Int de verdade). Só ajusta quando o tipo
                            // Prisma do alvo é um dos 8 valores que a tela aceita; senão deixa
                            // o que já estava escolhido.
                            const modelo = modelosInternos.find((m) => m.nome === campo.relacionamentoModelo);
                            const campoAlvo = modelo?.campos.find((f) => f.nome === nomeCampo);
                            const tipoAjustado = campoAlvo && (TIPOS as readonly string[]).includes(campoAlvo.tipo) ? (campoAlvo.tipo as TipoCampo) : null;
                            atualizarCampo(indice, {
                              relacionamentoCampo: nomeCampo,
                              ...(tipoAjustado ? { tipoEscolhido: tipoAjustado, tamanho: null, precisao: null, escala: null } : {}),
                            });
                          }}
                          disabled={!campo.relacionamentoModelo}
                          className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground disabled:opacity-40"
                        >
                          <option value="">Nenhum</option>
                          {modelosInternos
                            .find((m) => m.nome === campo.relacionamentoModelo)
                            ?.campos.map((f) => (
                              <option key={f.nome} value={f.nome}>
                                {f.nome}
                                {f.ehChavePrimaria ? " (PK)" : ""}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td className="px-2.5 py-2">
                        <select
                          value={campo.relacionamentoCampoDescricao ?? ""}
                          onChange={(e) => atualizarCampo(indice, { relacionamentoCampoDescricao: e.target.value || null })}
                          disabled={!campo.relacionamentoModelo}
                          title="Campo do modelo relacionado usado como rótulo legível na tela Ver dados"
                          className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground disabled:opacity-40"
                        >
                          <option value="">Nenhum</option>
                          {modelosInternos
                            .find((m) => m.nome === campo.relacionamentoModelo)
                            ?.campos.map((f) => (
                              <option key={f.nome} value={f.nome}>
                                {f.nome}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td className="px-2.5 py-2 text-center">
                        <button
                          onClick={() => removerCampo(indice)}
                          title="Remover campo"
                          className="text-muted hover:text-destructive"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-foreground">Recursos já registrados</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="bg-surface-2 px-2.5 py-2 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  ID
                </th>
                <th className="bg-surface-2 px-2.5 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Recurso
                </th>
                <th className="bg-surface-2 px-2.5 py-2 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Campos
                </th>
                <th className="bg-surface-2 px-2.5 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Atualizado em
                </th>
                <th className="bg-surface-2 px-2.5 py-2 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {carregandoListas &&
                Array.from({ length: 2 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-2.5 py-3 text-right">
                      <Skeleton className="ml-auto h-4 w-6" />
                    </td>
                    <td className="px-2.5 py-3">
                      <Skeleton className="h-4 w-40" />
                    </td>
                    <td className="px-2.5 py-3 text-right">
                      <Skeleton className="ml-auto h-4 w-8" />
                    </td>
                    <td className="px-2.5 py-3">
                      <Skeleton className="h-4 w-28" />
                    </td>
                    <td className="px-2.5 py-3 text-right">
                      <Skeleton className="ml-auto h-4 w-16" />
                    </td>
                  </tr>
                ))}
              {!carregandoListas && registrados.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2.5 py-4 text-center text-sm text-muted">
                    Nenhum recurso registrado ainda.
                  </td>
                </tr>
              )}
              {!carregandoListas &&
                registrados.map((r) => (
                  <tr key={r.id} className="border-t border-border/60">
                    <td className="px-2.5 py-3 text-right font-mono text-sm tabular-nums text-muted">{r.id}</td>
                    <td className="px-2.5 py-3 text-sm text-foreground">
                      {r.displayName} <span className="font-mono text-[11px] text-muted">{r.resourcePath}</span>
                    </td>
                    <td className="px-2.5 py-3 text-right font-mono text-sm tabular-nums text-muted">{r.totalCampos}</td>
                    <td className="px-2.5 py-3 text-[12.5px] text-muted">{dateTimeFormatter.format(new Date(r.atualizadoEm))}</td>
                    <td className="px-2.5 py-3 text-right">
                      <button onClick={() => verEditar(r.id)} className="text-sm text-primary hover:underline">
                        Ver/editar
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
