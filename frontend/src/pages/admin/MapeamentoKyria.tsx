import axios from "axios";
import { useEffect, useState } from "react";
import { Skeleton } from "../../components/ui/Skeleton";
import { useToast } from "../../components/ui/Toast";
import { SelectBuscavel, OpcaoBuscavel } from "../../components/ui/SelectBuscavel";

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

interface RecursoConhecido {
  path: string;
  displayName: string;
  openApiSchemaName?: string;
  registrado: boolean;
  resourceId: number | null;
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
  const [conhecidos, setConhecidos] = useState<RecursoConhecido[]>([]);
  const [registrados, setRegistrados] = useState<RecursoRegistrado[]>([]);
  const [modelosInternos, setModelosInternos] = useState<ModeloInterno[]>([]);
  const [carregandoListas, setCarregandoListas] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [pathEscolhido, setPathEscolhido] = useState("");
  const [caminhoCustomizado, setCaminhoCustomizado] = useState(false);
  const [caminhoTexto, setCaminhoTexto] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [amostraBruta, setAmostraBruta] = useState<unknown>(null);
  const [campos, setCampos] = useState<CampoEditavel[] | null>(null);
  const [prevendo, setPrevendo] = useState(false);
  const [registrando, setRegistrando] = useState(false);

  function carregarListas() {
    setCarregandoListas(true);
    Promise.all([
      axios.get<{ recursos: RecursoConhecido[] }>("/api/sync-kyria/mapping/known-resources"),
      axios.get<{ recursos: RecursoRegistrado[] }>("/api/sync-kyria/mapping"),
      axios.get<{ modelos: ModeloInterno[] }>("/api/sync-kyria/mapping/internal-models"),
    ])
      .then(([conhecidosResp, registradosResp, modelosResp]) => {
        setConhecidos(conhecidosResp.data.recursos);
        setRegistrados(registradosResp.data.recursos);
        setModelosInternos(modelosResp.data.modelos);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar recursos"))
      .finally(() => setCarregandoListas(false));
  }

  useEffect(() => {
    carregarListas();
  }, []);

  function caminhoAtual(): string {
    return caminhoCustomizado ? caminhoTexto.trim() : pathEscolhido;
  }

  async function prever() {
    const path = caminhoAtual();
    if (!path) {
      setErro("Escolha um recurso ou informe um caminho customizado");
      return;
    }
    setPrevendo(true);
    setErro(null);
    setCampos(null);
    try {
      const { data } = await axios.post<ResourcePreview>("/api/sync-kyria/mapping/preview", { path });
      setAmostraBruta(data.amostraBruta);
      setCampos(data.campos.map(campoPreviewParaEditavel));
      const conhecido = conhecidos.find((r) => r.path === path);
      setDisplayName(conhecido?.displayName ?? path);
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
      setCaminhoCustomizado(true);
      setCaminhoTexto(data.resourcePath);
      setPathEscolhido("");
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
          {!caminhoCustomizado && (
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted">Recurso</label>
              <select
                value={pathEscolhido}
                onChange={(e) => setPathEscolhido(e.target.value)}
                className="w-72 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Selecione...</option>
                {conhecidos.map((r) => (
                  <option key={r.path} value={r.path}>
                    {r.displayName} — {r.path} {r.registrado ? "(registrado)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          {caminhoCustomizado && (
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted">Caminho customizado</label>
              <input
                value={caminhoTexto}
                onChange={(e) => setCaminhoTexto(e.target.value)}
                placeholder="/tickets/abc123/time-entries"
                className="w-72 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          )}
          <button
            onClick={() => {
              setCaminhoCustomizado((v) => !v);
              setPathEscolhido("");
              setCaminhoTexto("");
            }}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted transition hover:bg-surface-2 hover:text-foreground"
          >
            {caminhoCustomizado ? "Usar lista de recursos conhecidos" : "Avançado: caminho customizado"}
          </button>
          <button
            onClick={prever}
            disabled={prevendo || !caminhoAtual()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {prevendo ? "Pré-visualizando..." : "Pré-visualizar"}
          </button>
        </div>
        {caminhoCustomizado && (
          <p className="text-[11px] text-muted">
            Caminho fora da lista oficial (10 GETs documentados) — pode voltar 403 por escopo da chave. Sem risco: é
            só leitura, nada é gravado até você clicar em "Registrar mapeamento".
          </p>
        )}
      </div>

      {campos && (
        <div className="mb-6 overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{caminhoAtual()}</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Nome de exibição"
                className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="flex items-center gap-2">
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
