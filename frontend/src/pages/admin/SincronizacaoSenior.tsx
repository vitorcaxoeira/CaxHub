import axios from "axios";
import { useEffect, useState } from "react";

interface ItemSincronizacao {
  id: number;
  atividadeId: number;
  codpro: number;
  tipo: string;
  payload: Record<string, unknown>;
  status: string;
  tentativas: number;
  ultimoErro: string | null;
  criadoEm: string;
  processadoEm: string | null;
}

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

const statusTone: Record<string, string> = {
  pendente: "bg-warning/15 text-warning",
  enviado: "bg-success/15 text-success",
  bloqueado: "bg-destructive/15 text-destructive",
};

export function SincronizacaoSenior() {
  const [itens, setItens] = useState<ItemSincronizacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [reprocessando, setReprocessando] = useState<number | null>(null);

  function carregar() {
    setLoading(true);
    axios
      .get("/api/sincronizacao")
      .then(({ data }) => {
        setItens(data.itens);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar fila de sincronização"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    carregar();
  }, []);

  async function reprocessar(id: number) {
    setReprocessando(id);
    try {
      await axios.post(`/api/sincronizacao/${id}/reprocessar`);
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao reprocessar item");
    } finally {
      setReprocessando(null);
    }
  }

  const totais = {
    pendente: itens.filter((i) => i.status === "pendente").length,
    bloqueado: itens.filter((i) => i.status === "bloqueado").length,
    enviado: itens.filter((i) => i.status === "enviado").length,
  };

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Administração · Sincronização Senior
      </p>

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Sincronização com o Senior</h1>
        <p className="mt-1 text-sm text-muted">
          Fila (outbox) de mudanças feitas no CaxHub que precisam ser propagadas de volta pro ERP Senior. O canal de
          escrita do Senior ainda não foi confirmado — por isso os itens abaixo tendem a acumular em "Bloqueado" até
          esse canal existir.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        <div className="bg-surface p-5">
          <p className="mb-2 text-[11.5px] text-muted">Pendentes</p>
          <span className="block font-mono text-2xl font-semibold tabular-nums text-warning">{totais.pendente}</span>
        </div>
        <div className="bg-surface p-5">
          <p className="mb-2 text-[11.5px] text-muted">Bloqueados</p>
          <span className="block font-mono text-2xl font-semibold tabular-nums text-destructive">{totais.bloqueado}</span>
        </div>
        <div className="bg-surface p-5">
          <p className="mb-2 text-[11.5px] text-muted">Enviados</p>
          <span className="block font-mono text-2xl font-semibold tabular-nums text-success">{totais.enviado}</span>
        </div>
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
                  Proposta
                </th>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Tipo
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Tentativas
                </th>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Último erro
                </th>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Criado em
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Status
                </th>
                <th className="bg-surface-2 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr key={item.id} className="border-t border-border/60 transition hover:bg-surface-2">
                  <td className="px-5 py-3.5 text-sm font-semibold text-foreground">{item.codpro}</td>
                  <td className="px-5 py-3.5 text-sm text-muted">{item.tipo}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-muted">{item.tentativas}</td>
                  <td className="max-w-[280px] truncate px-5 py-3.5 text-[12px] text-destructive" title={item.ultimoErro ?? ""}>
                    {item.ultimoErro ?? "—"}
                  </td>
                  <td className="px-5 py-3.5 text-[12px] text-muted">{dateTimeFormatter.format(new Date(item.criadoEm))}</td>
                  <td className="px-5 py-3.5 text-right">
                    <span
                      className={`inline-block rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide ${
                        statusTone[item.status] ?? statusTone.pendente
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {item.status === "bloqueado" && (
                      <button
                        onClick={() => reprocessar(item.id)}
                        disabled={reprocessando === item.id}
                        className="text-sm text-primary hover:underline disabled:opacity-50"
                      >
                        {reprocessando === item.id ? "Reprocessando..." : "Reprocessar"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {itens.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm text-muted">
                    Nenhum item na fila de sincronização.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
