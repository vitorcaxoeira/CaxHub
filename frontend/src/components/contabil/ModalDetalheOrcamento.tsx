import { Modal } from "../ui/Modal";
import { ListaServidor } from "../colunas/ListaServidor";
import type { DefColuna } from "../colunas/useColunasConfiguraveis";
import { formatarMes } from "./MatrizContabil";

// GET /contabil/orcado-realizado/orcamentos (backend/src/routes/contabil.ts): as linhas do orçamento (orcamentos_contabeis) por trás de uma
// célula "Orçado" da aba Orçado x Realizado (23/11/2026) — o par do ModalDetalheLancamentos, que mostra a origem do Realizado. Mesmo sinal
// da matriz (receita positiva, despesa negativa); sem filtro por coluna, o total bate com a célula clicada.
interface LinhaOrcamento {
  ctared: number;
  conta: string;
  filial: string;
  centro_custo: string | null;
  conta_financeira: string | null;
  valor: number;
}

const moeda = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const COLUNAS: DefColuna<LinhaOrcamento>[] = [
  { nome: "conta", titulo: "Conta", fixa: true, classe: "text-xs text-foreground", largura: 260, texto: (l) => l.conta, render: (l) => l.conta },
  { nome: "filial", titulo: "Filial", classe: "text-xs text-muted", largura: 180, texto: (l) => l.filial, render: (l) => l.filial },
  { nome: "centro_custo", titulo: "C. Custo", classe: "text-xs text-muted", largura: 220, texto: (l) => l.centro_custo, render: (l) => l.centro_custo ?? "—" },
  { nome: "conta_financeira", titulo: "Conta financeira", classe: "text-xs text-muted", largura: 220, texto: (l) => l.conta_financeira, render: (l) => l.conta_financeira ?? "—" },
  {
    nome: "valor",
    titulo: "Valor",
    direita: true,
    largura: 130,
    formatarResumo: (v) => moeda.format(v),
    classe: (l) => `font-mono text-xs tabular-nums ${l.valor < 0 ? "text-destructive" : "text-foreground"}`,
    render: (l) => moeda.format(l.valor),
  },
];

interface Props {
  ctareds: number[];
  mesReferencia: string;
  rotulo: string;
  codccu: string[];
  onClose: () => void;
}

export function ModalDetalheOrcamento({ ctareds, mesReferencia, rotulo, codccu, onClose }: Props) {
  return (
    <Modal open onClose={onClose} title={`${rotulo} — Orçado`} subtitulo={formatarMes(mesReferencia)} className="max-w-5xl">
      <ListaServidor<LinhaOrcamento>
        chave="contabil.orcado-realizado.orcamentos"
        camposRelacionados
        url="/api/contabil/orcado-realizado/orcamentos"
        params={{ ctareds: ctareds.join(","), mesReferencia, codccu: codccu.length > 0 ? codccu.join(",") : undefined }}
        defs={COLUNAS}
        chaveLinha={(l, i) => `${l.ctared}-${l.centro_custo}-${l.filial}-${i}`}
        rotulo="linhas do orçamento"
        vazio="Nenhuma linha de orçamento encontrada pra este valor."
        alturaMax="max-h-[60vh]"
        topo={(d) =>
          d && (
            <>
              <span className="text-[12.5px] text-muted">
                {d.total} linha{d.total === 1 ? "" : "s"} do orçamento
              </span>
              <span className="ml-auto font-mono text-sm font-semibold tabular-nums text-foreground">Total: {moeda.format(d.totais?.valor ?? 0)}</span>
            </>
          )
        }
      />
    </Modal>
  );
}
