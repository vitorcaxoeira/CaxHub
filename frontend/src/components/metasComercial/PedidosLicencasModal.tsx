import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "../ui/Modal";
import { Skeleton } from "../ui/Skeleton";
import { MESES_LONGOS, PedidosLicencasResposta, SITUACAO_PEDIDO, fmtValor } from "../../lib/metasComercial";
import { Aviso, campo, mensagemDe } from "./comum";

type Ordem = "valor" | "emissao";

const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// Pedidos de venda que formam as Licenças de um mês no painel da Gestão de Metas: mesma regra do total (emissão no mês, itens com
// rateio na conta financeira 177, valor = preço unitário × quantidade, cancelado fora), então o rodapé confere com o valor clicado.
export function PedidosLicencasModal({ ano, mes, onClose }: { ano: number; mes: number; onClose: () => void }) {
  const [dados, setDados] = useState<PedidosLicencasResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("valor");

  useEffect(() => {
    let cancelado = false;
    axios
      .get<PedidosLicencasResposta>(`/api/metas-comercial/anos/${ano}/licencas/pedidos`, { params: { mes } })
      .then(({ data }) => !cancelado && setDados(data))
      .catch((e) => !cancelado && setErro(mensagemDe(e, "Não foi possível carregar os pedidos.")));
    return () => {
      cancelado = true;
    };
  }, [ano, mes]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const lista = (dados?.pedidos ?? []).filter(
      (p) =>
        !termo ||
        String(p.numped).includes(termo) ||
        (p.cliente ?? "").toLowerCase().includes(termo) ||
        (p.representante ?? "").toLowerCase().includes(termo) ||
        p.servicos.toLowerCase().includes(termo)
    );
    return [...lista].sort((a, b) => (ordem === "valor" ? b.valor - a.valor : b.emissao.localeCompare(a.emissao) || b.numped - a.numped));
  }, [dados, busca, ordem]);
  const totalVisivel = visiveis.reduce((s, p) => s + p.valor, 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Pedidos de venda — Licenças — ${MESES_LONGOS[mes - 1]}/${ano}`}
      subtitulo="Emissão no mês, itens com rateio na conta financeira 177, valor = preço unitário × quantidade, cancelados fora"
      className="max-w-5xl"
    >
      <div className="space-y-3 p-4">
        {erro && <Aviso>{erro}</Aviso>}
        {!dados && !erro && <Skeleton className="h-64 w-full" />}
        {dados && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="pl-busca" className="sr-only">Buscar</label>
              <input id="pl-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por cliente, pedido, representante ou serviço…" className={`${campo} max-w-sm`} autoFocus />
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
                {visiveis.length === dados.quantidade ? `${dados.quantidade} pedidos` : `${visiveis.length} de ${dados.quantidade} pedidos`}
              </span>
            </div>
            <div className="relative max-h-[60vh] overflow-auto rounded-md border border-border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted">
                    <th className="px-3 py-2 font-medium">Pedido</th>
                    <th className="px-3 py-2 font-medium">Emissão</th>
                    <th className="px-3 py-2 font-medium">Cliente</th>
                    <th className="px-3 py-2 font-medium">Representante</th>
                    <th className="px-3 py-2 font-medium">Licença</th>
                    <th className="px-3 py-2 font-medium">Situação</th>
                    <th className="px-3 py-2 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((p) => (
                    <tr key={`${p.codemp}-${p.codfil}-${p.numped}`} className="border-b border-border/60">
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{p.numped}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{dataBr(p.emissao)}</td>
                      <td className="max-w-[16rem] truncate px-3 py-1.5" title={p.cliente ?? undefined}>{p.cliente ?? `Cliente ${p.codcli}`}</td>
                      <td className="max-w-[10rem] truncate px-3 py-1.5 text-muted" title={p.representante ?? undefined}>{p.representante ?? p.codrep ?? "—"}</td>
                      <td className="max-w-[12rem] truncate px-3 py-1.5 text-muted" title={p.servicos}>{p.servicos}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted">{SITUACAO_PEDIDO[p.sitped] ?? p.sitped}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{fmtValor("BRL", p.valor)}</td>
                    </tr>
                  ))}
                  {visiveis.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-muted">Nenhum pedido com esse filtro.</td>
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
