import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { MultiSelectDropdown, MultiSelectOption } from "../../components/ui/MultiSelectDropdown";
import { Skeleton } from "../../components/ui/Skeleton";
import { copiarParaAreaDeTransferencia } from "../../utils/clipboard";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { ModalComputadoresUsuario } from "../../components/admin/ModalComputadoresUsuario";
import { TabelaLocal } from "../../components/colunas/TabelaLocal";
import type { ColunaLocal } from "../../components/colunas/aplicarLocal";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";
import { regras } from "../../components/ui/padroesFiltros/regras";
import { usePadroesTela } from "../../components/ui/padroesFiltros/usePadroesTela";

interface Role {
  id: number;
  name: string;
}

interface Usuario {
  id: number;
  email: string;
  nome: string;
  fotoUrl: string | null;
  roleId: number;
  roleName: string;
  status: string;
  // Computadores com o CaxHub Desktop conectados (só conta usuário ativo) — ver GET /users.
  desktopConectados: number;
}

interface FormState {
  nome: string;
  email: string;
  password: string;
  roleId: string;
}

interface ConviteFormState {
  email: string;
  nome: string;
  roleId: string;
}

const FORM_VAZIO: FormState = { nome: "", email: "", password: "", roleId: "" };
const CONVITE_VAZIO: ConviteFormState = { email: "", nome: "", roleId: "" };

const statusTone: Record<string, string> = {
  ativo: "bg-success/15 text-success",
  pendente: "bg-warning/15 text-warning",
  inativo: "bg-muted/15 text-muted",
};

const statusRotulo: Record<string, string> = { ativo: "Ativo", pendente: "Pendente", inativo: "Inativo" };

function IconeComputador() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function rotuloComputadores(n: number): string {
  if (n === 0) return "Nenhum computador conectado";
  return n === 1 ? "1 computador conectado" : `${n} computadores conectados`;
}

/** O que cada linha da tabela de usuários pode fazer (as ações vivem na tela). */
interface AcoesUsuario {
  logadoId: number | undefined;
  computadores: (u: Usuario) => void;
  reenviarConvite: (u: Usuario) => void;
  inativar: (u: Usuario) => void;
  reativar: (u: Usuario) => void;
  gerarToken: (u: Usuario) => void;
  editar: (u: Usuario) => void;
  excluir: (u: Usuario) => void;
}

// Tabela de usuários com filtro e ordem por coluna, colunas configuráveis e resumo no rodapé (TabelaLocal, 03/11/2026): a lista já vem
// inteira do servidor (filtrada pela busca, papel e situação do topo).
const COLUNAS_LOCAIS: ColunaLocal[] = [
  { nome: "nome", tipo: "texto", obrigatoria: true },
  { nome: "email", tipo: "texto", obrigatoria: true },
  { nome: "roleName", tipo: "texto", obrigatoria: true },
  { nome: "situacao", tipo: "texto", obrigatoria: true },
  { nome: "desktopConectados", tipo: "inteiro", obrigatoria: true },
];

const COLUNAS_USUARIOS: DefColuna<Usuario, AcoesUsuario>[] = [
  { nome: "nome", titulo: "Nome", fixa: true, largura: 220, classe: "text-sm font-semibold text-foreground", texto: (u) => u.nome, render: (u) => u.nome },
  { nome: "email", titulo: "E-mail", largura: 260, classe: "text-sm text-muted", texto: (u) => u.email, render: (u) => u.email },
  {
    nome: "roleName",
    titulo: "Papel",
    largura: 130,
    render: (u) => (
      <span className="inline-block rounded bg-muted/15 px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide text-muted">{u.roleName}</span>
    ),
  },
  {
    nome: "situacao",
    titulo: "Status",
    largura: 110,
    render: (u) => (
      <span className={`inline-block rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide ${statusTone[u.status] ?? statusTone.ativo}`}>
        {statusRotulo[u.status] ?? "Ativo"}
      </span>
    ),
  },
  {
    nome: "desktopConectados",
    titulo: "Desktop",
    centro: true,
    largura: 90,
    render: (u, a) => (
      // Verde = há computador conectado (clique abre a lista); cinza apagado = nenhum.
      <button
        onClick={() => a.computadores(u)}
        disabled={u.desktopConectados === 0}
        aria-label={rotuloComputadores(u.desktopConectados)}
        title={rotuloComputadores(u.desktopConectados)}
        className={`inline-flex rounded p-1 transition ${u.desktopConectados > 0 ? "text-success hover:bg-success/15" : "cursor-default text-muted/40"}`}
      >
        <IconeComputador />
      </button>
    ),
  },
  {
    nome: "acoes",
    titulo: "Ações",
    direita: true,
    semOrdenar: true,
    largura: 300,
    render: (u, a) => (
      <>
        {u.status === "pendente" && (
          <button onClick={() => a.reenviarConvite(u)} className="mr-3 text-sm text-primary hover:underline">
            Copiar link
          </button>
        )}
        {u.status === "ativo" && (
          <button
            onClick={() => a.inativar(u)}
            disabled={u.id === a.logadoId}
            title={u.id === a.logadoId ? "Você não pode inativar seu próprio usuário" : undefined}
            className="mr-3 text-sm text-warning hover:underline disabled:cursor-not-allowed disabled:opacity-40"
          >
            Inativar
          </button>
        )}
        {u.status === "inativo" && (
          <button onClick={() => a.reativar(u)} className="mr-3 text-sm text-success hover:underline">
            Reativar
          </button>
        )}
        {u.roleName === "system" && (
          <button onClick={() => a.gerarToken(u)} className="mr-3 text-sm text-primary hover:underline">
            Gerar token
          </button>
        )}
        <button onClick={() => a.editar(u)} className="mr-3 text-sm text-primary hover:underline">
          Editar
        </button>
        <button
          onClick={() => a.excluir(u)}
          disabled={u.id === a.logadoId}
          className="text-sm text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-40"
        >
          Excluir
        </button>
      </>
    ),
  },
];

/** Valor de cada coluna para filtrar e ordenar (a situação pelo rótulo, como aparece na tela). */
const lerUsuario = (u: Usuario, nome: string): unknown => (nome === "situacao" ? statusRotulo[u.status] ?? "Ativo" : (u as unknown as Record<string, unknown>)[nome]);

export function Usuarios() {
  const { user: usuarioLogado } = useAuth();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [form, setForm] = useState<FormState>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [buscandoSugestaoForm, setBuscandoSugestaoForm] = useState(false);
  const debounceFormRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [convidarAberto, setConvidarAberto] = useState(false);
  const [conviteForm, setConviteForm] = useState<ConviteFormState>(CONVITE_VAZIO);
  const [buscandoSugestao, setBuscandoSugestao] = useState(false);
  const [enviandoConvite, setEnviandoConvite] = useState(false);
  const [erroConvite, setErroConvite] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [linkGerado, setLinkGerado] = useState<string | null>(null);
  const [linkCopiado, setLinkCopiado] = useState(false);

  // Situação vem de um clique num KPI (só um valor por vez, ver alternarStatusFiltro); Papel
  // é multi-select; busca é texto livre debounced — mesmo padrão de SincronizacaoSenior.tsx.
  const [statusFiltro, setStatusFiltro] = useState<string | null>(null);
  // KPI "Com desktop conectado": liga/desliga o filtro de quem tem computador conectado (combina com a situação).
  const [soDesktop, setSoDesktop] = useState(false);
  // Usuário cujo modal de computadores está aberto.
  const [computadoresDe, setComputadoresDe] = useState<Usuario | null>(null);
  const [roleFiltro, setRoleFiltro] = useState<number[]>([]);
  const [buscaInput, setBuscaInput] = useState("");
  const buscaDebounced = useDebouncedValue(buscaInput, 350);

  // Totais por situação da base INTEIRA (não reagem a statusFiltro/roleFiltro/buscaDebounced)
  // — mesma regra de GET /sincronizacao/indicadores: o KPI mostra sempre o todo, só a lista
  // abaixo reage aos filtros.
  const [indicadores, setIndicadores] = useState({ ativo: 0, pendente: 0, inativo: 0, comDesktop: 0 });
  const [loadingIndicadores, setLoadingIndicadores] = useState(true);

  function carregar() {
    setLoading(true);
    Promise.all([
      axios.get("/api/users", {
        params: {
          busca: buscaDebounced || undefined,
          roleId: roleFiltro.length > 0 ? roleFiltro.join(",") : undefined,
          status: statusFiltro || undefined,
          desktop: soDesktop ? 1 : undefined,
        },
      }),
      axios.get("/api/users/roles"),
    ])
      .then(([usersRes, rolesRes]) => {
        setUsuarios(usersRes.data.users);
        setRoles(rolesRes.data.roles);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar usuários"))
      .finally(() => setLoading(false));
  }

  function carregarIndicadores() {
    setLoadingIndicadores(true);
    axios
      .get("/api/users/indicadores")
      .then(({ data }) => setIndicadores(data))
      .catch(() => {})
      .finally(() => setLoadingIndicadores(false));
  }

  // Indicadores carregam só uma vez ao montar — não dependem dos filtros da tela.
  useEffect(() => {
    carregarIndicadores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Padrão do filtro de papel (estrela, 03/11/2026): aplicado uma vez ao abrir, antes da 1ª consulta. Os papéis vêm junto da lista,
  // então o padrão só confere o formato; papel que não existir mais simplesmente não traz ninguém.
  const padroes = usePadroesTela({
    tela: "admin.usuarios",
    campos: { papel: { rotulo: "Papel", atual: roleFiltro, aplicar: setRoleFiltro, validar: regras.lista("number"), semOpcoes: true } },
  });

  useEffect(() => {
    if (!padroes.pronto) return;
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [padroes.pronto, statusFiltro, roleFiltro, buscaDebounced, soDesktop]);

  function alternarStatusFiltro(status: string) {
    setStatusFiltro((atual) => (atual === status ? null : status));
  }

  function abrirCriar() {
    setEditando(null);
    setForm({ ...FORM_VAZIO, roleId: roles[0] ? String(roles[0].id) : "" });
    setErroForm(null);
    setModalAberto(true);
  }

  function abrirEditar(usuario: Usuario) {
    setEditando(usuario);
    setForm({ nome: usuario.nome, email: usuario.email, password: "", roleId: String(usuario.roleId) });
    setErroForm(null);
    setModalAberto(true);
  }

  function fecharModal() {
    setModalAberto(false);
  }

  // Só busca sugestão na criação (não faz sentido sobrescrever dados de um usuário já
  // existente ao editar) — mesmo endpoint já usado pelo fluxo de Convidar usuário.
  function onEmailFormChange(email: string) {
    setForm((atual) => ({ ...atual, email }));
    if (editando) return;
    if (debounceFormRef.current) clearTimeout(debounceFormRef.current);

    const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailValido) return;

    debounceFormRef.current = setTimeout(() => {
      setBuscandoSugestaoForm(true);
      axios
        .get("/api/users/convites/sugestao", { params: { email } })
        .then(({ data }) => {
          if (data.encontrado) {
            setForm((atual) => ({
              ...atual,
              nome: atual.nome || data.nome,
              roleId: data.roleId ? String(data.roleId) : atual.roleId,
            }));
          }
        })
        .catch(() => {})
        .finally(() => setBuscandoSugestaoForm(false));
    }, 500);
  }

  async function salvar() {
    setSalvando(true);
    setErroForm(null);
    try {
      if (editando) {
        const payload: Record<string, unknown> = { nome: form.nome, email: form.email, roleId: form.roleId };
        if (form.password) payload.password = form.password;
        await axios.put(`/api/users/${editando.id}`, payload);
      } else {
        await axios.post("/api/users", { nome: form.nome, email: form.email, password: form.password, roleId: form.roleId });
      }
      setModalAberto(false);
      carregar();
    } catch (err: any) {
      setErroForm(err.response?.data?.error ?? "Falha ao salvar usuário");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(usuario: Usuario) {
    const acao = usuario.status === "pendente" ? "cancelar o convite de" : "excluir o usuário";
    if (!window.confirm(`Deseja ${acao} "${usuario.nome}"? Essa ação não pode ser desfeita.`)) return;
    try {
      await axios.delete(`/api/users/${usuario.id}`);
      carregar();
      // Excluir muda a contagem por situação (um ativo ou um pendente a menos) — sem isso o
      // KPI ficaria visivelmente errado logo depois da própria ação que esta tela oferece.
      carregarIndicadores();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao excluir usuário");
    }
  }

  // Inativar/reativar mudam a contagem por situação — mesma razão de carregarIndicadores() em
  // excluir(). Inativar derruba a sessão da pessoa na hora e bloqueia novo login, sem apagar nada.
  async function inativar(usuario: Usuario) {
    if (
      !window.confirm(
        `Inativar "${usuario.nome}"? A pessoa perde o acesso imediatamente (inclusive se estiver logada agora). Você pode reativar depois.`
      )
    )
      return;
    try {
      await axios.post(`/api/users/${usuario.id}/inativar`);
      carregar();
      carregarIndicadores();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao inativar usuário");
    }
  }

  async function reativar(usuario: Usuario) {
    try {
      await axios.post(`/api/users/${usuario.id}/reativar`);
      carregar();
      carregarIndicadores();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao reativar usuário");
    }
  }

  function abrirConvidar() {
    setConviteForm({ ...CONVITE_VAZIO, roleId: roles[0] ? String(roles[0].id) : "" });
    setErroConvite(null);
    setConvidarAberto(true);
  }

  function fecharConvidar() {
    setConvidarAberto(false);
  }

  function onEmailConviteChange(email: string) {
    setConviteForm((atual) => ({ ...atual, email }));
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailValido) return;

    debounceRef.current = setTimeout(() => {
      setBuscandoSugestao(true);
      axios
        .get("/api/users/convites/sugestao", { params: { email } })
        .then(({ data }) => {
          if (data.encontrado) {
            setConviteForm((atual) => ({
              ...atual,
              nome: atual.nome || data.nome,
              roleId: data.roleId ? String(data.roleId) : atual.roleId,
            }));
          }
        })
        .catch(() => {})
        .finally(() => setBuscandoSugestao(false));
    }, 500);
  }

  async function enviarConvite() {
    setEnviandoConvite(true);
    setErroConvite(null);
    try {
      const { data } = await axios.post("/api/users/convites", {
        email: conviteForm.email,
        nome: conviteForm.nome,
        roleId: conviteForm.roleId,
      });
      setConvidarAberto(false);
      setLinkGerado(`${window.location.origin}${data.inviteLink}`);
      setLinkCopiado(false);
      carregar();
      // Novo convite é um usuário "pendente" a mais — mesma razão de carregarIndicadores()
      // em excluir().
      carregarIndicadores();
    } catch (err: any) {
      setErroConvite(err.response?.data?.error ?? "Falha ao criar convite");
    } finally {
      setEnviandoConvite(false);
    }
  }

  async function reenviarConvite(usuario: Usuario) {
    try {
      const { data } = await axios.post(`/api/users/${usuario.id}/convites/reenviar`);
      setLinkGerado(`${window.location.origin}${data.inviteLink}`);
      setLinkCopiado(false);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao reenviar convite");
    }
  }

  async function gerarTokenServico(usuario: Usuario) {
    try {
      const { data } = await axios.post(`/api/users/${usuario.id}/token-servico`);
      setLinkGerado(data.token);
      setLinkCopiado(false);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao gerar token de serviço");
    }
  }

  async function copiarLink() {
    if (!linkGerado) return;
    const copiou = await copiarParaAreaDeTransferencia(linkGerado);
    if (copiou) {
      setLinkCopiado(true);
    } else {
      setErro("Não foi possível copiar automaticamente. Selecione e copie o link exibido acima.");
    }
  }

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Administração · Usuários
      </p>

      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-foreground">Usuários</h1>
        <div className="flex gap-3">
          <button
            onClick={abrirConvidar}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
          >
            Convidar usuário
          </button>
          <button
            onClick={abrirCriar}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Novo usuário
          </button>
        </div>
      </div>

      {loadingIndicadores ? (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-5">
              <Skeleton className="mb-2 h-3.5 w-20" />
              <Skeleton className="h-7 w-12" />
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Clicáveis: filtram a lista abaixo por situação (mesmo espírito do KPI de
              SincronizacaoSenior.tsx) — o total de cada cartão nunca muda com o clique, só o
              da base inteira. */}
          <button
            onClick={() => alternarStatusFiltro("ativo")}
            className={`rounded-lg border p-5 text-left transition ${
              statusFiltro === "ativo" ? "border-success ring-2 ring-success/40" : "border-border hover:bg-surface-2"
            } ${statusFiltro && statusFiltro !== "ativo" ? "opacity-40" : ""}`}
          >
            <p className="mb-2 text-[11.5px] text-muted">Ativos</p>
            <span className="block font-mono text-2xl font-semibold tabular-nums text-success">{indicadores.ativo}</span>
          </button>
          <button
            onClick={() => alternarStatusFiltro("pendente")}
            className={`rounded-lg border p-5 text-left transition ${
              statusFiltro === "pendente" ? "border-warning ring-2 ring-warning/40" : "border-border hover:bg-surface-2"
            } ${statusFiltro && statusFiltro !== "pendente" ? "opacity-40" : ""}`}
          >
            <p className="mb-2 text-[11.5px] text-muted">Convites pendentes</p>
            <span className="block font-mono text-2xl font-semibold tabular-nums text-warning">{indicadores.pendente}</span>
          </button>
          <button
            onClick={() => alternarStatusFiltro("inativo")}
            className={`rounded-lg border p-5 text-left transition ${
              statusFiltro === "inativo" ? "border-muted ring-2 ring-muted/40" : "border-border hover:bg-surface-2"
            } ${statusFiltro && statusFiltro !== "inativo" ? "opacity-40" : ""}`}
          >
            <p className="mb-2 text-[11.5px] text-muted">Inativos</p>
            <span className="block font-mono text-2xl font-semibold tabular-nums text-muted">{indicadores.inativo}</span>
          </button>
          <button
            onClick={() => setSoDesktop((atual) => !atual)}
            title="Usuários com o CaxHub Desktop conectado em algum computador (clique para filtrar a lista)"
            className={`rounded-lg border p-5 text-left transition ${
              soDesktop ? "border-primary ring-2 ring-primary/40" : "border-border hover:bg-surface-2"
            }`}
          >
            <p className="mb-2 text-[11.5px] text-muted">Com desktop conectado</p>
            <span className="block font-mono text-2xl font-semibold tabular-nums text-primary">{indicadores.comDesktop}</span>
          </button>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={buscaInput}
          onChange={(e) => setBuscaInput(e.target.value)}
          placeholder="Buscar por nome ou e-mail..."
          className="w-56 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <MultiSelectDropdown
          opcoes={roles.map<MultiSelectOption<number>>((role) => ({ value: role.id, label: role.name }))}
          selecionados={roleFiltro}
          onChange={setRoleFiltro}
          labelTodos="Todos os papéis"
          labelSufixo="papéis"
          acessorio={padroes.estrela("papel")}
        />
        {statusFiltro && (
          <button
            onClick={() => setStatusFiltro(null)}
            className="font-mono text-[10.5px] uppercase tracking-wide text-muted underline hover:text-foreground"
          >
            limpar filtro de situação
          </button>
        )}
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      <TabelaLocal<Usuario, AcoesUsuario>
        chave="admin.usuarios"
        defs={COLUNAS_USUARIOS}
        colunas={COLUNAS_LOCAIS}
        linhas={usuarios}
        ler={lerUsuario}
        chaveLinha={(u) => String(u.id)}
        loading={loading}
        vazio="Nenhum usuário encontrado com esses filtros."
        alturaMax="max-h-[70vh]"
        ctx={{
          logadoId: usuarioLogado?.id,
          computadores: setComputadoresDe,
          reenviarConvite,
          inativar,
          reativar,
          gerarToken: gerarTokenServico,
          editar: abrirEditar,
          excluir,
        }}
      />

      {modalAberto && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-display text-lg font-bold text-foreground">
              {editando ? "Editar usuário" : "Novo usuário"}
            </h2>

            {erroForm && (
              <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {erroForm}
              </p>
            )}

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11.5px] text-muted">
                  E-mail {buscandoSugestaoForm && <span className="text-muted">(buscando...)</span>}
                </label>
                <input
                  type="email"
                  autoComplete="off"
                  value={form.email}
                  onChange={(e) => onEmailFormChange(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {!editando && (
                  <p className="mt-1 text-[11px] text-muted">
                    Se o e-mail bater com um consultor do Senior, nome e papel são sugeridos automaticamente.
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-[11.5px] text-muted">Nome</label>
                <input
                  type="text"
                  autoComplete="off"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11.5px] text-muted">
                  Senha {editando && <span className="text-muted">(deixe em branco para manter a atual)</span>}
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11.5px] text-muted">Papel</label>
                <select
                  value={form.roleId}
                  onChange={(e) => setForm({ ...form, roleId: e.target.value })}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={fecharModal}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
              >
                Cancelar
              </button>
              <button
                onClick={salvar}
                disabled={salvando || !form.nome || !form.email || (!editando && !form.password) || !form.roleId}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {salvando ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {convidarAberto && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-display text-lg font-bold text-foreground">Convidar usuário</h2>

            {erroConvite && (
              <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {erroConvite}
              </p>
            )}

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11.5px] text-muted">
                  E-mail {buscandoSugestao && <span className="text-muted">(buscando...)</span>}
                </label>
                <input
                  type="email"
                  autoComplete="off"
                  value={conviteForm.email}
                  onChange={(e) => onEmailConviteChange(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11.5px] text-muted">Nome</label>
                <input
                  type="text"
                  autoComplete="off"
                  value={conviteForm.nome}
                  onChange={(e) => setConviteForm({ ...conviteForm, nome: e.target.value })}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11.5px] text-muted">Papel</label>
                <select
                  value={conviteForm.roleId}
                  onChange={(e) => setConviteForm({ ...conviteForm, roleId: e.target.value })}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[11.5px] text-muted">
                O convite ainda não envia e-mail automaticamente — depois de criado, você recebe um link pra copiar e mandar
                pra pessoa pelo canal que preferir.
              </p>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={fecharConvidar}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
              >
                Cancelar
              </button>
              <button
                onClick={enviarConvite}
                disabled={enviandoConvite || !conviteForm.nome || !conviteForm.email || !conviteForm.roleId}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {enviandoConvite ? "Gerando..." : "Gerar convite"}
              </button>
            </div>
          </div>
        </div>
      )}

      {linkGerado && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-display text-lg font-bold text-foreground">Link gerado</h2>
            <p className="mb-3 text-[11.5px] text-muted">Copie e envie pro destinatário pelo canal que preferir.</p>
            <div className="break-all rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-foreground">
              {linkGerado}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setLinkGerado(null)}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
              >
                Fechar
              </button>
              <button
                onClick={copiarLink}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                {linkCopiado ? "Copiado!" : "Copiar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {computadoresDe && (
        <ModalComputadoresUsuario
          usuario={computadoresDe}
          onFechar={() => setComputadoresDe(null)}
          onAlterado={(restantes) => {
            // Atualiza a coluna e o KPI sem recarregar (e sem piscar o esqueleto dos cartões).
            setUsuarios((lista) => lista.map((u) => (u.id === computadoresDe.id ? { ...u, desktopConectados: restantes } : u)));
            axios.get("/api/users/indicadores").then(({ data }) => setIndicadores(data)).catch(() => {});
            // Com o filtro "só desktop" ligado, quem ficou sem computador sai da lista.
            if (soDesktop && restantes === 0) carregar();
          }}
        />
      )}
    </div>
  );
}
