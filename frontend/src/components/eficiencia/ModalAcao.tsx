import axios from "axios";
import { FormEvent, useEffect, useState } from "react";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { AcaoDto, ResponsavelOpcao, SugestaoAcao } from "../../lib/eficiencia";

const TITULO_MAX = 200;
const OBSERVACAO_MAX = 1000;

// Formulário do Plano de ação: cria a partir de uma sugestão (alerta, proposta ou consultor) ou edita uma ação existente.
// A proposta de referência e a origem não mudam depois de criadas (só o texto, o prazo e o responsável).
export function ModalAcao({
  aberto,
  sugestao,
  editando,
  responsaveis,
  hoje,
  onSalvo,
  onFechar,
}: {
  aberto: boolean;
  /** Preenche uma ação NOVA. */
  sugestao: SugestaoAcao | null;
  /** Se vier, é edição dessa ação. */
  editando: AcaoDto | null;
  responsaveis: ResponsavelOpcao[];
  /** "AAAA-MM-DD" de hoje em São Paulo (vem do servidor): prazo novo não pode ser anterior. */
  hoje: string;
  onSalvo: () => void;
  onFechar: () => void;
}) {
  const { mostrar } = useToast();
  const [titulo, setTitulo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [prazo, setPrazo] = useState("");
  const [responsavel, setResponsavel] = useState<number | "">("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setEnviando(false);
    if (editando) {
      setTitulo(editando.titulo);
      setObservacao(editando.observacao ?? "");
      setPrazo(editando.prazo);
      setResponsavel(editando.responsavelCodfor);
    } else {
      setTitulo(sugestao?.titulo ?? "");
      setObservacao("");
      setPrazo("");
      // Se a sugestão aponta um consultor do time, ele já vem como responsável (o gestor troca se quiser).
      setResponsavel(sugestao?.codforAlvo != null && responsaveis.some((r) => r.codfor === sugestao.codforAlvo) ? sugestao.codforAlvo : "");
    }
  }, [aberto, editando, sugestao, responsaveis]);

  const prazoMudou = !editando || prazo !== editando.prazo;
  const invalido = titulo.trim().length === 0 || responsavel === "" || !/^\d{4}-\d{2}-\d{2}$/.test(prazo) || (prazoMudou && prazo < hoje);
  const referencia = editando
    ? [editando.codpro != null ? `PS ${editando.codpro}${editando.cliente ? ` · ${editando.cliente}` : ""}` : null, editando.alvoNome].filter(Boolean).join(" · ")
    : sugestao?.referencia ?? "";
  // Responsável atual que saiu da lista (ex.: foi movido de time): mantém a opção pra não apagar o dono sem querer.
  const opcoes = editando && !responsaveis.some((r) => r.codfor === editando.responsavelCodfor)
    ? [{ codfor: editando.responsavelCodfor, nome: editando.responsavelNome }, ...responsaveis]
    : responsaveis;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (invalido || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      if (editando) {
        await axios.patch(`/api/eficiencia/acoes/${editando.id}`, {
          titulo: titulo.trim(),
          observacao: observacao.trim() || null,
          prazo,
          responsavelCodfor: responsavel,
        });
        mostrar("Ação atualizada.", "success");
      } else {
        await axios.post("/api/eficiencia/acoes", {
          titulo: titulo.trim(),
          observacao: observacao.trim() || undefined,
          prazo,
          responsavelCodfor: responsavel,
          codemp: sugestao?.codemp,
          codpro: sugestao?.codpro,
          codforAlvo: sugestao?.codforAlvo,
          origemAlerta: sugestao?.origemAlerta,
        });
        mostrar("Ação criada. O responsável foi avisado.", "success");
      }
      onSalvo();
    } catch (e2) {
      setErro(axios.isAxiosError(e2) ? e2.response?.data?.error ?? "Não foi possível salvar a ação." : "Não foi possível salvar a ação.");
      setEnviando(false);
    }
  }

  const campo =
    "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <Modal open={aberto} onClose={onFechar} title={editando ? "Editar ação" : "Nova ação"} subtitulo={referencia || undefined} fecharPorFora={false}>
      <form onSubmit={enviar} className="space-y-4">
        <div>
          <label htmlFor="acao-titulo" className="mb-1 block text-[13px] font-medium text-foreground">
            O que precisa ser feito
          </label>
          <input id="acao-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={TITULO_MAX} className={campo} required autoFocus />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="acao-resp" className="mb-1 block text-[13px] font-medium text-foreground">
              Responsável
            </label>
            <select id="acao-resp" value={responsavel} onChange={(e) => setResponsavel(e.target.value === "" ? "" : Number(e.target.value))} className={campo} required>
              <option value="">Selecione…</option>
              {opcoes.map((r) => (
                <option key={r.codfor} value={r.codfor}>
                  {r.nome}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="acao-prazo" className="mb-1 block text-[13px] font-medium text-foreground">
              Prazo
            </label>
            <input id="acao-prazo" type="date" value={prazo} min={prazoMudou ? hoje : undefined} onChange={(e) => setPrazo(e.target.value)} className={campo} required />
          </div>
        </div>

        <div>
          <label htmlFor="acao-obs" className="mb-1 block text-[13px] font-medium text-foreground">
            Observação <span className="text-muted">(opcional)</span>
          </label>
          <textarea id="acao-obs" value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3} maxLength={OBSERVACAO_MAX} className={`${campo} resize-y`} />
        </div>

        {prazoMudou && prazo !== "" && prazo < hoje && <p className="text-[12.5px] text-destructive">O prazo não pode ser anterior a hoje.</p>}
        {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{erro}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            disabled={enviando}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={invalido || enviando}
            className="rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            {enviando ? "Salvando…" : editando ? "Salvar" : "Criar ação"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
