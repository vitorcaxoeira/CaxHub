import axios from "axios";
import { useEffect, useState } from "react";
import { Skeleton } from "../../components/ui/Skeleton";
import { MultiSelectDropdown, MultiSelectOption } from "../../components/ui/MultiSelectDropdown";

// ---------------------------------------------------------------------------
// Tela de administração do Modo Painel/TV — molde de DepartamentoGrupoContabil.tsx (GET
// único trazendo linhas + opções, banner de erro inline, sem toast), adaptado pra um
// formulário de dois níveis (cabeçalho da TV + rotação de painéis) em vez de um único
// dropdown por linha. O CONTEÚDO (rótulos, campos de filtro) vem do catálogo servido
// pelo backend — nada aqui é específico do CaxHub além dos nomes exibidos.
// ---------------------------------------------------------------------------

interface DefinicaoFiltro {
  chave: string;
  tipo: "depexe" | "codfor" | "periodo";
  label: string;
  obrigatorio: boolean;
  multiplo: boolean;
}

interface PainelCatalogo {
  id: string;
  nome: string;
  descricao: string;
  grupo: string;
  filtros: DefinicaoFiltro[];
  dominioSync: "projetos" | null;
  duracaoPadraoSegundos: number;
}

interface ItemRotacao {
  id?: number;
  painelId: string;
  duracaoSegundos: number;
  modoAtualizacao: "nenhum" | "local" | "erp";
  filtros: Record<string, unknown> | null;
  ativo: boolean;
}

interface TvConfig {
  userId: number;
  email: string;
  nome: string;
  depexe: number | null;
  codemp: number | null;
  zoom: number;
  tema: string;
  ativo: boolean;
  itens: ItemRotacao[];
}

interface UsuarioSemConfig {
  userId: number;
  email: string;
  nome: string;
}

interface RespostaCatalogo {
  paineis: PainelCatalogo[];
  opcoes: { departamentos: MultiSelectOption<number>[]; consultores: MultiSelectOption<number>[] };
}

interface RespostaConfig {
  tvs: TvConfig[];
  usuariosPainel: UsuarioSemConfig[];
}

const selectClass =
  "rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function novoItem(painel: PainelCatalogo): ItemRotacao {
  return { painelId: painel.id, duracaoSegundos: painel.duracaoPadraoSegundos, modoAtualizacao: "local", filtros: null, ativo: true };
}

function paraDraft(usuario: UsuarioSemConfig): TvConfig {
  return { userId: usuario.userId, email: usuario.email, nome: usuario.nome, depexe: null, codemp: null, zoom: 1.6, tema: "dark", ativo: true, itens: [] };
}

// Um campo de filtro, resolvido a partir do que o painel escolhido DECLAROU no catálogo —
// é o que faz a tela de admin nunca precisar saber de antemão quais filtros cada painel
// pede (painel novo de outro domínio só precisa aparecer no catálogo).
function CampoFiltro({
  def,
  valor,
  onChange,
  opcoesDepartamentos,
  opcoesConsultores,
}: {
  def: DefinicaoFiltro;
  valor: unknown;
  onChange: (novo: unknown) => void;
  opcoesDepartamentos: MultiSelectOption<number>[];
  opcoesConsultores: MultiSelectOption<number>[];
}) {
  if (def.tipo === "depexe") {
    return (
      <select value={typeof valor === "number" ? valor : ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} className={selectClass}>
        <option value="">— {def.label} —</option>
        {opcoesDepartamentos.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (def.tipo === "codfor") {
    return (
      <MultiSelectDropdown
        opcoes={opcoesConsultores}
        selecionados={Array.isArray(valor) ? (valor as number[]) : []}
        onChange={onChange}
        labelTodos={`Todos (${def.label})`}
        labelSufixo="consultores"
      />
    );
  }
  // periodo: mês/ano únicos (o suficiente pros painéis mensais da v1; painel que precisar
  // de intervalo maior redeclara o filtro no catálogo sem mexer aqui).
  const periodo = valor as { ano: number; mes: number } | null;
  const inputValue = periodo ? `${periodo.ano}-${String(periodo.mes).padStart(2, "0")}` : "";
  return (
    <input
      type="month"
      value={inputValue}
      onChange={(e) => {
        if (!e.target.value) return onChange(null);
        const [ano, mes] = e.target.value.split("-").map(Number);
        onChange({ ano, mes });
      }}
      className={selectClass}
    />
  );
}

function CartaoPainelTv({
  tv,
  catalogo,
  opcoesDepartamentos,
  opcoesConsultores,
  onSalvo,
  onDescartar,
}: {
  tv: TvConfig;
  catalogo: PainelCatalogo[];
  opcoesDepartamentos: MultiSelectOption<number>[];
  opcoesConsultores: MultiSelectOption<number>[];
  onSalvo: () => void;
  onDescartar?: () => void;
}) {
  const [rascunho, setRascunho] = useState<TvConfig>(tv);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setRascunho(tv);
    setErro(null);
  }, [tv]);

  function atualizarItem(index: number, patch: Partial<ItemRotacao>) {
    setRascunho((atual) => ({ ...atual, itens: atual.itens.map((it, i) => (i === index ? { ...it, ...patch } : it)) }));
  }

  function mover(index: number, direcao: -1 | 1) {
    setRascunho((atual) => {
      const alvo = index + direcao;
      if (alvo < 0 || alvo >= atual.itens.length) return atual;
      const itens = [...atual.itens];
      [itens[index], itens[alvo]] = [itens[alvo], itens[index]];
      return { ...atual, itens };
    });
  }

  function remover(index: number) {
    setRascunho((atual) => ({ ...atual, itens: atual.itens.filter((_, i) => i !== index) }));
  }

  function adicionar() {
    if (catalogo.length === 0) return;
    setRascunho((atual) => ({ ...atual, itens: [...atual.itens, novoItem(catalogo[0])] }));
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await axios.put(`/api/painel-tv/config/${rascunho.userId}`, {
        nome: rascunho.nome,
        depexe: rascunho.depexe,
        codemp: rascunho.codemp,
        zoom: rascunho.zoom,
        tema: rascunho.tema,
        ativo: rascunho.ativo,
        itens: rascunho.itens,
      });
      onSalvo();
    } catch (err) {
      setErro(axios.isAxiosError(err) ? err.response?.data?.error ?? "Falha ao salvar" : "Falha ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{rascunho.email}</p>
          <p className="text-[12px] text-muted">Conta de TV (papel painel)</p>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          <input type="checkbox" checked={rascunho.ativo} onChange={(e) => setRascunho((a) => ({ ...a, ativo: e.target.checked }))} />
          Ativa
        </label>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Nome da TV
          <input
            type="text"
            value={rascunho.nome}
            onChange={(e) => setRascunho((a) => ({ ...a, nome: e.target.value }))}
            placeholder="ex.: TV Consultoria"
            className={`${selectClass} w-56`}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Departamento (contexto base)
          <select
            value={rascunho.depexe ?? ""}
            onChange={(e) => setRascunho((a) => ({ ...a, depexe: e.target.value === "" ? null : Number(e.target.value) }))}
            className={selectClass}
          >
            <option value="">Sem departamento fixo</option>
            {opcoesDepartamentos.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Zoom
          <input
            type="number"
            min={0.5}
            max={5}
            step={0.1}
            value={rascunho.zoom}
            onChange={(e) => setRascunho((a) => ({ ...a, zoom: Number(e.target.value) }))}
            className={`${selectClass} w-20`}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Tema
          <select value={rascunho.tema} onChange={(e) => setRascunho((a) => ({ ...a, tema: e.target.value }))} className={selectClass}>
            <option value="dark">Escuro</option>
            <option value="light">Claro</option>
          </select>
        </label>
      </div>

      <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">Rotação</p>
      <div className="space-y-2">
        {rascunho.itens.length === 0 && <p className="text-[12.5px] text-muted">Nenhum painel na rotação ainda.</p>}
        {rascunho.itens.map((item, index) => {
          const def = catalogo.find((p) => p.id === item.painelId);
          return (
            <div key={index} className="rounded-md border border-border/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => mover(index, -1)} disabled={index === 0} className="text-muted hover:text-foreground disabled:opacity-30">
                    ▲
                  </button>
                  <button
                    onClick={() => mover(index, 1)}
                    disabled={index === rascunho.itens.length - 1}
                    className="text-muted hover:text-foreground disabled:opacity-30"
                  >
                    ▼
                  </button>
                </div>
                <select
                  value={item.painelId}
                  onChange={(e) => {
                    const novoDef = catalogo.find((p) => p.id === e.target.value);
                    atualizarItem(index, { painelId: e.target.value, filtros: null, modoAtualizacao: "local", duracaoSegundos: novoDef?.duracaoPadraoSegundos ?? 30 });
                  }}
                  className={selectClass}
                >
                  {catalogo.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-[12px] text-muted">
                  Duração
                  <input
                    type="number"
                    min={5}
                    max={600}
                    value={item.duracaoSegundos}
                    onChange={(e) => atualizarItem(index, { duracaoSegundos: Number(e.target.value) })}
                    className={`${selectClass} w-16`}
                  />
                  s
                </label>
                <select
                  value={item.modoAtualizacao}
                  onChange={(e) => atualizarItem(index, { modoAtualizacao: e.target.value as ItemRotacao["modoAtualizacao"] })}
                  className={selectClass}
                >
                  <option value="nenhum">Não atualizar</option>
                  <option value="local">Atualizar (local)</option>
                  {def?.dominioSync != null && <option value="erp">Atualizar (buscar do ERP)</option>}
                </select>
                <label className="flex items-center gap-1.5 text-[12px] text-muted">
                  <input type="checkbox" checked={item.ativo} onChange={(e) => atualizarItem(index, { ativo: e.target.checked })} />
                  Ativo
                </label>
                <button onClick={() => remover(index)} className="ml-auto text-[12px] text-destructive hover:underline">
                  Remover
                </button>
              </div>
              {def && def.filtros.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-3 border-t border-border/40 pt-2">
                  {def.filtros.map((f) => (
                    <label key={f.chave} className="flex flex-col gap-1 text-[11.5px] text-muted">
                      {f.label}
                      {f.obrigatorio && <span className="text-destructive"> *</span>}
                      <CampoFiltro
                        def={f}
                        valor={item.filtros?.[f.chave] ?? null}
                        onChange={(novo) => atualizarItem(index, { filtros: { ...(item.filtros ?? {}), [f.chave]: novo } })}
                        opcoesDepartamentos={opcoesDepartamentos}
                        opcoesConsultores={opcoesConsultores}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button onClick={adicionar} className="rounded-md border border-border px-3 py-1.5 text-[12.5px] text-muted hover:bg-surface-2 hover:text-foreground">
          + Adicionar painel
        </button>
        <button
          onClick={salvar}
          disabled={salvando}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {salvando ? "Salvando..." : "Salvar"}
        </button>
        {onDescartar && (
          <button onClick={onDescartar} className="text-[12.5px] text-muted hover:text-foreground">
            Descartar
          </button>
        )}
      </div>

      {erro && <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">{erro}</p>}
    </div>
  );
}

export function PaineisTv() {
  const [catalogo, setCatalogo] = useState<PainelCatalogo[]>([]);
  const [opcoes, setOpcoes] = useState<RespostaCatalogo["opcoes"]>({ departamentos: [], consultores: [] });
  const [tvs, setTvs] = useState<TvConfig[]>([]);
  const [usuariosSemConfig, setUsuariosSemConfig] = useState<UsuarioSemConfig[]>([]);
  const [emEdicao, setEmEdicao] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  function carregar() {
    setLoading(true);
    Promise.all([axios.get<RespostaCatalogo>("/api/painel-tv/catalogo"), axios.get<RespostaConfig>("/api/painel-tv/config")])
      .then(([catalogoRes, configRes]) => {
        setCatalogo(catalogoRes.data.paineis);
        setOpcoes(catalogoRes.data.opcoes);
        setTvs(configRes.data.tvs);
        setUsuariosSemConfig(configRes.data.usuariosPainel);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar painéis de TV"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    carregar();
  }, []);

  function iniciarConfiguracao(userId: number) {
    setEmEdicao((atual) => new Set(atual).add(userId));
  }

  return (
    <div>
      <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted">Administração · Painéis de TV</p>
      <h1 className="mb-2 font-display text-2xl font-bold text-foreground">Painéis de TV</h1>
      <p className="mb-6 max-w-2xl text-sm text-muted">
        Configura, por conta de TV (papel <span className="font-mono">painel</span>), quais painéis giram, em que ordem, quanto tempo cada
        um fica no ar e se os dados são atualizados antes de aparecer. Crie a conta em Administração &gt; Usuários primeiro.
      </p>

      {erro && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{erro}</p>}

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {!loading && (
        <div className="space-y-4">
          {tvs.map((tv) => (
            <CartaoPainelTv
              key={tv.userId}
              tv={tv}
              catalogo={catalogo}
              opcoesDepartamentos={opcoes.departamentos}
              opcoesConsultores={opcoes.consultores}
              onSalvo={carregar}
            />
          ))}

          {usuariosSemConfig
            .filter((u) => emEdicao.has(u.userId))
            .map((u) => (
              <CartaoPainelTv
                key={u.userId}
                tv={paraDraft(u)}
                catalogo={catalogo}
                opcoesDepartamentos={opcoes.departamentos}
                opcoesConsultores={opcoes.consultores}
                onSalvo={carregar}
                onDescartar={() =>
                  setEmEdicao((atual) => {
                    const novo = new Set(atual);
                    novo.delete(u.userId);
                    return novo;
                  })
                }
              />
            ))}

          {usuariosSemConfig.filter((u) => !emEdicao.has(u.userId)).length > 0 && (
            <div className="rounded-lg border border-dashed border-border p-4">
              <p className="mb-2 text-[12.5px] text-muted">Contas com o papel painel ainda sem configuração:</p>
              <div className="flex flex-wrap gap-2">
                {usuariosSemConfig
                  .filter((u) => !emEdicao.has(u.userId))
                  .map((u) => (
                    <button
                      key={u.userId}
                      onClick={() => iniciarConfiguracao(u.userId)}
                      className="rounded-md border border-border px-3 py-1.5 text-[12.5px] text-muted hover:bg-surface-2 hover:text-foreground"
                    >
                      Configurar {u.email}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {tvs.length === 0 && usuariosSemConfig.length === 0 && (
            <p className="text-sm text-muted">Nenhuma conta com o papel painel ainda — crie uma em Administração &gt; Usuários.</p>
          )}
        </div>
      )}
    </div>
  );
}
