import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";

const API_BASE = "/api/financeiro/contas-a-receber/sincronizacao";
const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

interface StatusResponse {
  emAndamento: boolean;
  ultimaAtualizacao: string | null;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const timeFormatter = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

function formatarLabel(iso: string | null): string {
  if (!iso) return "sem sincronização registrada";
  const data = new Date(iso);
  const hoje = new Date();
  const mesmoDia = data.toDateString() === hoje.toDateString();
  return mesmoDia
    ? `atualizado às ${timeFormatter.format(data)}`
    : `atualizado em ${dateFormatter.format(data)} às ${timeFormatter.format(data)}`;
}

interface SincronizacaoStatusProps {
  onAtualizado: () => void;
}

export function SincronizacaoStatus({ onAtualizado }: SincronizacaoStatusProps) {
  const { user } = useAuth();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [disparando, setDisparando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function buscarStatus() {
    return axios.get<StatusResponse>(API_BASE).then(({ data }) => {
      setStatus(data);
      return data;
    });
  }

  useEffect(() => {
    buscarStatus().catch(() => {});
  }, []);

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
      .post(API_BASE)
      .then(() => {
        setStatus((atual) => (atual ? { ...atual, emAndamento: true } : atual));
        iniciarPolling();
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao iniciar sincronização"))
      .finally(() => setDisparando(false));
  }

  const emAndamento = status?.emAndamento ?? false;
  const isAdmin = user?.role === "admin";

  return (
    <div className="flex items-center gap-3">
      {erro && <span className="text-[11px] text-destructive">{erro}</span>}
      <span className="text-[11px] text-muted">
        {status ? formatarLabel(status.ultimaAtualizacao) : "carregando..."}
      </span>
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
