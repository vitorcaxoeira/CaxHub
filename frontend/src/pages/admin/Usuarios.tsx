import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";

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
};

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

  function carregar() {
    setLoading(true);
    Promise.all([axios.get("/api/users"), axios.get("/api/users/roles")])
      .then(([usersRes, rolesRes]) => {
        setUsuarios(usersRes.data.users);
        setRoles(rolesRes.data.roles);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar usuários"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    carregar();
  }, []);

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
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao excluir usuário");
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

  function copiarLink() {
    if (!linkGerado) return;
    navigator.clipboard.writeText(linkGerado).then(() => {
      setLinkCopiado(true);
    });
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

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Nome
                </th>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  E-mail
                </th>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Papel
                </th>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Status
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((usuario) => (
                <tr key={usuario.id} className="border-t border-border/60 transition hover:bg-surface-2">
                  <td className="px-5 py-3.5 text-sm font-semibold text-foreground">{usuario.nome}</td>
                  <td className="px-5 py-3.5 text-sm text-muted">{usuario.email}</td>
                  <td className="px-5 py-3.5">
                    <span className="inline-block rounded bg-muted/15 px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide text-muted">
                      {usuario.roleName}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`inline-block rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide ${
                        statusTone[usuario.status] ?? statusTone.ativo
                      }`}
                    >
                      {usuario.status === "pendente" ? "Pendente" : "Ativo"}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {usuario.status === "pendente" && (
                      <button onClick={() => reenviarConvite(usuario)} className="mr-3 text-sm text-primary hover:underline">
                        Copiar link
                      </button>
                    )}
                    {usuario.roleName === "system" && (
                      <button onClick={() => gerarTokenServico(usuario)} className="mr-3 text-sm text-primary hover:underline">
                        Gerar token
                      </button>
                    )}
                    <button onClick={() => abrirEditar(usuario)} className="mr-3 text-sm text-primary hover:underline">
                      Editar
                    </button>
                    <button
                      onClick={() => excluir(usuario)}
                      disabled={usuario.id === usuarioLogado?.id}
                      className="text-sm text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
              {usuarios.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                    Nenhum usuário cadastrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
    </div>
  );
}
