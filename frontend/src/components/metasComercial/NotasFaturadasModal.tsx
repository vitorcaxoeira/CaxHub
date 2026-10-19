import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "../ui/Modal";
import { Skeleton } from "../ui/Skeleton";
import { MESES_LONGOS, NotasFaturadasResposta, fmtValor } from "../../lib/metasComercial";
import { Aviso, campo, mensagemDe } from "./comum";

type Ordem = "valor" | "emissao";

const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// Notas que formam o Faturamento de um mês no painel da Gestão de Metas: mesma regra do total (NF fechada, valor bruto dos itens),
// então o rodapé confere com o valor clicado.
export function NotasFaturadasModal({ ano, mes, onClose }: { ano: number; mes: number; onClose: () => void }) {
  const [dados, setDados] = useState<NotasFaturadasResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("valor");

  useEffect(() => {
    let cancelado = false;
    axios
      .get<NotasFaturadasResposta>(`/api/metas-comercial/anos/${ano}/faturamento/notas`, { params: { mes } })
      .then(({ data }) => !cancelado && setDados(data))
      .catch((e) => !cancelado && setErro(mensagemDe(e, "Não foi possível carregar as notas.")));
    return () => {
      cancelado = true;
    };
  }, [ano, mes]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const lista = (dados?.notas ?? []).filter(
      (n) => !termo || String(n.numero).includes(termo) || (n.cliente ?? "").toLowerCase().includes(termo) || (n.representante ?? "").toLowerCase().includes(termo)
    );
    return [...lista].sort((a, b) => (ordem === "valor" ? b.valor - a.valor : b.emissao.localeCompare(a.emissao) || b.numero - a.numero));
  }, [dados, busca, ordem]);
  const totalVisivel = visiveis.reduce((s, n) => s + n.valor, 0);

  return (
    <Modal open onClose={onClose} title={`Notas faturadas — ${MESES_LONGOS[mes - 1]}/${ano}`} subtitulo="NF fechada, valor bruto dos itens de serviço e produto" className="max-w-5xl">
      <div className="space-y-3 p-4">
        {erro && <Aviso>{erro}</Aviso>}
        {!dados && !erro && <Skeleton className="h-64 w-full" />}
        {dados && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="nf-busca" className="sr-only">Buscar</label>
              <input id="nf-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por cliente, número ou representante…" className={`${campo} max-w-sm`} autoFocus />
              <div className="flex gap-1 text-[12.5px]" role="group" aria-label="Ordenar">
                {(["valor", "emissao"] as Ordem[]).map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setOrdem(o)}
                    aria-pressed={ordem === o}
                    className={`rounded-md border px-2.5 py-1 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      ordem === o ? "border-primary text-primary" : "border-border text-muted hover:text-foreground"
                    }`}
                  >
                    {o === "valor" ? "Maior valor" : "Mais recentes"}
                  </button>
                ))}
              </div>
              <span className="ml-auto text-[12.5px] tabular-nums text-muted">
                {visiveis.length === dados.quantidade ? `${dados.quantidade} notas` : `${visiveis.length} de ${dados.quantidade} notas`}
              </span>
            </div>
            <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted">
                    <th className="px-3 py-2 font-medium">Série / Nº</th>
                    <th className="px-3 py-2 font-medium">Emissão</th>
                    <th className="px-3 py-2 font-medium">Cliente</th>
                    <th className="px-3 py-2 font-medium">Representante</th>
                    <th className="px-3 py-2 text-right font-medium">Itens</th>
                    <th className="px-3 py-2 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((n) => (
                    <tr key={`${n.codemp}-${n.codfil}-${n.serie}-${n.numero}`} className="border-b border-border/60">
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{n.serie} / {n.numero}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{dataBr(n.emissao)}</td>
                      <td className="max-w-[18rem] truncate px-3 py-1.5" title={n.cliente ?? undefined}>{n.cliente ?? `Cliente ${n.codcli}`}</td>
                      <td className="max-w-[12rem] truncate px-3 py-1.5 text-muted" title={n.representante ?? undefined}>{n.representante ?? n.codrep}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted">{n.itens}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{fmtValor("BRL", n.valor)}</td>
                    </tr>
                  ))}
                  {visiveis.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-muted">Nenhuma nota com esse filtro.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm tabular-nums">
              {visiveis.length !== dados.quantidade && <span className="text-muted">Filtrado: {fmtValor("BRL", totalVisivel)}</span>}
              <span className="font-semibold text-foreground">Total do mês: {fmtValor("BRL", dados.total)}</span>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
