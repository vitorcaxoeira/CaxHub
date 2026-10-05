import axios from "axios";
import { Fragment, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { OrientacaoRelatorio, RelatorioShell, TemaRelatorio, usePreferencia } from "../../components/relatorio/relatorioComum";
import { Spinner } from "../../components/ui/Spinner";
import { formatHorasCompacto, formatarDataBr } from "../../lib/cronograma";

// Relatório "Produtividade por Fornecedor" (FJPO910 do Senior) de um consultor, impresso a partir do botão
// Imprimir da Home. Mesmo modelo dos outros relatórios impressos: página própria fora do AppShell, aberta em
// aba nova, tema e orientação na barra. Só imprime (o imprimir do navegador já salva em PDF), sem "Baixar
// PDF" no servidor. Um relatório por mês do filtro da Home, cada um começando em página nova. Regras (RATs
// que entram, subtotal por semana, deslocamento a 50%) em backend/src/domain/relatorioProdutividade.ts.

const CHAVE = "caxhub-produtividade-relatorio";
const numero = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const reais = (v: number) => numero.format(v);
// Código de RAT/proposta com ponto de milhar, como o Senior imprime (851.254).
const milhar = new Intl.NumberFormat("pt-BR", { useGrouping: true });

interface Item {
  tipo: "item";
  data: string;
  horini: number;
  horfim: number;
  minutos: number;
  codpro: number | null;
  numrat: number | null;
  cliente: string | null;
  sitrat: number | null;
  sitratLabel: string;
  fatser: string | null;
}
interface Deslocamento {
  tipo: "deslocamento";
  data: string;
  minutos: number;
  numrats: number[];
}
interface Subtotal {
  tipo: "subtotal";
  data: string;
  rotulo: "Domingo" | "Data fim do mês";
  minutos: number;
}
type Bloco = Item | Deslocamento | Subtotal;

interface Mes {
  ano: number;
  mes: number;
  inicio: string;
  fim: string;
  blocos: Bloco[];
  totais: {
    minutosTrabalhados: number;
    minutosDeslocamento: number;
    valorHora: number | null;
    valorTrabalhadas: number | null;
    valorDeslocamento: number | null;
    valorNota: number | null;
  };
}

interface Dados {
  consultor: { codfor: number; nome: string };
  meses: Mes[];
}

const hhmm = (minutos: number) => {
  const h = String(Math.floor(minutos / 60)).padStart(2, "0");
  return `${h}:${String(minutos % 60).padStart(2, "0")}`;
};

const COLUNAS = [
  { chave: "data", largura: "74px" },
  { chave: "horario", largura: "112px" },
  { chave: "duracao", largura: "52px" },
  { chave: "proposta", largura: "58px" },
  { chave: "rat", largura: "68px" },
  { chave: "cliente" },
  { chave: "situacao", largura: "86px" },
  { chave: "fat", largura: "30px" },
];

// Cabeçalho um pouco menor e sem espaçamento largo entre letras: "Proposta" e "Duração" não cabem nas colunas
// estreitas do retrato com o tracking padrão (os rótulos ficavam colados). RAT de 7 dígitos com ponto de
// milhar (1.131.074) também precisa de coluna própria folgada, senão encosta no nome do cliente.
const cabecalho = "px-1.5 py-1 text-left font-mono text-[9px] font-medium uppercase tracking-tight text-muted";
const celula = "px-1.5 py-[3px] align-top";

function TabelaDoMes({ mes }: { mes: Mes }) {
  return (
    <table className="w-full table-fixed border-collapse text-[11px] leading-tight">
      <colgroup>
        {COLUNAS.map((c) => (
          <col key={c.chave} style={c.largura ? { width: c.largura } : undefined} />
        ))}
      </colgroup>
      {/* thead repete sozinho a cada página impressa. */}
      <thead className="border-y border-border bg-surface-2">
        <tr>
          <th className={cabecalho}>Data</th>
          <th className={cabecalho}>Horário</th>
          <th className={cabecalho}>Duração</th>
          <th className={cabecalho}>Proposta</th>
          <th className={cabecalho}>RAT</th>
          <th className={cabecalho}>Cliente</th>
          <th className={cabecalho}>Situação</th>
          <th className={cabecalho} title="Faturamento: S = normal, A = antecipado, N = sem faturamento">
            Fat.
          </th>
        </tr>
      </thead>
      <tbody>
        {mes.blocos.map((b, i) => {
          if (b.tipo === "item") {
            return (
              <tr key={i} className="break-inside-avoid border-b border-border/50">
                <td className={`${celula} tabular-nums`}>{formatarDataBr(b.data)}</td>
                <td className={`${celula} tabular-nums`}>
                  {hhmm(b.horini)} às {hhmm(b.horfim)}
                </td>
                <td className={`${celula} tabular-nums`}>{hhmm(b.minutos)}</td>
                <td className={`${celula} tabular-nums`}>{b.codpro ?? "—"}</td>
                <td className={`${celula} tabular-nums`}>{b.numrat != null ? milhar.format(b.numrat) : "—"}</td>
                <td className={`${celula} truncate`} title={b.cliente ?? undefined}>
                  {b.cliente ?? "—"}
                </td>
                <td className={`${celula} whitespace-nowrap ${b.sitrat !== 6 ? "font-medium text-warning" : ""}`}>
                  {b.sitrat != null ? `${b.sitrat} - ${b.sitratLabel}` : "—"}
                </td>
                <td className={celula}>{b.fatser ?? ""}</td>
              </tr>
            );
          }
          if (b.tipo === "deslocamento") {
            return (
              <tr key={i} className="break-inside-avoid border-b border-border/50 italic text-muted">
                <td className={`${celula} tabular-nums`}>{formatarDataBr(b.data)}</td>
                <td className={celula} />
                <td className={`${celula} tabular-nums not-italic text-foreground`}>{hhmm(b.minutos)}</td>
                <td className={celula} colSpan={5}>
                  Referente às horas de deslocamento {b.numrats.length > 1 ? "das RATs" : "da RAT"} ({b.numrats.join(", ")})
                </td>
              </tr>
            );
          }
          return (
            <tr key={i} className="break-inside-avoid border-y border-border bg-success/15 font-semibold">
              <td className={celula} colSpan={2}>
                {formatarDataBr(b.data)} <span className="font-normal italic">- {b.rotulo}</span>
              </td>
              <td className={`${celula} tabular-nums`}>{hhmm(b.minutos)}</td>
              <td className={celula} colSpan={5} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Rodape({ mes }: { mes: Mes }) {
  const t = mes.totais;
  const temValor = t.valorHora != null;
  return (
    <div className="mt-2 break-inside-avoid border-t-2 border-border pt-2">
      {temValor && (
        <p className="text-right text-[11px] text-muted">
          Valor Mínimo Contrato: <span className="tabular-nums">1,00 X {reais(t.valorHora!)}</span>{" "}
          <span className="ml-3 font-medium tabular-nums text-foreground">{reais(t.valorHora!)}</span>
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-stretch gap-x-6 gap-y-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Total de Horas</p>
          <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{formatHorasCompacto(t.minutosTrabalhados + t.minutosDeslocamento, 3)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Trabalhadas</p>
          <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {formatHorasCompacto(t.minutosTrabalhados, 3)}
            {temValor && <span className="ml-2">R$ {reais(t.valorTrabalhadas!)}</span>}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Deslocamento (50%)</p>
          <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {formatHorasCompacto(t.minutosDeslocamento, 3)}
            {temValor && <span className="ml-2">R$ {reais(t.valorDeslocamento!)}</span>}
          </p>
        </div>
        {temValor && (
          <div className="ml-auto rounded-md bg-success/20 px-3 py-1.5 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Valor Nota de Serviços</p>
            <p className="font-mono text-base font-bold tabular-nums text-foreground">R$ {reais(t.valorNota!)}</p>
          </div>
        )}
      </div>
      {!temValor && <p className="mt-1 text-[11px] italic text-muted">Sem contrato de valor-hora cadastrado no Senior — valores em reais não calculados.</p>}
      <div className="mt-2 rounded-sm bg-warning/20 px-2 py-1 text-[10.5px] leading-snug text-foreground [print-color-adjust:exact]">
        <p>Importante: No dia Primeiro de Cada Mês as 12 horas será fechado o Ciclo para emissão da Nota Fiscal.</p>
        <p>Importante: Em caso de dias não trabalhados por opção do prestador reconsiderar Valor Mínimo.</p>
      </div>
      <p className="mt-1 text-[10px] text-muted">Fat.: S = faturamento normal · A = antecipado · N = sem faturamento. Deslocamento pago a 50% do valor-hora.</p>
    </div>
  );
}

export function RelatorioProdutividade() {
  const [params] = useSearchParams();
  const [tema, escolherTema] = usePreferencia<TemaRelatorio>(`${CHAVE}-tema`, ["claro", "escuro"], "claro", params.get("tema"));
  // Colunas estreitas (nove campos): retrato é o padrão, como o relatório do Senior.
  const [orientacao, escolherOrientacao] = usePreferencia<OrientacaoRelatorio>(`${CHAVE}-orientacao`, ["retrato", "paisagem"], "retrato", params.get("orientacao"));

  const [dados, setDados] = useState<Dados | null>(null);
  const [semConsultor, setSemConsultor] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const anos = params.get("anos");
  const meses = params.get("meses");
  const codfor = params.get("codfor");

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    axios
      .get("/api/dashboard/produtividade", { params: { anos: anos ?? undefined, meses: meses ?? undefined, codfor: codfor ?? undefined } })
      .then(({ data }) => {
        if (cancelado) return;
        if (data.semConsultor) setSemConsultor(true);
        else setDados(data);
      })
      .catch((err) => !cancelado && setErro(err.response?.data?.error ?? "Falha ao carregar o relatório"))
      .finally(() => !cancelado && setLoading(false));
    return () => {
      cancelado = true;
    };
  }, [anos, meses, codfor]);

  useEffect(() => {
    if (!dados) return;
    const m = dados.meses.length === 1 ? ` - ${String(dados.meses[0].mes).padStart(2, "0")}/${dados.meses[0].ano}` : "";
    document.title = `Produtividade - ${dados.consultor.nome}${m}`;
  }, [dados]);

  // Mesmo sinal dos outros relatórios (usado por quem abre a página sem interface).
  useEffect(() => {
    const w = window as unknown as { __relatorioPronto?: boolean; __relatorioErro?: string };
    if (erro) w.__relatorioErro = erro;
    else w.__relatorioPronto = !loading && !!dados;
  }, [erro, loading, dados]);

  const temMeses = !!dados && dados.meses.length > 0;

  return (
    <RelatorioShell
      titulo="Relatório · Produtividade por Fornecedor"
      tema={tema}
      onTema={escolherTema}
      orientacao={orientacao}
      onOrientacao={escolherOrientacao}
      podeImprimir={temMeses && !loading}
      larguraMax={orientacao === "paisagem" ? "max-w-[1047px] print:max-w-none" : "max-w-[718px] print:max-w-none"}
    >
      {loading && (
        <div className="flex items-center justify-center py-10 print:hidden">
          <Spinner />
        </div>
      )}
      {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}
      {semConsultor && <p className="text-sm text-muted">Este usuário não tem cadastro de consultor, então não há produtividade para imprimir.</p>}

      {dados?.meses.map((mes, indice) => {
        const naoAprovadas = mes.blocos.some((b) => b.tipo === "item" && b.sitrat !== 6);
        const semNada = mes.blocos.length === 0;
        return (
          <section key={`${mes.ano}-${mes.mes}`} className={indice > 0 ? "mt-8 print:mt-0 print:break-before-page" : ""}>
            <div className="border border-border">
              <h2 className="py-1 text-center text-base font-bold text-foreground">Produtividade por Fornecedor</h2>
              <div className="flex items-baseline justify-between gap-3 border-t border-border px-2 py-1 text-[11px]">
                <p>
                  <span className="font-semibold tabular-nums">{formatarDataBr(mes.inicio)}</span> - Data início do mês
                </p>
                <p className="font-semibold">
                  <span className="tabular-nums">{dados.consultor.codfor}</span> {dados.consultor.nome}
                </p>
              </div>
            </div>
            {naoAprovadas && (
              <p className="mt-1 text-[10.5px] italic text-warning">
                Inclui RATs ainda não aprovadas (situação indicada em cada linha) — os totais deste mês são uma prévia.
              </p>
            )}
            {semNada ? (
              <p className="py-6 text-center text-sm text-muted">Sem apontamento neste mês.</p>
            ) : (
              <Fragment>
                <TabelaDoMes mes={mes} />
                <Rodape mes={mes} />
              </Fragment>
            )}
          </section>
        );
      })}
    </RelatorioShell>
  );
}
