import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { classeBotaoPrimario, classeBotaoSecundario, classeCampo, classeRotulo } from "../../../components/gestao5s/campos";
import { Modal } from "../../../components/ui/Modal";
import { TabelaLocal } from "../../../components/colunas/TabelaLocal";
import type { ColunaLocal } from "../../../components/colunas/aplicarLocal";
import type { DefColuna } from "../../../components/colunas/useColunasConfiguraveis";
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
  ehAgrupadora?: boolean;
}

const DESCRICAO_PAPEL: Record<Papel5S, string> = {
  coordenador: "Cuida dos cadastros (áreas, perguntas, participantes) e vê tudo.",
  avaliador: "Realiza as auditorias: responde, altera notas, registra inconsistências e fotos. Vê todos os resultados.",
  lider: "Vê os resultados do(s) setor(es) dele e dos ambientes comuns. Registra observações da equipe.",
};

// Quem acessa o portal 5S. O acesso é do módulo e independe do papel do usuário no CaxHub: o
// usuário precisa existir (Administração › Usuários) e ser cadastrado aqui. Admin do CaxHub é
// coordenador implícito.

// Participantes com filtro e ordem por coluna e colunas configuráveis (TabelaLocal, 03/11/2026). As ações da linha vêm por ctx.
interface AcoesParticipante {
  editar: (p: Participante) => void;
  remover: (p: Participante) => void;
}
const LOCAIS_PARTICIPANTES: ColunaLocal[] = [
  { nome: "nome", tipo: "texto", obrigatoria: true },
  { nome: "email", tipo: "texto", obrigatoria: true },
  { nome: "papelRotulo", tipo: "texto", obrigatoria: true },
  { nome: "setores", tipo: "texto" },
  { nome: "situacao", tipo: "texto", obrigatoria: true },
];
const COLUNAS_PARTICIPANTES: DefColuna<Participante, AcoesParticipante>[] = [
  {
    nome: "nome",
    titulo: "Usuário",
    fixa: true,
    largura: 240,
    texto: (p) => p.nome,
    render: (p) => (
      <>
        <p className="truncate text-sm font-medium text-foreground">{p.nome}</p>
        <p className="truncate text-[11px] text-muted">{p.email}</p>
      </>
    ),
  },
  { nome: "email", titulo: "E-mail", largura: 220, classe: "text-sm text-muted", texto: (p) => p.email, render: (p) => p.email },
  { nome: "papelRotulo", titulo: "Papel", largura: 130, classe: "text-sm text-foreground", render: (p) => PAPEL_ROTULO[p.papel] },
  {
    nome: "setores",
    titulo: "Setores (líder)",
    largura: 220,
    classe: "text-sm text-muted",
    texto: (p) => p.areas.map((a) => a.nome).join(", "),
    render: (p) => (p.areas.length ? p.areas.map((a) => a.nome).join(", ") : "—"),
  },
  { nome: "situacao", titulo: "Situação", largura: 100, classe: "text-xs", render: (p) => <span className={p.ativo ? "text-success" : "text-muted"}>{p.ativo ? "Ativo" : "Inativo"}</span> },
  {
    nome: "acoes",
    titulo: "Ações",
    semOrdenar: true,
    direita: true,
    largura: 150,
    render: (p, x) => (
      <span className="whitespace-nowrap text-xs">
        <button type="button" onClick={() => x.editar(p)} className="mr-3 text-primary hover:underline">
          Editar
        </button>
        <button type="button" onClick={() => x.remover(p)} className="text-destructive hover:underline">
          Remover
        </button>
      </span>
    ),
  },
];
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
    axios.get<Setor[]>("/api/5s/areas", { params: { tipo: "setor" } }).then(({ data }) => setSetores(data.filter((s) => !s.ehAgrupadora))).catch(() => {});
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

      <TabelaLocal<Participante, AcoesParticipante>
        chave="gestao5s.participantes"
        defs={COLUNAS_PARTICIPANTES}
        colunas={LOCAIS_PARTICIPANTES}
        linhas={lista ?? []}
        ler={(p, nome) =>
          nome === "papelRotulo"
            ? PAPEL_ROTULO[p.papel]
            : nome === "setores"
              ? p.areas.map((a) => a.nome).join(", ") || null
              : nome === "situacao"
                ? p.ativo ? "Ativo" : "Inativo"
                : (p as unknown as Record<string, unknown>)[nome]
        }
        ctx={{ editar: setEditando, remover }}
        chaveLinha={(p) => String(p.id)}
        loading={!lista}
        vazio="Nenhum participante. Adicione avaliadores e líderes para liberar o acesso ao portal."
      />

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
