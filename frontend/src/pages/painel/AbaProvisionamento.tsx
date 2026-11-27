import { useMemo, useState } from "react";
import { ListaServidor } from "../../components/colunas/ListaServidor";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";
import { BotaoVisibilidade } from "../../components/dashboard/BotaoVisibilidade";
import { formatHorasCompacto } from "../../lib/cronograma";
import { formatMoedaComSimbolo } from "../../utils/moeda";

// Home › aba Provisionamento (27/11/2026): a nota do mês de todos os consultores de contrato Fixo ou Hora (admin vê todos; gestor, o time
// dele), uma linha por consultor, com as mesmas contas do card de valor da aba Principal. Backend: GET /dashboard/provisionamento. Como no
// card, os valores em R$ começam ocultos (privacidade de tela) e o botão do olho mostra.

export interface LinhaProvisionamento {
  chave: string;
  codemp: number;
  codfor: number;
  consultor: string;
  departamento: string;
  contrato: "Fixo" | "Hora";
  valorHora: number;
  fixoMensal: number | null;
  minutosAteHoje: number;
  deslocamentoMinutos: number;
  deslocamentoValor: number;
  realizado: number;
  projecao: number;
  ferias: number;
  feriasAteAgora: number;
  bonificacao: number;
  descontos: number;
  descontosPrevistos: boolean;
  liquidoAteAgora: number;
  liquidoProjetado: number;
  /** "A provisionar" do mês anterior ao filtrado (calculado pelo CaxHub). */
  mesAnterior: number;
}

export const OCULTO = "••••";
const mono = "font-mono text-sm tabular-nums";
const horas = (v: number) => formatHorasCompacto(v);

/** Mês corrente "AAAA-MM" no relógio da pessoa. */
export function mesCorrente(agora = new Date()): string {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}

export function colunasProvisionamento(visivel: boolean): DefColuna<LinhaProvisionamento>[] {
  const rs = (v: number | null | undefined) => (v == null ? "—" : visivel ? formatMoedaComSimbolo(v) : OCULTO);
  const dinheiro = (
    nome: "valorHora" | "fixoMensal" | "deslocamentoValor" | "realizado" | "projecao" | "ferias" | "bonificacao" | "liquidoAteAgora" | "liquidoProjetado" | "mesAnterior",
    titulo: string,
    largura: number,
    dica: string,
    extra: Partial<DefColuna<LinhaProvisionamento>> = {}
  ): DefColuna<LinhaProvisionamento> => ({
    nome,
    titulo,
    direita: true,
    largura,
    dica,
    classe: `${mono} text-foreground`,
    // O resumo e a lista de valores do funil também respeitam o "ocultar".
    formatarResumo: (v) => rs(v),
    formatarValor: (v) => rs(v == null || v === "" ? null : Number(v)),
    render: (l) => rs(l[nome]),
    ...extra,
  });
  const colunaHoras = (nome: "minutosAteHoje" | "deslocamentoMinutos", titulo: string, largura: number, dica: string): DefColuna<LinhaProvisionamento> => ({
    nome,
    titulo,
    direita: true,
    largura,
    dica,
    classe: `${mono} text-foreground`,
    formatarResumo: horas,
    formatarValor: (v) => horas(Number(v)),
    render: (l) => horas(l[nome]),
  });

  return [
    // Congelada: a tabela é larga e o nome precisa continuar à vista ao rolar até "A provisionar" (cada pessoa muda no alfinete do painel Colunas).
    { nome: "consultor", titulo: "Consultor", fixa: true, congelada: true, largura: 220, resumos: ["contagem"], classe: "text-sm font-medium text-foreground", texto: (l) => l.consultor, render: (l) => <span className="block truncate">{l.consultor}</span> },
    { nome: "departamento", titulo: "Departamento", largura: 150, classe: "text-sm text-muted", texto: (l) => l.departamento, render: (l) => <span className="block truncate">{l.departamento}</span> },
    {
      nome: "contrato",
      titulo: "Contrato",
      centro: true,
      largura: 90,
      render: (l) => (
        <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${l.contrato === "Fixo" ? "bg-primary/15 text-primary" : "bg-muted/15 text-muted"}`}>{l.contrato}</span>
      ),
    },
    dinheiro("valorHora", "Valor/hora", 110, "Valor-hora do contrato vigente no Senior"),
    dinheiro("fixoMensal", "Fixo mensal", 120, "Contrato Fixo: valor-hora × quantidade fixa do contrato"),
    colunaHoras("minutosAteHoje", "Horas", 90, "Horas apontadas no mês até hoje"),
    colunaHoras("deslocamentoMinutos", "Desloc. (h)", 95, "Horas de deslocamento lançadas no mês"),
    dinheiro("deslocamentoValor", "Desloc. (R$)", 115, "Deslocamento pago a 50% do valor-hora (já está no realizado e na projeção)"),
    dinheiro("realizado", "Realizado", 130, "Hora: horas e deslocamento até hoje. Fixo: o fixo do mês + deslocamento"),
    dinheiro("projecao", "Projeção", 130, "Hora: média por dia útil × dias úteis do mês + deslocamento lançado. Fixo: o fixo do mês + deslocamento"),
    dinheiro("ferias", "Férias", 110, "Férias remuneradas pagas na nota deste mês"),
    dinheiro("bonificacao", "Bonificação", 115, "Bonificação fechada na competência que compõe a nota"),
    {
      nome: "descontos",
      titulo: "Descontos",
      direita: true,
      largura: 120,
      dica: 'Descontos da competência (Gestão de Descontos); "previsto" enquanto o mês não é fechado',
      classe: `${mono} text-destructive`,
      formatarResumo: (v) => rs(v),
      formatarValor: (v) => rs(Number(v)),
      render: (l) =>
        l.descontos > 0 ? (
          <>
            {visivel ? `−${formatMoedaComSimbolo(l.descontos)}` : OCULTO}
            {l.descontosPrevistos && <div className="font-sans text-[10.5px] text-muted">previsto</div>}
          </>
        ) : (
          <span className="text-muted">{rs(0)}</span>
        ),
    },
    dinheiro("liquidoAteAgora", "Líquido até agora", 140, "Realizado + férias (de mês já iniciado) + bonificação − descontos"),
    dinheiro("liquidoProjetado", "A provisionar", 140, "Líquido projetado da nota: projeção + férias + bonificação − descontos", { classe: `${mono} font-semibold text-primary` }),
    dinheiro("mesAnterior", "Mês Anterior", 140, 'Nota do mês anterior ao filtrado, calculada pelo CaxHub (o "A provisionar" daquele mês, com o contrato vigente hoje). Não é o título lançado no ERP.'),
  ];
}

const TOTAIS = [
  ["realizado", "Realizado"],
  ["projecao", "Projeção"],
  ["ferias", "Férias"],
  ["bonificacao", "Bonificação"],
  ["descontos", "Descontos"],
  ["liquidoAteAgora", "Líquido até agora"],
  ["liquidoProjetado", "Total a provisionar"],
  ["mesAnterior", "Mês Anterior"],
] as const;

export function AbaProvisionamento() {
  const [competencia, setCompetencia] = useState(mesCorrente());
  const [visivel, setVisivel] = useState(false);
  const defs = useMemo(() => colunasProvisionamento(visivel), [visivel]);
  const valida = /^\d{4}-\d{2}$/.test(competencia) ? competencia : mesCorrente();
  const params = useMemo(() => ({ competencia: valida }), [valida]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="month"
          aria-label="Competência"
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={competencia}
          onChange={(e) => setCompetencia(e.target.value)}
        />
        <BotaoVisibilidade visivel={visivel} onAlternar={() => setVisivel((v) => !v)} />
        <p className="text-[12.5px] text-muted">
          Nota do mês dos consultores com contrato Fixo ou Hora, com as mesmas contas da aba Principal.{!visivel && " Valores ocultos: clique no olho para mostrar."}
        </p>
      </div>
      {valida > mesCorrente() && (
        <p className="mb-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] text-foreground">
          Mês que ainda não começou: contrato por hora não tem projeção (ainda não há horas). Entram os fixos, o deslocamento já lançado, as férias, a bonificação e os descontos.
        </p>
      )}

      <ListaServidor<LinhaProvisionamento>
        chave="home.provisionamento"
        url="/api/dashboard/provisionamento"
        params={params}
        defs={defs}
        chaveLinha={(l) => l.chave}
        rotulo="consultores"
        vazio="Nenhum consultor com contrato Fixo ou Hora no seu escopo."
        pageSize={50}
        rodape={(d) => (
          <div className="flex flex-wrap gap-x-8 gap-y-1 border-t border-border bg-surface px-5 py-3">
            <div>
              <p className="text-[10.5px] text-muted">Horas (filtro atual)</p>
              <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{horas(d?.totais?.minutosAteHoje ?? 0)}</p>
            </div>
            {TOTAIS.map(([campo, rotulo]) => (
              <div key={campo}>
                <p className="text-[10.5px] text-muted">{rotulo}</p>
                <p className={`font-mono font-semibold tabular-nums ${campo === "liquidoProjetado" ? "text-base text-primary" : "text-sm text-foreground"}`}>
                  {visivel ? formatMoedaComSimbolo(d?.totais?.[campo] ?? 0) : OCULTO}
                </p>
              </div>
            ))}
          </div>
        )}
      />
    </div>
  );
}
