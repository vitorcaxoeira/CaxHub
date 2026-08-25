import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { formatarDuracao } from "../../utils/duracao";

// Default histórico deste componente — Contas a Receber, o primeiro consumidor. Continua
// sendo o default de `apiBase` pra `ContasReceber.tsx`/`FluxoCaixa.tsx` não precisarem passar
// nada (comportamento de sempre, sem mudar linha nenhuma nesses dois arquivos).
const API_BASE_PADRAO = "/api/financeiro/contas-a-receber/sincronizacao";
const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

interface StatusResponse {
  emAndamento: boolean;
  ultimaAtualizacao: string | null;
  // Só presente em endpoints que a calculam (hoje: Contábil) — Contas a Receber não devolve
  // este campo, e o componente simplesmente não mostra a duração nesse caso.
  ultimaDuracaoMs?: number | null;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const dateFormatterCompleta = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const DUAS_HORAS_MS = 2 * 60 * 60 * 1000;

type Formato = "compacto" | "completo";

// "compacto" (default) é o rótulo original, "atualizado às/em ..." — abrevia pro dia atual.
// "completo" é explícito e sempre com data, pedido a partir do uso em Contábil (24/08/2026):
// "Última atualização: DD/MM/AAAA HH:mm", sem abreviar mesmo no dia de hoje.
function formatarLabel(iso: string | null, formato: Formato): string {
  if (!iso) return formato === "completo" ? "Última atualização: sem sincronização registrada" : "sem sincronização registrada";
  const data = new Date(iso);
  if (formato === "completo") {
    return `Última atualização: ${dateFormatterCompleta.format(data)} ${timeFormatter.format(data)}`;
  }
  const hoje = new Date();
  const mesmoDia = data.toDateString() === hoje.toDateString();
  return mesmoDia
    ? `atualizado às ${timeFormatter.format(data)}`
    : `atualizado em ${dateFormatter.format(data)} às ${timeFormatter.format(data)}`;
}

function estaDesatualizado(iso: string | null): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() > DUAS_HORAS_MS;
}

interface SincronizacaoStatusProps {
  onAtualizado: () => void;
  /** Endpoint de status (GET) e disparo (POST) — default é o de Contas a Receber. */
  apiBase?: string;
  /** Ver formatarLabel acima. Default "compacto" preserva o texto original. */
  formato?: Formato;
}

export function SincronizacaoStatus({ onAtualizado, apiBase = API_BASE_PADRAO, formato = "compacto" }: SincronizacaoStatusProps) {
  const { user } = useAuth();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [disparando, setDisparando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function buscarStatus() {
    return axios.get<StatusResponse>(apiBase).then(({ data }) => {
      setStatus(data);
      return data;
    });
  }

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    // O endpoint de status é admin-only (Contábil deixou de ser admin-only em 25/08/2026, mas
    // /sincronizacao continua sendo — ver plano). Sem isso, um gestor recebe 403 silencioso e o
    // rótulo fica preso em "carregando..." pra sempre.
    if (!isAdmin) return;
    buscarStatus().catch(() => {});
  }, [apiBase, isAdmin]);

  function pararPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function iniciarPolling() {
    const inicio = Date.now();
    pollRef.current = setInterval(() => {
      buscarStatus()
        .then((data) => {
          if (!data.emAndamento) {
            pararPolling();
            onAtualizado();
          } else if (Date.now() - inicio > POLL_TIMEOUT_MS) {
            pararPolling();
          }
        })
        .catch(() => pararPolling());
    }, POLL_INTERVAL_MS);
  }

  useEffect(() => () => pararPolling(), []);

  function handleClick() {
    setDisparando(true);
    setErro(null);
    axios
      .post(apiBase)
      .then(() => {
        setStatus((atual) => (atual ? { ...atual, emAndamento: true } : atual));
        iniciarPolling();
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao iniciar sincronização"))
      .finally(() => setDisparando(false));
  }

  const emAndamento = status?.emAndamento ?? false;
  const desatualizado = status ? estaDesatualizado(status.ultimaAtualizacao) : false;

  return (
    <div className="flex items-center gap-3">
      {erro && <span className="text-[11px] text-destructive">{erro}</span>}
      {desatualizado && !emAndamento && (
        <span className="flex items-center gap-1 text-[11px] text-warning" title="Última sincronização com o agente há mais de 2 horas">
          <span className="h-1.5 w-1.5 rounded-full bg-warning" /> desatualizado
        </span>
      )}
      <span className={`text-[11px] ${desatualizado && !emAndamento ? "text-warning" : "text-muted"}`}>
        {status ? formatarLabel(status.ultimaAtualizacao, formato) : "carregando..."}
      </span>
      {formato === "completo" && status?.ultimaDuracaoMs != null && (
        <span className="text-[11px] text-muted">· levou {formatarDuracao(status.ultimaDuracaoMs)}</span>
      )}
      {isAdmin && (
        <button
          onClick={handleClick}
          disabled={disparando || emAndamento}
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-[11.5px] font-medium text-foreground transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={emAndamento || disparando ? "animate-spin" : ""}
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
          {emAndamento || disparando ? "Atualizando..." : "Atualizar"}
        </button>
      )}
    </div>
  );
}
