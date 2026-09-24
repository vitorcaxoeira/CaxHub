import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import { classeBotaoPrimario, classeBotaoSecundario, classeCampo, classeRotulo } from "../../../components/gestao5s/campos";
import { Modal } from "../../../components/ui/Modal";
import { Skeleton } from "../../../components/ui/Skeleton";
import { useToast } from "../../../components/ui/Toast";
import { cn } from "../../../lib/cn";
import { mensagemDeErro } from "../../../utils/gestao5s";
import { SENSOS, Senso, TIPO_AREA_ROTULO, TipoArea } from "../../../utils/gestao5s";

interface Pergunta {
  id: number;
  tipoArea: TipoArea;
  areaId: number | null;
  areaNome: string | null;
  senso: Senso;
  texto: string;
  ordem: number;
  ativo: boolean;
}

interface AreaOpcao {
  id: number;
  nome: string;
  tipo: TipoArea;
  ehAgrupadora?: boolean;
}

// Formulário da auditoria: perguntas por senso, para setores ou ambientes comuns. Pergunta sem área
// vale para todas as áreas do tipo; com área, só para aquela. Editar o formulário não muda as
// avaliações já feitas (cada resposta guarda o texto da pergunta no momento da avaliação).
export function Perguntas5S() {
  const { mostrar } = useToast();
  const [perguntas, setPerguntas] = useState<Pergunta[] | null>(null);
  const [areas, setAreas] = useState<AreaOpcao[]>([]);
  const [tipoArea, setTipoArea] = useState<TipoArea>("setor");
  const [areaFiltro, setAreaFiltro] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Pergunta | { novo: true; senso: Senso } | null>(null);

  const carregar = useCallback(() => {
    axios
      .get<Pergunta[]>("/api/5s/perguntas")
      .then(({ data }) => {
        setPerguntas(data);
        setErro(null);
      })
      .catch((err) => setErro(mensagemDeErro(err, "Falha ao carregar as perguntas")));
  }, []);

  useEffect(carregar, [carregar]);
  useEffect(() => {
    axios.get<AreaOpcao[]>("/api/5s/areas", { params: { incluirInativas: true } }).then(({ data }) => setAreas(data)).catch(() => {});
  }, []);

  const visiveis = useMemo(
    () => (perguntas ?? []).filter((p) => p.tipoArea === tipoArea && (areaFiltro === "" ? true : areaFiltro === "todas" ? p.areaId == null : String(p.areaId) === areaFiltro)),
    [perguntas, tipoArea, areaFiltro]
  );

  async function mover(senso: Senso, id: number, delta: -1 | 1) {
    const grupo = visiveis.filter((p) => p.senso === senso);
    const i = grupo.findIndex((p) => p.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= grupo.length) return;
    const ids = grupo.map((p) => p.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try {
      await axios.post("/api/5s/perguntas/reordenar", { ids });
      carregar();
    } catch (err) {
      mostrar(mensagemDeErro(err, "Não foi possível reordenar"), "destructive");
    }
  }

  async function alternarAtivo(p: Pergunta) {
    try {
      await axios.put(`/api/5s/perguntas/${p.id}`, { texto: p.texto, senso: p.senso, tipoArea: p.tipoArea, areaId: p.areaId, ordem: p.ordem, ativo: !p.ativo });
      carregar();
    } catch (err) {
      mostrar(mensagemDeErro(err, "Não foi possível alterar"), "destructive");
    }
  }

  async function excluir(p: Pergunta) {
    if (!window.confirm("Excluir esta pergunta?")) return;
    try {
      await axios.delete(`/api/5s/perguntas/${p.id}`);
      carregar();
    } catch (err) {
      mostrar(mensagemDeErro(err, "Não foi possível excluir"), "destructive");
    }
  }

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão 5S · Cadastros</p>
      <h1 className="mb-1 font-display text-2xl font-bold text-foreground">Perguntas do formulário</h1>
      <p className="mb-4 max-w-2xl text-sm text-muted">As alterações valem para as próximas avaliações. Perguntas já usadas só podem ser desativadas.</p>

      <div className="mb-6 grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={classeRotulo}>Formulário de</label>
          <select className={classeCampo} value={tipoArea} onChange={(e) => { setTipoArea(e.target.value as TipoArea); setAreaFiltro(""); }}>
            <option value="setor">{TIPO_AREA_ROTULO.setor}es</option>
            <option value="comum">{TIPO_AREA_ROTULO.comum}s</option>
          </select>
        </div>
        <div>
          <label className={classeRotulo}>Mostrar</label>
          <select className={classeCampo} value={areaFiltro} onChange={(e) => setAreaFiltro(e.target.value)}>
            <option value="">Todas as perguntas</option>
            <option value="todas">Só as de todas as áreas</option>
            {areas.filter((a) => a.tipo === tipoArea && !a.ehAgrupadora).map((a) => (
              <option key={a.id} value={a.id}>
                Só de {a.nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      {erro && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{erro}</p>}
      {!perguntas && !erro && <Skeleton className="h-40 w-full" />}

      {perguntas && (
        <div className="space-y-6">
          {SENSOS.map((s) => {
            const grupo = visiveis.filter((p) => p.senso === s.chave);
            return (
              <section key={s.chave} className="rounded-lg border border-border bg-surface shadow-sm">
                <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-foreground">
                    {s.rotulo} <span className="ml-1 font-normal text-muted">({grupo.length})</span>
                  </h2>
                  <button type="button" onClick={() => setEditando({ novo: true, senso: s.chave })} className="text-xs font-medium text-primary hover:underline">
                    + Pergunta
                  </button>
                </div>
                {grupo.length === 0 && <p className="px-4 py-3 text-sm text-muted">Nenhuma pergunta neste senso.</p>}
                <ul className="divide-y divide-border/60">
                  {grupo.map((p, i) => (
                    <li key={p.id} className="flex items-start gap-3 px-4 py-3">
                      <div className="flex flex-none flex-col">
                        <button type="button" disabled={i === 0} onClick={() => mover(s.chave, p.id, -1)} aria-label="Subir" className="min-h-6 px-1 text-muted hover:text-foreground disabled:opacity-30">
                          ▲
                        </button>
                        <button type="button" disabled={i === grupo.length - 1} onClick={() => mover(s.chave, p.id, 1)} aria-label="Descer" className="min-h-6 px-1 text-muted hover:text-foreground disabled:opacity-30">
                          ▼
                        </button>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm", p.ativo ? "text-foreground" : "text-muted line-through")}>{p.texto}</p>
                        <p className="mt-0.5 text-[11px] text-muted">{p.areaNome ? `Só para ${p.areaNome}` : "Todas as áreas"}</p>
                      </div>
                      <div className="flex flex-none flex-wrap justify-end gap-x-3 gap-y-1 text-xs">
                        <button type="button" onClick={() => setEditando(p)} className="text-primary hover:underline">
                          Editar
                        </button>
                        <button type="button" onClick={() => alternarAtivo(p)} className="text-muted hover:underline">
                          {p.ativo ? "Desativar" : "Ativar"}
                        </button>
                        <button type="button" onClick={() => excluir(p)} className="text-destructive hover:underline">
                          Excluir
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {editando && (
        <FormPergunta
          inicial={"id" in editando ? editando : null}
          sensoInicial={"id" in editando ? editando.senso : editando.senso}
          tipoAreaInicial={tipoArea}
          areas={areas}
          onFechar={(salvou) => {
            setEditando(null);
            if (salvou) carregar();
          }}
        />
      )}
    </div>
  );
}

function FormPergunta({ inicial, sensoInicial, tipoAreaInicial, areas, onFechar }: { inicial: Pergunta | null; sensoInicial: Senso; tipoAreaInicial: TipoArea; areas: AreaOpcao[]; onFechar: (salvou: boolean) => void }) {
  const { mostrar } = useToast();
  const [texto, setTexto] = useState(inicial?.texto ?? "");
  const [senso, setSenso] = useState<Senso>(sensoInicial);
  const [tipoArea, setTipoArea] = useState<TipoArea>(inicial?.tipoArea ?? tipoAreaInicial);
  const [areaId, setAreaId] = useState(inicial?.areaId ? String(inicial.areaId) : "");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      const corpo = { texto, senso, tipoArea, areaId: areaId ? Number(areaId) : null, ...(inicial ? { ordem: inicial.ordem, ativo: inicial.ativo } : {}) };
      if (inicial) await axios.put(`/api/5s/perguntas/${inicial.id}`, corpo);
      else await axios.post("/api/5s/perguntas", corpo);
      mostrar("Pergunta salva", "success");
      onFechar(true);
    } catch (err) {
      mostrar(mensagemDeErro(err, "Não foi possível salvar"), "destructive");
      setSalvando(false);
    }
  }

  return (
    <Modal open onClose={() => onFechar(false)} title={inicial ? "Editar pergunta" : "Nova pergunta"} fecharPorFora={false}>
      <div className="space-y-3">
        <div>
          <label className={classeRotulo}>Pergunta</label>
          <textarea rows={3} className={classeCampo} value={texto} maxLength={600} onChange={(e) => setTexto(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={classeRotulo}>Senso</label>
            <select className={classeCampo} value={senso} onChange={(e) => setSenso(e.target.value as Senso)}>
              {SENSOS.map((s) => (
                <option key={s.chave} value={s.chave}>
                  {s.rotulo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={classeRotulo}>Aplica-se a</label>
            <select className={classeCampo} value={tipoArea} onChange={(e) => { setTipoArea(e.target.value as TipoArea); setAreaId(""); }}>
              <option value="setor">Setores</option>
              <option value="comum">Ambientes comuns</option>
            </select>
          </div>
        </div>
        <div>
          <label className={classeRotulo}>Restringir a uma área (opcional)</label>
          <select className={classeCampo} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            <option value="">Todas as áreas do tipo</option>
            {areas.filter((a) => a.tipo === tipoArea && !a.ehAgrupadora).map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => onFechar(false)} className={classeBotaoSecundario}>
            Cancelar
          </button>
          <button type="button" disabled={salvando || !texto.trim()} onClick={salvar} className={classeBotaoPrimario}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
