import axios from "axios";
import { useMemo, useState } from "react";
import { ListaServidor } from "../../../components/colunas/ListaServidor";
import type { DefColuna } from "../../../components/colunas/useColunasConfiguraveis";
import { classeBotaoPrimario } from "../../../components/gestao5s/campos";
import { useToast } from "../../../components/ui/Toast";
import { classeFiltro, fmtCompetencia, fmtDataHora, fmtMoeda, mensagemDe, useAcessoDescontos, useOpcoesDescontos } from "./comum";

// Gestão de Descontos › Fechamentos: a conciliação mensal. Na virada do mês o sistema congela a nota do consultor (o "Valor Nota" do Relatório de
// Produtividade) e reparte entre as parcelas da competência: o que não cabe na nota segue para o mês seguinte. Líquido = nota − descontado.

interface FechamentoLista {
  competencia: string;
  codfor: number;
  consultor: string;
  valorNota: number;
  totalPrevisto: number;
  totalDescontado: number;
  liquido: number;
  saldoTransportado: number;
  origem: string;
  fechadoEm: string;
}

const dinheiro = "font-mono text-sm tabular-nums text-foreground";
const COLUNAS: DefColuna<FechamentoLista>[] = [
  { nome: "competencia", titulo: "Competência", fixa: true, largura: 120, resumos: ["contagem"], classe: "font-mono text-sm font-semibold text-foreground", render: (f) => fmtCompetencia(f.competencia) },
  { nome: "consultor", titulo: "Consultor", largura: 200, classe: "text-sm text-foreground", texto: (f) => f.consultor, render: (f) => f.consultor },
  { nome: "valorNota", titulo: "Valor bruto (nota)", direita: true, largura: 140, classe: dinheiro, formatarResumo: fmtMoeda, render: (f) => fmtMoeda(f.valorNota) },
  { nome: "totalPrevisto", titulo: "Descontos previstos", direita: true, largura: 140, classe: dinheiro, formatarResumo: fmtMoeda, render: (f) => fmtMoeda(f.totalPrevisto) },
  { nome: "totalDescontado", titulo: "Descontado", direita: true, largura: 120, classe: dinheiro, formatarResumo: fmtMoeda, render: (f) => fmtMoeda(f.totalDescontado) },
  { nome: "liquido", titulo: "Valor líquido", direita: true, largura: 130, classe: "font-mono text-sm font-semibold tabular-nums text-primary", formatarResumo: fmtMoeda, render: (f) => fmtMoeda(f.liquido) },
  {
    nome: "saldoTransportado",
    titulo: "Transportado p/ o mês seguinte",
    direita: true,
    largura: 160,
    classe: dinheiro,
    formatarResumo: fmtMoeda,
    render: (f) => fmtMoeda(f.saldoTransportado),
  },
  { nome: "origem", titulo: "Fechado por", largura: 110, classe: "text-sm text-muted", render: (f) => f.origem },
  { nome: "fechadoEm", titulo: "Fechado em", largura: 140, classe: "font-mono text-sm text-muted", render: (f) => fmtDataHora(f.fechadoEm) },
];

export function DescontosFechamentos() {
  const { mostrar } = useToast();
  const acesso = useAcessoDescontos();
  const { consultores } = useOpcoesDescontos();
  const [codfor, setCodfor] = useState("");
  const [competenciaDe, setCompetenciaDe] = useState("");
  const [competenciaAte, setCompetenciaAte] = useState("");
  const [recarga, setRecarga] = useState(0);
  const [competenciaFechar, setCompetenciaFechar] = useState("");
  const [fechando, setFechando] = useState(false);

  const params = useMemo(
    () => ({ codfor: codfor || undefined, competenciaDe: competenciaDe || undefined, competenciaAte: competenciaAte || undefined }),
    [codfor, competenciaDe, competenciaAte]
  );

  async function fechar() {
    if (!competenciaFechar) return;
    if (!window.confirm(`Fechar a competência ${fmtCompetencia(competenciaFechar)} agora? A nota de cada consultor é congelada e o que não couber segue para o mês seguinte.`)) return;
    setFechando(true);
    try {
      const { data } = await axios.post<{ fechados: number; jaFechados: number; semNota: number; erros: number }>(`/api/descontos/fechamentos/${competenciaFechar}`);
      const partes = [`${data.fechados} consultor(es) fechado(s)`];
      if (data.jaFechados) partes.push(`${data.jaFechados} já estavam fechados`);
      if (data.semNota) partes.push(`${data.semNota} sem nota (sem valor-hora: ficam pendentes)`);
      if (data.erros) partes.push(`${data.erros} com erro`);
      mostrar(`${fmtCompetencia(competenciaFechar)}: ${partes.join(", ")}.`, data.erros || data.semNota ? "warning" : "success");
      setRecarga((n) => n + 1);
    } catch (e) {
      mostrar(mensagemDe(e, "Não foi possível fechar a competência"), "destructive");
    } finally {
      setFechando(false);
    }
  }

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão de Projetos · Gestão de Descontos</p>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Fechamentos de competência</h1>
          <p className="mt-1 text-sm text-muted">Conciliação entre o valor bruto da nota, os descontos aplicados e o valor líquido de cada consultor.</p>
        </div>
        {acesso?.administra && (
          <div className="flex items-center gap-2">
            <label className="text-[12.5px] text-muted" htmlFor="fechar-comp">
              Fechar competência
            </label>
            <input id="fechar-comp" type="month" className={classeFiltro} value={competenciaFechar} onChange={(e) => setCompetenciaFechar(e.target.value)} />
            <button type="button" onClick={fechar} disabled={!competenciaFechar || fechando} className={classeBotaoPrimario}>
              {fechando ? "Fechando…" : "Fechar"}
            </button>
          </div>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {consultores.length > 1 && (
          <select aria-label="Consultor" className={classeFiltro} value={codfor} onChange={(e) => setCodfor(e.target.value)}>
            <option value="">Todos os consultores</option>
            {consultores.map((c) => (
              <option key={c.codfor} value={c.codfor}>
                {c.nome}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
          Competência
          <input type="month" aria-label="Competência de" className={classeFiltro} value={competenciaDe} max={competenciaAte || undefined} onChange={(e) => setCompetenciaDe(e.target.value)} />
          –
          <input type="month" aria-label="Competência até" className={classeFiltro} value={competenciaAte} min={competenciaDe || undefined} onChange={(e) => setCompetenciaAte(e.target.value)} />
        </label>
      </div>

      <ListaServidor<FechamentoLista>
        chave="projetos.descontos.fechamentos"
        exportavel="descontos-fechamentos"
        url="/api/descontos/fechamentos"
        params={params}
        recarga={recarga}
        defs={COLUNAS}
        chaveLinha={(f) => `${f.competencia}-${f.codfor}`}
        rotulo="fechamentos"
        vazio="Nenhuma competência fechada ainda."
        pageSize={30}
        opcoesPorPagina={[30, 50, 100, 200]}
        rodape={(d) => (
          <div className="flex flex-wrap gap-x-8 gap-y-1 border-t border-border bg-surface px-5 py-3">
            {(
              [
                ["Valor bruto (filtro atual)", d?.totais?.valorNota],
                ["Descontado", d?.totais?.totalDescontado],
                ["Valor líquido", d?.totais?.liquido],
                ["Transportado", d?.totais?.saldoTransportado],
              ] as const
            ).map(([rotulo, valor]) => (
              <div key={rotulo}>
                <p className="text-[10.5px] text-muted">{rotulo}</p>
                <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{fmtMoeda(valor ?? 0)}</p>
              </div>
            ))}
          </div>
        )}
      />
    </div>
  );
}
