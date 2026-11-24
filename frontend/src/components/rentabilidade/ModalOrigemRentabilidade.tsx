import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { ListaServidor } from "../colunas/ListaServidor";
import type { DefColuna } from "../colunas/useColunasConfiguraveis";
import { Modal } from "../ui/Modal";
import { Skeleton } from "../ui/Skeleton";
import { useMensagens } from "../../hooks/useMensagens";
import { formatarValor, type FormatoIndicador } from "../../lib/rentabilidade";

// De onde veio o valor de uma célula (ou do total, ou de uma linha de grupo) da Rentabilidade (24/11/2026; fase 2: todas as colunas). O servidor diz o TIPO da origem
// (`/rentabilidade/origem`): "lancamentos" (soma de contas: os lançamentos contábeis), "horas" (campo do sistema: os apontamentos do Kyria e os itens de RAT, com o custo
// quando a coluna é de custo) ou "formula" (qualquer outra conta: a composição — cada coluna citada, com o valor da linha e, nas de TOTAL(), o do total do recorte; cada valor
// abre a origem da coluna, e "Voltar" retorna). O total da lista bate com a célula clicada. Só rótulos, números e tabelas: sem texto explicativo.

export interface OrigemAberta {
  codigo: string;
  rotulo: string;
  formato: FormatoIndicador;
  /** Centro de custo da linha clicada; `null` = o grupo ou o total do recorte. */
  centroCusto: { codccu: string; desccu: string } | null;
  /** Conta Paralela da linha (aba Por Grupo): indefinido = o recorte sem grupo; "" = contas sem grupo. */
  grupo?: string;
}

/** O recorte da tela (período, setor, CCs, modelo), como o cálculo o recebe. */
export interface RecorteDaTela {
  inicio: string;
  fim: string;
  setor: string;
  ccs: string[];
  restringirModelo: boolean;
}

interface Componente {
  codigo: string;
  rotulo: string;
  sinal: 1 | -1;
  valor: number;
}
interface Referencia {
  codigo: string;
  rotulo: string;
  formato: FormatoIndicador;
  valor: number;
  /** O total do recorte, só nas colunas que a fórmula usa dentro de TOTAL(). */
  total: number | null;
  /** A coluna citada também tem origem para abrir. */
  origem: boolean;
}
type Resumo = {
  indicador: { codigo: string; rotulo: string; formato: FormatoIndicador; formula: string | null };
  centroCusto: { codccu: string; desccu: string | null } | null;
  valor: number;
} & ({ tipo: "lancamentos" | "horas"; componentes: Componente[] } | { tipo: "formula"; referencias: Referencia[] });

interface LancamentoOrigem {
  indicador: string;
  numlct: string;
  ctared: number;
  conta: string;
  datlct: string;
  centro_custo: string | null;
  debcre: string | null;
  cpllct: string | null;
  historico: string | null;
  valor: number;
}
interface ApontamentoOrigem {
  origem: string;
  indicador: string;
  dia: string;
  documento: string | null;
  pessoa: string | null;
  descricao: string | null;
  codccu: string | null;
  horas: number;
  custo_hora: number | null;
  valor: number;
}

const dia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" });
const moeda = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
const rotuloPeriodo = (inicio: string, fim: string) => (inicio === fim ? rotuloMes(inicio) : `${rotuloMes(inicio)} a ${rotuloMes(fim)}`);
const diferenteDeZero = (v: number) => Math.abs(v) >= 0.005;

const COLUNAS_LANCAMENTOS: DefColuna<LancamentoOrigem>[] = [
  { nome: "indicador", titulo: "Indicador", classe: "text-xs text-muted", largura: 190, texto: (l) => l.indicador, render: (l) => l.indicador },
  { nome: "datlct", titulo: "Data", fixa: true, classe: "font-mono text-xs text-muted", largura: 90, render: (l) => dia.format(new Date(l.datlct)) },
  { nome: "numlct", titulo: "Lançamento", classe: "font-mono text-xs text-muted", largura: 110, render: (l) => l.numlct },
  { nome: "conta", titulo: "Conta", classe: "text-xs text-foreground", largura: 240, texto: (l) => l.conta, render: (l) => l.conta },
  { nome: "centro_custo", titulo: "C. Custo", classe: "text-xs text-muted", largura: 200, texto: (l) => l.centro_custo, render: (l) => l.centro_custo ?? "—" },
  {
    nome: "cpllct",
    titulo: "Histórico",
    dica: "Filtra e ordena pelo complemento do lançamento; o texto mostrado aplica o histórico padrão",
    classe: "text-xs text-foreground",
    largura: 280,
    texto: (l) => l.historico,
    render: (l) => l.historico ?? "—",
  },
  { nome: "debcre", titulo: "D/C", classe: "text-xs text-muted", largura: 60, render: (l) => l.debcre ?? "—" },
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

/** Os apontamentos de horas: o valor sai na unidade da coluna (horas ou R$ do custo das horas). */
function colunasApontamentos(formato: FormatoIndicador): DefColuna<ApontamentoOrigem>[] {
  return [
    { nome: "origem", titulo: "Origem", fixa: true, classe: "text-xs text-muted", largura: 80, render: (l) => l.origem },
    { nome: "indicador", titulo: "Indicador", classe: "text-xs text-muted", largura: 190, texto: (l) => l.indicador, render: (l) => l.indicador },
    { nome: "dia", titulo: "Data", classe: "font-mono text-xs text-muted", largura: 90, render: (l) => dia.format(new Date(l.dia)) },
    { nome: "documento", titulo: "Documento", classe: "text-xs text-foreground", largura: 130, texto: (l) => l.documento, render: (l) => l.documento ?? "—" },
    { nome: "pessoa", titulo: "Pessoa", classe: "text-xs text-foreground", largura: 180, texto: (l) => l.pessoa, render: (l) => l.pessoa ?? "—" },
    { nome: "descricao", titulo: "Descrição", classe: "text-xs text-muted", largura: 300, texto: (l) => l.descricao, render: (l) => l.descricao ?? "—" },
    { nome: "codccu", titulo: "C. Custo", classe: "font-mono text-xs text-muted", largura: 90, render: (l) => l.codccu ?? "—" },
    { nome: "horas", titulo: "Horas", direita: true, largura: 90, classe: "font-mono text-xs tabular-nums text-foreground", formatarResumo: (v) => moeda.format(v), render: (l) => moeda.format(l.horas) },
    {
      nome: "custo_hora",
      titulo: "Custo-hora",
      direita: true,
      largura: 110,
      classe: "font-mono text-xs tabular-nums text-muted",
      formatarResumo: (v) => moeda.format(v),
      render: (l) => (l.custo_hora === null ? "—" : moeda.format(l.custo_hora)),
    },
    {
      nome: "valor",
      titulo: "Valor",
      direita: true,
      largura: 130,
      formatarResumo: (v) => formatarValor(v, formato),
      classe: (l) => `font-mono text-xs tabular-nums ${l.valor < 0 ? "text-destructive" : "text-foreground"}`,
      render: (l) => formatarValor(l.valor, formato),
    },
  ];
}

export function ModalOrigemRentabilidade({ origem, recorte, onClose }: { origem: OrigemAberta; recorte: RecorteDaTela; onClose: () => void }) {
  const msg = useMensagens();
  // Pilha de origens abertas: numa fórmula, clicar numa coluna citada abre a origem dela e "Voltar" retorna.
  const [pilha, setPilha] = useState<OrigemAberta[]>([origem]);
  const atual = pilha[pilha.length - 1];
  const [resumo, setResumo] = useState<Resumo | null>(null);

  // O que vai para o servidor: o recorte da tela e a coluna; para uma linha, o CC dela no lugar do filtro de CCs; o grupo, quando a linha é de um grupo.
  const params = {
    inicio: recorte.inicio,
    fim: recorte.fim,
    setor: recorte.setor || undefined,
    cc: atual.centroCusto ? undefined : recorte.ccs.length ? recorte.ccs.join(",") : undefined,
    codccu: atual.centroCusto?.codccu,
    grupo: atual.grupo,
    restringirModelo: recorte.restringirModelo ? "1" : "0",
    indicador: atual.codigo,
  };

  useEffect(() => {
    let cancelado = false;
    setResumo(null);
    axios
      .get<Resumo>("/api/rentabilidade/origem", { params })
      .then(({ data }) => !cancelado && setResumo(data))
      .catch((err) => {
        if (cancelado) return;
        msg.erro(err.response?.data?.error ?? "Falha ao carregar a origem do valor");
        // Na raiz fecha; numa coluna citada volta para a anterior.
        if (pilha.length > 1) setPilha((p) => p.slice(0, -1));
        else onClose();
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atual.codigo, atual.centroCusto?.codccu, atual.grupo, recorte.inicio, recorte.fim, recorte.setor, recorte.restringirModelo, recorte.ccs.join(",")]);

  const colunasHoras = useMemo(() => colunasApontamentos(atual.formato), [atual.formato]);
  const local = atual.grupo === undefined ? null : atual.grupo === "" ? "Sem grupo" : atual.grupo;
  const partes = [local, atual.centroCusto ? `${atual.centroCusto.codccu} · ${atual.centroCusto.desccu}` : null].filter(Boolean);
  const titulo = `${atual.rotulo} — ${partes.length ? partes.join(" · ") : "Total do recorte"}`;
  const fmt = (v: number, f: FormatoIndicador = atual.formato) => formatarValor(v, f);

  /** Abre a origem de uma coluna citada: a do CC/grupo da linha, ou (`total`) a do total do recorte (com o mesmo grupo). */
  const abrir = (r: Referencia, total: boolean) => setPilha((p) => [...p, { codigo: r.codigo, rotulo: r.rotulo, formato: r.formato, grupo: atual.grupo, centroCusto: total ? null : atual.centroCusto }]);

  const Valor = ({ v, r, total }: { v: number; r: Referencia; total: boolean }) =>
    r.origem && diferenteDeZero(v) ? (
      <button
        type="button"
        onClick={() => abrir(r, total)}
        className="-mx-1 rounded px-1 underline decoration-dotted underline-offset-2 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title="Ver de onde vem este valor"
      >
        {fmt(v, r.formato)}
      </button>
    ) : (
      <>{fmt(v, r.formato)}</>
    );

  return (
    <Modal open onClose={onClose} title={titulo} subtitulo={rotuloPeriodo(recorte.inicio, recorte.fim)} className="max-w-5xl">
      {pilha.length > 1 && (
        <button type="button" onClick={() => setPilha((p) => p.slice(0, -1))} className="mb-3 text-sm text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          ← Voltar
        </button>
      )}

      {!resumo ? (
        <Skeleton className="mb-3 h-5 w-3/4" />
      ) : resumo.tipo === "formula" ? (
        <div className="mb-3 space-y-2 text-sm">
          <p className="text-muted">
            {resumo.indicador.rotulo} = <span className="font-mono text-foreground">{resumo.indicador.formula}</span>
          </p>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted">
                <th className="py-1.5 pr-3 font-medium">Coluna</th>
                <th className="py-1.5 pr-3 text-right font-medium">{resumo.centroCusto ? "Neste CC" : "Valor"}</th>
                {resumo.referencias.some((r) => r.total !== null) && <th className="py-1.5 text-right font-medium">Total do recorte</th>}
              </tr>
            </thead>
            <tbody>
              {resumo.referencias.map((r) => (
                <tr key={r.codigo} className="border-t border-border/60">
                  <td className="py-1.5 pr-3 text-foreground">{r.rotulo}</td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                    <Valor v={r.valor} r={r} total={false} />
                  </td>
                  {resumo.referencias.some((x) => x.total !== null) && (
                    <td className="py-1.5 text-right font-mono tabular-nums">{r.total === null ? "" : <Valor v={r.total} r={r} total />}</td>
                  )}
                </tr>
              ))}
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-1.5 pr-3 text-foreground">= {resumo.indicador.rotulo}</td>
                <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-foreground">{fmt(resumo.valor, resumo.indicador.formato)}</td>
                {resumo.referencias.some((r) => r.total !== null) && <td />}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mb-3 text-sm text-muted">
          {resumo.componentes.length === 1 && resumo.componentes[0].codigo === resumo.indicador.codigo ? (
            <span>
              {resumo.indicador.rotulo} = <b className="text-foreground">{fmt(resumo.valor)}</b>
            </span>
          ) : (
            <span className="leading-relaxed">
              {resumo.indicador.rotulo} ={" "}
              {resumo.componentes.map((c, i) => (
                <span key={`${c.codigo}-${i}`}>
                  {i > 0 || c.sinal < 0 ? ` ${c.sinal < 0 ? "−" : "+"} ` : ""}
                  {c.rotulo} <b className="text-foreground">{fmt(c.valor)}</b>
                </span>
              ))}{" "}
              = <b className="text-foreground">{fmt(resumo.valor)}</b>
            </span>
          )}
        </div>
      )}

      {resumo?.tipo === "lancamentos" && (
        <ListaServidor<LancamentoOrigem>
          key={`l-${atual.codigo}-${atual.centroCusto?.codccu ?? ""}-${atual.grupo ?? "~"}`}
          chave="contabil.rentabilidade.origem"
          camposRelacionados
          url="/api/rentabilidade/origem/lancamentos"
          params={params}
          defs={COLUNAS_LANCAMENTOS}
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
      )}

      {resumo?.tipo === "horas" && (
        <ListaServidor<ApontamentoOrigem>
          key={`h-${atual.codigo}-${atual.centroCusto?.codccu ?? ""}-${atual.grupo ?? "~"}`}
          chave="contabil.rentabilidade.origem-horas"
          url="/api/rentabilidade/origem/horas"
          params={params}
          defs={colunasHoras}
          chaveLinha={(l, i) => `${l.origem}-${l.documento}-${i}`}
          rotulo="apontamentos"
          vazio="Nenhum apontamento encontrado pra este valor."
          alturaMax="max-h-[60vh]"
          topo={(d) =>
            d && (
              <>
                <span className="text-[12.5px] text-muted">
                  {d.total} apontamento{d.total === 1 ? "" : "s"}
                </span>
                <span className="ml-auto font-mono text-sm font-semibold tabular-nums text-foreground">Total: {fmt(d.totais?.valor ?? 0)}</span>
              </>
            )
          }
        />
      )}
    </Modal>
  );
}
