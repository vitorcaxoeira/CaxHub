import axios from "axios";
import { useEffect, useState } from "react";
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
}

interface FormState {
  nome: string;
  email: string;
  password: string;
  roleId: string;
}

const FORM_VAZIO: FormState = { nome: "", email: "", password: "", roleId: "" };

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
    if (!window.confirm(`Excluir o usuário "${usuario.nome}"? Essa ação não pode ser desfeita.`)) return;
    try {
      await axios.delete(`/api/users/${usuario.id}`);
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao excluir usuário");
    }
  }

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Administração · Usuários
      </p>

      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-foreground">Usuários</h1>
        <button
          onClick={abrirCriar}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Novo usuário
        </button>
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
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => abrirEditar(usuario)}
                      className="mr-3 text-sm text-primary hover:underline"
                    >
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
                  <td colSpan={4} className="px-5 py-8 text-center text-sm text-muted">
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
                <label className="mb-1 block text-[11.5px] text-muted">Nome</label>
                <input
                  type="text"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11.5px] text-muted">E-mail</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11.5px] text-muted">
                  Senha {editando && <span className="text-muted">(deixe em branco para manter a atual)</span>}
                </label>
                <input
                  type="password"
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
    </div>
  );
}
