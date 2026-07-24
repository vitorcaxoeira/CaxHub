import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { NoCronogramaCompleto } from "../../hooks/useCronograma";
import { HorasAgregadas, calcularOrcamentoItem, descreverSaldoDistribuicao, formatHorasCompacto } from "../../lib/cronograma";
import { horasParaMinutos, minutosParaInputHoras } from "../../utils/horas";
import { Modal } from "../ui/Modal";
import { Avatar } from "../ui/Avatar";
import { Spinner } from "../ui/Spinner";

interface ConsultorElegivel {
  codfor: number;
  nome: string;
  fotoUrl: string | null;
}

type DestinoModal = "item" | "pasta_existente" | "nova_pasta";

interface ModalAlocarConsultoresProps {
  // Nó onde o "..." foi aberto — item ou pasta filha de item. Se pasta, o destino já
  // está implícito (essa pasta); se item, o campo "Destino" decide.
  no: NoCronogramaCompleto;
  // Item ancestral resolvido subindo a árvore a partir de `no` (pode ser o próprio `no`).
  item: NoCronogramaCompleto;
  // Árvore inteira — só usada aqui pra listar as pastas filhas diretas do item (opção
  // "Pasta existente" do destino).
  nos: NoCronogramaCompleto[];
  agregados: Map<number, HorasAgregadas>;
  larguraHoras: number;
  codemp: string;
  codpro: string;
  onFechar: () => void;
  // Mesma função de refetch usada pelo resto da árvore (ArvoreCronograma.onTentarNovamente)
  // — chamada tanto no sucesso (pra árvore refletir as atividades novas) quanto num 409
  // (saldo mudou no meio-tempo — recarrega em segundo plano sem fechar o modal).
  recarregar: () => void;
}

const dinheiroPassoMinutos = 5;

// Rateia o saldo entre `qtd` consultores, cada linha arredondada pra baixo em múltiplos
// de 5min — exceto a primeira, que absorve o resto pra soma bater exatamente com o
// saldo (evita que "Distribuir igualmente" já nasça acima do saldo por causa do
// arredondamento nas demais linhas).
function distribuirIgualmente(saldoMinutos: number, qtd: number): number[] {
  if (qtd <= 0) return [];
  if (saldoMinutos <= 0) return Array(qtd).fill(0);
  const baseBruta = Math.max(0, Math.floor(saldoMinutos / qtd / dinheiroPassoMinutos) * dinheiroPassoMinutos);
  const valores = Array(qtd).fill(baseBruta);
  valores[0] = saldoMinutos - baseBruta * (qtd - 1);
  return valores;
}

export function ModalAlocarConsultores({
  no,
  item,
  nos,
  agregados,
  larguraHoras,
  codemp,
  codpro,
  onFechar,
  recarregar,
}: ModalAlocarConsultoresProps) {
  const [consultores, setConsultores] = useState<ConsultorElegivel[] | null>(null);
  const [loadingConsultores, setLoadingConsultores] = useState(true);
  const [erroConsultores, setErroConsultores] = useState<string | null>(null);

  const [marcados, setMarcados] = useState<Record<number, boolean>>({});
  const [horasInput, setHorasInput] = useState<Record<number, string>>({});

  const [destinoTipo, setDestinoTipo] = useState<DestinoModal>("item");
  const [pastaExistenteId, setPastaExistenteId] = useState("");
  const [novaPastaNome, setNovaPastaNome] = useState("");

  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  const ehItem = no.tipo === "item";

  useEffect(() => {
    if (item.depexe == null) {
      setLoadingConsultores(false);
      return;
    }
    setLoadingConsultores(true);
    axios
      .get("/api/alocacao/consultores-elegiveis", { params: { depexe: item.depexe } })
      .then(({ data }) => {
        setConsultores(data.consultores);
        setErroConsultores(null);
      })
      .catch((err) => setErroConsultores(err.response?.data?.error ?? "Falha ao carregar consultores do departamento"))
      .finally(() => setLoadingConsultores(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.depexe]);

  const pastasFilhasDoItem = useMemo(
    () => nos.filter((n) => n.tipo === "pasta" && n.parentId === item.id).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [nos, item.id]
  );

  const orcamentoItem = useMemo(() => calcularOrcamentoItem(item, agregados), [item, agregados]);
  const saldoLivreMinutos = orcamentoItem.saldoDistribuicao;
  const saldoDescrito = useMemo(() => descreverSaldoDistribuicao(orcamentoItem, larguraHoras), [orcamentoItem, larguraHoras]);

  const marcadosList = useMemo(() => (consultores ?? []).filter((c) => marcados[c.codfor]), [consultores, marcados]);
  const totalMinutos = useMemo(
    () => marcadosList.reduce((soma, c) => soma + (horasParaMinutos(horasInput[c.codfor] ?? "") ?? 0), 0),
    [marcadosList, horasInput]
  );
  const excedeSaldo = totalMinutos > saldoLivreMinutos;

  function alternarMarcado(codfor: number) {
    setMarcados((atual) => ({ ...atual, [codfor]: !atual[codfor] }));
  }

  function distribuirIgual() {
    if (marcadosList.length === 0) return;
    const valores = distribuirIgualmente(saldoLivreMinutos, marcadosList.length);
    setHorasInput((atual) => {
      const proximo = { ...atual };
      marcadosList.forEach((c, i) => {
        proximo[c.codfor] = minutosParaInputHoras(valores[i]);
      });
      return proximo;
    });
  }

  const destinoValido =
    ehItem &&
    ((destinoTipo === "item") ||
      (destinoTipo === "pasta_existente" && pastaExistenteId !== "") ||
      (destinoTipo === "nova_pasta" && novaPastaNome.trim() !== ""));

  const podeConfirmar =
    !salvando &&
    item.depexe != null &&
    (consultores?.length ?? 0) > 0 &&
    marcadosList.length > 0 &&
    !excedeSaldo &&
    totalMinutos > 0 &&
    marcadosList.every((c) => (horasParaMinutos(horasInput[c.codfor] ?? "") ?? 0) > 0) &&
    (!ehItem || destinoValido);

  async function confirmar() {
    if (!podeConfirmar) return;
    setSalvando(true);
    setErroSalvar(null);
    try {
      const destino =
        !ehItem
          ? { tipo: "pasta" as const, pastaId: no.id }
          : destinoTipo === "pasta_existente"
            ? { tipo: "pasta" as const, pastaId: Number(pastaExistenteId) }
            : destinoTipo === "nova_pasta"
              ? { tipo: "nova_pasta" as const, nome: novaPastaNome.trim() }
              : { tipo: "item" as const };

      await axios.post(`/api/alocacao/itens/${codemp}/${codpro}/${item.seqite}/alocar-lote`, {
        destino,
        consultores: marcadosList.map((c) => ({ codfor: c.codfor, qtdhor: horasParaMinutos(horasInput[c.codfor] ?? "") ?? 0 })),
      });
      recarregar();
      onFechar();
    } catch (err) {
      const axiosErr = err as { response?: { status?: number; data?: { error?: string } } };
      setErroSalvar(axiosErr.response?.data?.error ?? "Falha ao criar as atividades");
      // Saldo mudou no meio-tempo — recarrega a árvore em segundo plano (o modal continua
      // aberto, o usuário ajusta as horas com o saldo atualizado e tenta de novo).
      if (axiosErr.response?.status === 409) recarregar();
    } finally {
      setSalvando(false);
    }
  }

  const selectClass =
    "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <Modal
      open
      onClose={onFechar}
      title={no.nome}
      subtitulo={ehItem ? saldoDescrito.texto : `${item.nome} · ${saldoDescrito.texto}`}
    >
      <div className="space-y-4">
        {ehItem && (
          <div>
            <p className="mb-1.5 text-[11.5px] font-medium text-muted">Destino</p>
            <div className="flex flex-wrap gap-1.5 rounded-md border border-border p-1">
              <button
                type="button"
                onClick={() => setDestinoTipo("item")}
                className={`rounded px-2.5 py-1.5 text-[12.5px] font-medium transition ${
                  destinoTipo === "item" ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                Direto no item
              </button>
              <button
                type="button"
                disabled={pastasFilhasDoItem.length === 0}
                onClick={() => setDestinoTipo("pasta_existente")}
                className={`rounded px-2.5 py-1.5 text-[12.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  destinoTipo === "pasta_existente" ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                Pasta existente
              </button>
              <button
                type="button"
                onClick={() => setDestinoTipo("nova_pasta")}
                className={`rounded px-2.5 py-1.5 text-[12.5px] font-medium transition ${
                  destinoTipo === "nova_pasta" ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                Nova pasta
              </button>
            </div>
            {destinoTipo === "pasta_existente" && (
              <select value={pastaExistenteId} onChange={(e) => setPastaExistenteId(e.target.value)} className={`${selectClass} mt-2`}>
                <option value="">Selecione a pasta...</option>
                {pastasFilhasDoItem.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            )}
            {destinoTipo === "nova_pasta" && (
              <input
                type="text"
                autoFocus
                value={novaPastaNome}
                onChange={(e) => setNovaPastaNome(e.target.value)}
                placeholder="Nome da nova pasta"
                className={`${selectClass} mt-2`}
              />
            )}
          </div>
        )}

        {item.depexe == null ? (
          <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
            Item sem departamento de execução definido.
          </p>
        ) : loadingConsultores ? (
          <div className="flex items-center justify-center py-8">
            <Spinner className="h-5 w-5" />
          </div>
        ) : erroConsultores ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">{erroConsultores}</p>
        ) : (consultores?.length ?? 0) === 0 ? (
          <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
            Nenhum consultor cadastrado no time do departamento {item.depexeLabel}.
          </p>
        ) : (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11.5px] font-medium text-muted">Consultores do time · {item.depexeLabel}</p>
              <button
                type="button"
                onClick={distribuirIgual}
                disabled={marcadosList.length === 0}
                className="text-[11.5px] font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
              >
                Distribuir igualmente
              </button>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-1.5">
              {consultores!.map((c) => {
                const check = !!marcados[c.codfor];
                return (
                  <label
                    key={c.codfor}
                    className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 transition ${check ? "bg-primary/5" : "hover:bg-surface-2"}`}
                  >
                    <input
                      type="checkbox"
                      checked={check}
                      onChange={() => alternarMarcado(c.codfor)}
                      className="h-4 w-4 flex-none accent-primary"
                    />
                    <Avatar nome={c.nome} fotoUrl={c.fotoUrl} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{c.nome}</span>
                    <input
                      type="text"
                      placeholder="0:00"
                      value={horasInput[c.codfor] ?? ""}
                      disabled={!check}
                      onChange={(e) => setHorasInput((atual) => ({ ...atual, [c.codfor]: e.target.value }))}
                      className="w-20 flex-none rounded-md border border-border bg-surface px-2 py-1 text-right font-mono text-[12.5px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {erroSalvar && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">{erroSalvar}</p>}

        <div className="flex items-center justify-between border-t border-border pt-3">
          <p className={`font-mono text-[12.5px] tabular-nums ${excedeSaldo ? "text-destructive" : "text-muted"}`}>
            Total: {formatHorasCompacto(totalMinutos, larguraHoras)} / {formatHorasCompacto(saldoLivreMinutos, larguraHoras)} livres
            {excedeSaldo && ` — excede em ${formatHorasCompacto(totalMinutos - saldoLivreMinutos, larguraHoras)}`}
          </p>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={!podeConfirmar}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {salvando && <Spinner className="h-3.5 w-3.5" />}
            {salvando ? "Criando..." : `Criar ${marcadosList.length || ""} atividade${marcadosList.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
