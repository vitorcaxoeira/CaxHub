import axios from "axios";
import { useEffect, useState } from "react";
import { OperacionalTitulosTable, OperacionalRow } from "../../../components/financeiro/OperacionalTitulosTable";
import { Skeleton } from "../../../components/ui/Skeleton";

const API_BASE = "/api/financeiro/fluxo-caixa";

interface KpisOperacional {
  vencendoHoje: { valor: number; qtd: number };
  vencendo7d: { valor: number; qtd: number };
  recebidoHoje: { valor: number; qtd: number };
  semBaixa5d: { valor: number; qtd: number };
}

interface ListaOperacional {
  rows: OperacionalRow[];
  page: number;
  pageSize: number;
  total: number;
}

const LISTA_VAZIA: ListaOperacional = { rows: [], page: 1, pageSize: 50, total: 0 };

const CORTES = [
  { key: "vencendo_hoje", label: "Vencendo Hoje" },
  { key: "vencendo_7d", label: "Vencendo em 7 Dias" },
  { key: "recebido_hoje", label: "Recebido Hoje" },
  { key: "sem_baixa_5d", label: "Sem Baixa há +5 Dias" },
];

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;

interface OperacionalTabProps {
  empFilIds?: string;
  refreshKey: number;
}

export function OperacionalTab({ empFilIds, refreshKey }: OperacionalTabProps) {
  const [kpis, setKpis] = useState<KpisOperacional | null>(null);
  const [erroKpis, setErroKpis] = useState<string | null>(null);
  const [loadingKpis, setLoadingKpis] = useState(true);

  const [corte, setCorte] = useState("vencendo_hoje");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [lista, setLista] = useState<ListaOperacional>(LISTA_VAZIA);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [loadingLista, setLoadingLista] = useState(true);

  useEffect(() => {
    setLoadingKpis(true);
    axios
      .get(`${API_BASE}/operacional/kpis`, { params: { empFil: empFilIds } })
      .then(({ data }) => {
        setKpis(data);
        setErroKpis(null);
      })
      .catch((err) => setErroKpis(err.response?.data?.error ?? "Falha ao carregar os indicadores"))
      .finally(() => setLoadingKpis(false));
  }, [empFilIds, refreshKey]);

  useEffect(() => {
    setLoadingLista(true);
    axios
      .get(`${API_BASE}/operacional/titulos`, {
        params: { empFil: empFilIds, corte, q: q || undefined, page, pageSize: 50 },
      })
      .then(({ data }) => {
        setLista(data);
        setErroLista(null);
      })
      .catch((err) => setErroLista(err.response?.data?.error ?? "Falha ao carregar os títulos"))
      .finally(() => setLoadingLista(false));
  }, [empFilIds, corte, q, page, refreshKey]);

  function handleSelectCorte(key: string) {
    setCorte(key);
    setPage(1);
  }

  function handleBuscaChange(novoQ: string) {
    setQ(novoQ);
    setPage(1);
  }

  const cards = kpis
    ? [
        { key: "vencendo_hoje", label: "Vencendo Hoje", valor: kpis.vencendoHoje.valor, qtd: kpis.vencendoHoje.qtd },
        { key: "vencendo_7d", label: "Vencendo em 7 Dias", valor: kpis.vencendo7d.valor, qtd: kpis.vencendo7d.qtd },
        { key: "recebido_hoje", label: "Recebido Hoje", valor: kpis.recebidoHoje.valor, qtd: kpis.recebidoHoje.qtd },
        { key: "sem_baixa_5d", label: "Sem Baixa há +5 Dias", valor: kpis.semBaixa5d.valor, qtd: kpis.semBaixa5d.qtd },
      ]
    : [];

  return (
    <div>
      {erroKpis && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {erroKpis}
        </div>
      )}
      {loadingKpis ? (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-5">
              <Skeleton className="mb-2 h-3.5 w-28" />
              <Skeleton className="h-7 w-20" />
              <Skeleton className="mt-2 h-3 w-16" />
            </div>
          ))}
        </div>
      ) : (
        kpis && (
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((c) => {
              const ativo = corte === c.key;
              return (
                <button
                  key={c.key}
                  onClick={() => handleSelectCorte(c.key)}
                  className={`rounded-lg border p-5 text-left transition ${
                    ativo ? "border-primary bg-surface ring-1 ring-primary" : "border-border bg-surface hover:bg-surface-2"
                  }`}
                >
                  <p className="mb-2 text-[11.5px] text-muted">{c.label}</p>
                  <span className="block font-mono text-2xl font-semibold tabular-nums text-foreground">{fmtMoney(c.valor)}</span>
                  <p className="mt-1.5 text-[11px] text-muted">{c.qtd.toLocaleString("pt-BR")} títulos</p>
                </button>
              );
            })}
          </div>
        )
      )}

      {erroLista && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {erroLista}
        </div>
      )}
      <OperacionalTitulosTable
        rows={lista.rows}
        page={lista.page}
        pageSize={lista.pageSize}
        total={lista.total}
        loading={loadingLista}
        onPageChange={setPage}
        onBuscaChange={handleBuscaChange}
        corte={corte}
        empFilIds={empFilIds}
      />
    </div>
  );
}
