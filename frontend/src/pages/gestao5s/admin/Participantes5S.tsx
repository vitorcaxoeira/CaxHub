import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { classeBotaoPrimario, classeBotaoSecundario, classeCampo, classeRotulo } from "../../../components/gestao5s/campos";
import { Modal } from "../../../components/ui/Modal";
import { Skeleton } from "../../../components/ui/Skeleton";
import { useToast } from "../../../components/ui/Toast";
import { mensagemDeErro } from "../../../utils/gestao5s";
import { PAPEL_ROTULO, Papel5S } from "../../../utils/gestao5s";

interface Participante {
  id: number;
  userId: number;
  nome: string;
  email: string;
  papel: Papel5S;
  ativo: boolean;
  areas: { id: number; nome: string }[];
}

interface Setor {
  id: number;
  nome: string;
}

const DESCRICAO_PAPEL: Record<Papel5S, string> = {
  coordenador: "Cuida dos cadastros (áreas, perguntas, participantes) e vê tudo.",
  avaliador: "Realiza as auditorias: responde, altera notas, registra inconsistências e fotos. Vê todos os resultados.",
  lider: "Vê os resultados do(s) setor(es) dele e dos ambientes comuns. Registra observações da equipe.",
};

// Quem acessa o portal 5S. O acesso é do módulo e independe do papel do usuário no CaxHub: o
// usuário precisa existir (Administração › Usuários) e ser cadastrado aqui. Admin do CaxHub é
// coordenador implícito.
export function Participantes5S() {
  const [lista, setLista] = useState<Participante[] | null>(null);
  const [setores, setSetores] = useState<Setor[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Participante | "novo" | null>(null);
  const { mostrar } = useToast();

  const carregar = useCallback(() => {
    axios
      .get<Participante[]>("/api/5s/participantes")
      .then(({ data }) => {
        setLista(data);
        setErro(null);
      })
      .catch((err) => setErro(mensagemDeErro(err, "Falha ao carregar os participantes")));
  }, []);

  useEffect(carregar, [carregar]);
  useEffect(() => {
    axios.get<Setor[]>("/api/5s/areas", { params: { tipo: "setor" } }).then(({ data }) => setSetores(data)).catch(() => {});
  }, []);

  async function remover(p: Participante) {
    if (!window.confirm(`Remover ${p.nome} do portal 5S?`)) return;
    try {
      await axios.delete(`/api/5s/participantes/${p.id}`);
      carregar();
    } catch (err) {
      mostrar(mensagemDeErro(err, "Não foi possível remover"), "destructive");
    }
  }

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão 5S · Cadastros</p>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-foreground">Participantes</h1>
        <button type="button" onClick={() => setEditando("novo")} className={`${classeBotaoPrimario} min-h-10`}>
          + Adicionar participante
        </button>
      </div>

      {erro && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{erro}</p>}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-surface-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                <th className="px-4 py-3">Usuário</th>
                <th className="px-4 py-3">Papel</th>
                <th className="hidden px-4 py-3 md:table-cell">Setores (líder)</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {!lista && (
                <tr>
                  <td colSpan={5} className="px-4 py-3">
                    <Skeleton className="h-5 w-full" />
                  </td>
                </tr>
              )}
              {lista?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-muted">
                    Nenhum participante. Adicione avaliadores e líderes para liberar o acesso ao portal.
                  </td>
                </tr>
              )}
              {lista?.map((p) => (
                <tr key={p.id} className="border-t border-border/60">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-foreground">{p.nome}</p>
                    <p className="text-[11px] text-muted">{p.email}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground">{PAPEL_ROTULO[p.papel]}</td>
                  <td className="hidden px-4 py-3 text-sm text-muted md:table-cell">{p.areas.length ? p.areas.map((a) => a.nome).join(", ") : "—"}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className={p.ativo ? "text-success" : "text-muted"}>{p.ativo ? "Ativo" : "Inativo"}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-xs">
                    <button type="button" onClick={() => setEditando(p)} className="mr-3 text-primary hover:underline">
                      Editar
                    </button>
                    <button type="button" onClick={() => remover(p)} className="text-destructive hover:underline">
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editando && (
        <FormParticipante
          inicial={editando === "novo" ? null : editando}
          setores={setores}
          onFechar={(salvou) => {
            setEditando(null);
            if (salvou) carregar();
          }}
        />
      )}
    </div>
  );
}

function FormParticipante({ inicial, setores, onFechar }: { inicial: Participante | null; setores: Setor[]; onFechar: (salvou: boolean) => void }) {
  const { mostrar } = useToast();
  const [busca, setBusca] = useState("");
  const [usuarios, setUsuarios] = useState<{ id: number; nome: string; email: string }[]>([]);
  const [userId, setUserId] = useState(inicial ? String(inicial.userId) : "");
  const [papel, setPapel] = useState<Papel5S>(inicial?.papel ?? "avaliador");
  const [areaIds, setAreaIds] = useState<number[]>(inicial?.areas.map((a) => a.id) ?? []);
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (inicial) return;
    const t = setTimeout(() => {
      axios
        .get<{ id: number; nome: string; email: string }[]>("/api/5s/participantes/usuarios-disponiveis", { params: { q: busca } })
        .then(({ data }) => setUsuarios(data))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [busca, inicial]);

  async function salvar() {
    setSalvando(true);
    try {
      const corpo = { papel, areaIds, ativo };
      if (inicial) await axios.put(`/api/5s/participantes/${inicial.id}`, corpo);
      else await axios.post("/api/5s/participantes", { ...corpo, userId: Number(userId) });
      mostrar("Participante salvo", "success");
      onFechar(true);
    } catch (err) {
      mostrar(mensagemDeErro(err, "Não foi possível salvar"), "destructive");
      setSalvando(false);
    }
  }

  return (
    <Modal open onClose={() => onFechar(false)} title={inicial ? `Editar ${inicial.nome}` : "Adicionar participante"} fecharPorFora={false}>
      <div className="space-y-3">
        {!inicial && (
          <div>
            <label className={classeRotulo}>Usuário do CaxHub</label>
            <input className={`${classeCampo} mb-2`} placeholder="Buscar por nome ou e-mail…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <select className={classeCampo} size={5} value={userId} onChange={(e) => setUserId(e.target.value)}>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome} — {u.email}
                </option>
              ))}
            </select>
            {usuarios.length === 0 && <p className="mt-1 text-[11px] text-muted">Nenhum usuário ativo disponível. Convide o usuário em Administração › Usuários.</p>}
          </div>
        )}

        <div>
          <p className={classeRotulo}>Papel no 5S</p>
          <div className="space-y-2">
            {(Object.keys(PAPEL_ROTULO) as Papel5S[]).map((p) => (
              <label key={p} className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2.5 has-[:checked]:border-primary has-[:checked]:bg-primary/10">
                <input type="radio" name="papel5s" className="mt-1" checked={papel === p} onChange={() => setPapel(p)} />
                <span>
                  <span className="block text-sm font-medium text-foreground">{PAPEL_ROTULO[p]}</span>
                  <span className="block text-[12px] text-muted">{DESCRICAO_PAPEL[p]}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {papel === "lider" && (
          <div>
            <p className={classeRotulo}>Setores que lidera</p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {setores.map((s) => (
                <label key={s.id} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={areaIds.includes(s.id)} onChange={(e) => setAreaIds((a) => (e.target.checked ? [...a, s.id] : a.filter((x) => x !== s.id)))} />
                  {s.nome}
                </label>
              ))}
              {setores.length === 0 && <p className="text-sm text-muted">Cadastre os setores em Áreas e ambientes.</p>}
            </div>
          </div>
        )}

        {inicial && (
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            Acesso ativo
          </label>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => onFechar(false)} className={classeBotaoSecundario}>
            Cancelar
          </button>
          <button type="button" disabled={salvando || (!inicial && !userId) || (papel === "lider" && areaIds.length === 0)} onClick={salvar} className={classeBotaoPrimario}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
