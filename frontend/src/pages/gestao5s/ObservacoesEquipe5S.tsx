import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { Miniatura } from "../../components/gestao5s/Miniatura";
import { UploadFotos } from "../../components/gestao5s/UploadFotos";
import { Visualizador } from "../../components/gestao5s/Visualizador";
import { classeBotaoPrimario, classeBotaoSecundario, classeCampo, classeRotulo } from "../../components/gestao5s/campos";
import { Modal } from "../../components/ui/Modal";
import { Pagination } from "../../components/ui/Pagination";
import { Skeleton } from "../../components/ui/Skeleton";
import { useToast } from "../../components/ui/Toast";
import { mensagemDeErro } from "../../utils/gestao5s";
import { ImagemRef, formatarDiaIso, hojeIso } from "../../utils/gestao5s";

interface Observacao {
  id: number;
  areaId: number;
  areaNome: string;
  dataOcorrido: string;
  texto: string;
  autorNome: string | null;
  imagens: ImagemRef[];
  pode: { editar: boolean };
}

interface AreaOpcao {
  id: number;
  nome: string;
}

// Observações recebidas da equipe (fora da auditoria): "foi relatado que havia um talher sujo
// sobre a mesa da sala de reunião no dia XX/XX". Líderes registram nas áreas que enxergam.
export function ObservacoesEquipe5S() {
  const { mostrar } = useToast();
  const [areas, setAreas] = useState<AreaOpcao[]>([]);
  const [filtros, setFiltros] = useState({ areaId: "", de: "", ate: "" });
  const [page, setPage] = useState(1);
  const [dados, setDados] = useState<{ total: number; itens: Observacao[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState<Observacao | "nova" | null>(null);
  const [foto, setFoto] = useState<string | null>(null);
  const pageSize = 20;

  const carregar = useCallback(() => {
    setLoading(true);
    return axios
      .get<{ total: number; itens: Observacao[] }>("/api/5s/observacoes", {
        params: { ...Object.fromEntries(Object.entries(filtros).filter(([, v]) => v)), page, pageSize },
      })
      .then(({ data }) => {
        setDados(data);
        setErro(null);
      })
      .catch((err) => setErro(mensagemDeErro(err, "Falha ao carregar as observações")))
      .finally(() => setLoading(false));
  }, [filtros, page]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    axios.get<AreaOpcao[]>("/api/5s/areas").then(({ data }) => setAreas(data)).catch(() => {});
  }, []);

  async function excluir(o: Observacao) {
    if (!window.confirm("Excluir esta observação?")) return;
    try {
      await axios.delete(`/api/5s/observacoes/${o.id}`);
      mostrar("Observação excluída", "success");
      carregar();
    } catch (err) {
      mostrar(mensagemDeErro(err, "Não foi possível excluir"), "destructive");
    }
  }

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão 5S</p>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-foreground">Observações da equipe</h1>
        <button type="button" onClick={() => setEditando("nova")} className={`${classeBotaoPrimario} min-h-10`}>
          + Nova observação
        </button>
      </div>
      <p className="mb-4 max-w-2xl text-sm text-muted">Registre o que a equipe relatou, mesmo que não tenha sido visto na auditoria. Elas aparecem na avaliação do mês da área.</p>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="col-span-2 md:col-span-2">
          <label className={classeRotulo}>Setor / ambiente</label>
          <select className={classeCampo} value={filtros.areaId} onChange={(e) => { setFiltros((f) => ({ ...f, areaId: e.target.value })); setPage(1); }}>
            <option value="">Todos</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={classeRotulo}>De</label>
          <input type="date" className={classeCampo} value={filtros.de} onChange={(e) => { setFiltros((f) => ({ ...f, de: e.target.value })); setPage(1); }} />
        </div>
        <div>
          <label className={classeRotulo}>Até</label>
          <input type="date" className={classeCampo} value={filtros.ate} onChange={(e) => { setFiltros((f) => ({ ...f, ate: e.target.value })); setPage(1); }} />
        </div>
      </div>

      {erro && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{erro}</p>}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {loading && !dados && (
          <div className="space-y-2 p-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
        {dados?.itens.length === 0 && <p className="p-6 text-center text-sm text-muted">Nenhuma observação encontrada.</p>}
        <ul className="divide-y divide-border/60">
          {dados?.itens.map((o) => (
            <li key={o.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-[12px] text-muted">
                  <span className="font-semibold text-foreground">{o.areaNome}</span> · ocorrido em {formatarDiaIso(o.dataOcorrido)} · por {o.autorNome ?? "—"}
                </p>
                {o.pode.editar && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setEditando(o)} className="text-xs text-primary hover:underline">
                      Editar
                    </button>
                    <button type="button" onClick={() => excluir(o)} className="text-xs text-destructive hover:underline">
                      Excluir
                    </button>
                  </div>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{o.texto}</p>
              {o.imagens.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {o.imagens.map((img) => (
                    <Miniatura key={img.id} id={img.id} nome={img.nomeArquivo} onAbrir={setFoto} />
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
        <Pagination page={page} pageSize={pageSize} total={dados?.total ?? 0} loading={loading} onPageChange={setPage} label="observações" />
      </div>

      {editando && <FormObservacao inicial={editando === "nova" ? null : editando} areas={areas} onFechar={() => { setEditando(null); carregar(); }} onAbrirFoto={setFoto} />}
      <Visualizador url={foto} onFechar={() => setFoto(null)} />
    </div>
  );
}

function FormObservacao({ inicial, areas, onFechar, onAbrirFoto }: { inicial: Observacao | null; areas: AreaOpcao[]; onFechar: () => void; onAbrirFoto: (u: string) => void }) {
  const { mostrar } = useToast();
  // Depois de salvar, a observação existe e passa a aceitar fotos — o modal continua aberto.
  const [salva, setSalva] = useState<Observacao | null>(inicial);
  const [areaId, setAreaId] = useState(inicial ? String(inicial.areaId) : "");
  const [data, setData] = useState(inicial?.dataOcorrido ?? hojeIso());
  const [texto, setTexto] = useState(inicial?.texto ?? "");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      const corpo = { areaId: Number(areaId), dataOcorrido: data, texto };
      const { data: resp } = salva ? await axios.put<Observacao>(`/api/5s/observacoes/${salva.id}`, corpo) : await axios.post<Observacao>("/api/5s/observacoes", corpo);
      setSalva(resp);
      mostrar(salva ? "Observação atualizada" : "Observação registrada — se quiser, adicione fotos", "success");
    } catch (err) {
      mostrar(mensagemDeErro(err, "Não foi possível salvar"), "destructive");
    } finally {
      setSalvando(false);
    }
  }

  async function recarregarImagens() {
    if (!salva) return;
    const { data: lista } = await axios.get<{ itens: Observacao[] }>("/api/5s/observacoes", { params: { areaId: salva.areaId, pageSize: 100 } });
    const atual = lista.itens.find((o) => o.id === salva.id);
    if (atual) setSalva(atual);
  }

  return (
    <Modal open onClose={onFechar} title={inicial ? "Editar observação" : "Nova observação"} fecharPorFora={false}>
      <div className="space-y-3">
        <div>
          <label className={classeRotulo}>Setor / ambiente</label>
          <select className={classeCampo} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            <option value="">Selecione…</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={classeRotulo}>Data do ocorrido</label>
          <input type="date" className={classeCampo} value={data} max={hojeIso()} onChange={(e) => setData(e.target.value)} />
        </div>
        <div>
          <label className={classeRotulo}>O que foi relatado</label>
          <textarea rows={4} className={classeCampo} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: Foi relatado que havia um talher sujo sobre a mesa da sala de reunião." />
        </div>
        {salva && (
          <div>
            <p className={classeRotulo}>Fotos</p>
            <UploadFotos imagens={salva.imagens} urlUpload={`/api/5s/observacoes/${salva.id}/imagens`} podeEditar onAlterado={recarregarImagens} onAbrir={onAbrirFoto} />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onFechar} className={classeBotaoSecundario}>
            {salva ? "Concluir" : "Cancelar"}
          </button>
          <button type="button" disabled={salvando || !areaId || !texto.trim()} onClick={salvar} className={classeBotaoPrimario}>
            {salvando ? "Salvando…" : salva ? "Salvar alterações" : "Registrar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

