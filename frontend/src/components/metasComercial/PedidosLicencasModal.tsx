import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "../ui/Modal";
import { TabelaLocal } from "../colunas/TabelaLocal";
import type { ColunaLocal } from "../colunas/aplicarLocal";
import type { DefColuna } from "../colunas/useColunasConfiguraveis";
import { Skeleton } from "../ui/Skeleton";
import { MESES_LONGOS, type PedidoLicenca, PedidosLicencasResposta, SITUACAO_PEDIDO, fmtValor } from "../../lib/metasComercial";
import { Aviso, campo, mensagemDe } from "./comum";

type Ordem = "valor" | "emissao";

const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// Pedidos de venda que formam as Licenças de um mês no painel da Gestão de Metas: mesma regra do total (emissão no mês, itens com
// rateio na conta financeira 177, valor = preço unitário × quantidade, cancelado fora), então o rodapé confere com o valor clicado.

// Lista com filtro e ordem por coluna, colunas configuráveis, resumo no rodapé e colunas calculadas (TabelaLocal, 03/11/2026). A busca e a
// ordem de cima continuam valendo: escolhem o que entra e em que ordem a tabela abre.
const LOCAIS: ColunaLocal[] = [
  { nome: "numped", tipo: "inteiro", obrigatoria: true },
  { nome: "emissao", tipo: "data", obrigatoria: true, utc: true },
  { nome: "cliente", tipo: "texto" },
  { nome: "representante", tipo: "texto" },
  { nome: "servicos", tipo: "texto" },
  { nome: "situacao", tipo: "texto" },
  { nome: "valor", tipo: "decimal", obrigatoria: true },
];
const lerPedido = (p: PedidoLicenca, nome: string): unknown => (nome === "situacao" ? SITUACAO_PEDIDO[p.sitped] ?? p.sitped : (p as unknown as Record<string, unknown>)[nome]);
const brl = (v: number) => fmtValor("BRL", v);
const COLUNAS: DefColuna<PedidoLicenca>[] = [
  { nome: "numped", titulo: "Pedido", fixa: true, largura: 90, classe: "tabular-nums", resumos: ["contagem", "distintos"], render: (p) => p.numped },
  { nome: "emissao", titulo: "Emissão", largura: 100, classe: "tabular-nums", render: (p) => dataBr(p.emissao) },
  { nome: "cliente", titulo: "Cliente", largura: 240, texto: (p) => p.cliente ?? `Cliente ${p.codcli}`, render: (p) => p.cliente ?? `Cliente ${p.codcli}` },
  { nome: "representante", titulo: "Representante", largura: 160, classe: "text-muted", texto: (p) => p.representante, render: (p) => p.representante ?? p.codrep ?? "—" },
  { nome: "servicos", titulo: "Licença", largura: 180, classe: "text-muted", texto: (p) => p.servicos, render: (p) => p.servicos },
  { nome: "situacao", titulo: "Situação", largura: 140, classe: "text-muted", render: (p) => SITUACAO_PEDIDO[p.sitped] ?? p.sitped },
  { nome: "valor", titulo: "Valor", direita: true, largura: 130, classe: "tabular-nums", formatarResumo: brl, render: (p) => brl(p.valor) },
];
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
            <TabelaLocal<PedidoLicenca>
              chave="comercial.metas.pedidos-licencas"
              defs={COLUNAS}
              colunas={LOCAIS}
              linhas={visiveis}
              ler={lerPedido}
              chaveLinha={(p) => `${p.codemp}-${p.codfil}-${p.numped}`}
              vazio="Nenhum pedido com esse filtro."
            />
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
