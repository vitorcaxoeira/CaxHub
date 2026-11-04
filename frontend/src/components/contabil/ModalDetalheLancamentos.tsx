import { Modal } from "../ui/Modal";
import { ListaServidor } from "../colunas/ListaServidor";
import type { DefColuna } from "../colunas/useColunasConfiguraveis";
import { formatarMes } from "./MatrizContabil";

// GET /contabil/resultado/lancamentos (backend/src/routes/contabil.ts): os lançamentos por trás de uma célula da matriz, com filtro e ordem por
// coluna, resumo no rodapé e colunas calculadas por fórmula (ListaServidor, 29/10/2026). O total do cabeçalho soma TODOS os lançamentos do
// filtro e, sem filtro por coluna, bate com a célula clicada.
interface LancamentoContabilDetalhe {
  numlct: string;
  ctared: number;
  conta: string;
  datlct: string;
  centro_custo: string | null;
  debcre: string | null;
  debcre_label: string;
  vlrrat: number;
  valor: number;
  cpllct: string | null;
  /** Texto final (com o template do histórico padrão); a coluna filtra e ordena pelo complemento (`cpllct`). */
  historico: string | null;
  origem: string;
  sitlctLabel: string;
}

const dataFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const moeda = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const COLUNAS: DefColuna<LancamentoContabilDetalhe>[] = [
  { nome: "datlct", titulo: "Data", fixa: true, classe: "font-mono text-xs text-muted", largura: 90, render: (l) => dataFormatter.format(new Date(l.datlct)) },
  { nome: "numlct", titulo: "Lançamento", classe: "font-mono text-xs text-muted", largura: 110, render: (l) => l.numlct },
  { nome: "conta", titulo: "Conta", classe: "text-xs text-foreground", largura: 240, texto: (l) => l.conta, render: (l) => l.conta },
  { nome: "origem", titulo: "Origem", classe: "text-xs text-muted", largura: 140, render: (l) => l.origem },
  {
    nome: "cpllct",
    titulo: "Histórico",
    dica: "Filtra e ordena pelo complemento do lançamento; o texto mostrado aplica o histórico padrão",
    classe: "text-xs text-foreground",
    largura: 300,
    texto: (l) => l.historico,
    render: (l) => l.historico ?? "—",
  },
  { nome: "centro_custo", titulo: "C. Custo", classe: "text-xs text-muted", largura: 200, texto: (l) => l.centro_custo, render: (l) => l.centro_custo ?? "—" },
  { nome: "debcre_label", titulo: "D/C", classe: "text-xs text-muted", largura: 90, render: (l) => l.debcre_label },
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

export function ModalDetalheLancamentos({ ctareds, mesReferencia, rotulo, codccu, onClose }: Props) {
  return (
    <Modal open onClose={onClose} title={rotulo} subtitulo={formatarMes(mesReferencia)} className="max-w-5xl">
      <ListaServidor<LancamentoContabilDetalhe>
        chave="contabil.resultado.lancamentos"
        url="/api/contabil/resultado/lancamentos"
        params={{ ctareds: ctareds.join(","), mesReferencia, codccu: codccu.length > 0 ? codccu.join(",") : undefined }}
        defs={COLUNAS}
        chaveLinha={(l, i) => `${l.numlct}-${l.ctared}-${i}`}
        rotulo="lançamentos"
        vazio="Nenhum lançamento encontrado pra este valor."
        alturaMax="max-h-[60vh]"
        topo={(d) =>
          d && (
            <>
              <span className="text-[12.5px] text-muted">
                {d.total} lançamento{d.total === 1 ? "" : "s"}
              </span>
              <span className="ml-auto font-mono text-sm font-semibold tabular-nums text-foreground">Total: {moeda.format(d.totais?.valor ?? 0)}</span>
            </>
          )
        }
      />
    </Modal>
  );
}
