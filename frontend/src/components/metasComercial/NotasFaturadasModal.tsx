import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "../ui/Modal";
import { TabelaLocal } from "../colunas/TabelaLocal";
import type { ColunaLocal } from "../colunas/aplicarLocal";
import type { DefColuna } from "../colunas/useColunasConfiguraveis";
import { Skeleton } from "../ui/Skeleton";
import { MESES_LONGOS, type NotaFaturada, NotasFaturadasResposta, fmtValor } from "../../lib/metasComercial";
import { Aviso, campo, mensagemDe } from "./comum";

type Ordem = "valor" | "emissao";

const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// Notas que formam o Faturamento de um mês no painel da Gestão de Metas: mesma regra do total (NF fechada, valor bruto dos itens),
// então o rodapé confere com o valor clicado.

// Lista com filtro e ordem por coluna, colunas configuráveis, resumo no rodapé e colunas calculadas (TabelaLocal, 03/11/2026). A busca e a
// ordem de cima continuam valendo: escolhem o que entra e em que ordem a tabela abre.
const LOCAIS: ColunaLocal[] = [
  { nome: "numero", tipo: "inteiro", obrigatoria: true },
  { nome: "serie", tipo: "texto", obrigatoria: true },
  { nome: "emissao", tipo: "data", obrigatoria: true, utc: true },
  { nome: "cliente", tipo: "texto" },
  { nome: "representante", tipo: "texto" },
  { nome: "itens", tipo: "inteiro", obrigatoria: true },
  { nome: "valor", tipo: "decimal", obrigatoria: true },
];
const brl = (v: number) => fmtValor("BRL", v);
const COLUNAS: DefColuna<NotaFaturada>[] = [
  { nome: "numero", titulo: "Série / Nº", fixa: true, largura: 110, classe: "tabular-nums", resumos: ["contagem", "distintos"], render: (n) => `${n.serie} / ${n.numero}` },
  { nome: "serie", titulo: "Série", largura: 70, classe: "text-muted", render: (n) => n.serie },
  { nome: "emissao", titulo: "Emissão", largura: 100, classe: "tabular-nums", render: (n) => dataBr(n.emissao) },
  { nome: "cliente", titulo: "Cliente", largura: 260, texto: (n) => n.cliente ?? `Cliente ${n.codcli}`, render: (n) => n.cliente ?? `Cliente ${n.codcli}` },
  { nome: "representante", titulo: "Representante", largura: 180, classe: "text-muted", texto: (n) => n.representante, render: (n) => n.representante ?? n.codrep },
  { nome: "itens", titulo: "Itens", direita: true, largura: 70, classe: "tabular-nums text-muted", render: (n) => n.itens },
  { nome: "valor", titulo: "Valor", direita: true, largura: 130, classe: "tabular-nums", formatarResumo: brl, render: (n) => brl(n.valor) },
];
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
            <TabelaLocal<NotaFaturada>
              chave="comercial.metas.notas-faturadas"
              defs={COLUNAS}
              colunas={LOCAIS}
              linhas={visiveis}
              chaveLinha={(n) => `${n.codemp}-${n.codfil}-${n.serie}-${n.numero}`}
              vazio="Nenhuma nota com esse filtro."
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
