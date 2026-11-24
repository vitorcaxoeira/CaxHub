import { TabelaLocal } from "../colunas/TabelaLocal";
import type { ColunaLocal } from "../colunas/aplicarLocal";
import type { DefColuna } from "../colunas/useColunasConfiguraveis";
import { cn } from "../../lib/cn";
import { linhaDaConta, ordenarLancamentos, ROTULO_ORIGEM, rotuloCompetencia, type LancamentoOrigem } from "../../lib/custoHora";
import { formatarDia, formatarReais } from "../../lib/vinculoConsultores";

// De onde veio o custo-hora de um consultor num mês (link no valor da aba Resultado de Custo-hora real, 19/11/2026): os dados que o cálculo considerou, para as
// três origens — CLT (lançamentos da contabilização da folha), PJ (contrato e vigências) e manual (vigências). Só rótulos, números e tabelas: sem texto de ajuda.

export interface VigenciaPj {
  desde: string | null;
  valor: number;
  origem: "inicial" | "reajuste" | "preco_atual";
  percentual: number | null;
}

export interface OrigemResposta {
  consultor: { codemp: number; codusu: number; nome: string };
  competencia: string;
  origem: "clt_folha" | "pj_contrato" | "manual";
  custoHora: number;
  detalhe: unknown;
  clt?: {
    colaborador: { nome: string | null; matricula: number } | null;
    lancamentos: LancamentoOrigem[];
    totais: { considerado: number; fora: number };
  };
  pj?: {
    historico: {
      contrato: { numctr: number; codmot: number | null; vlrhor: number | null; qtdctr: number | null; fixo: { qtd: number; valorMensal: number } | null; situacao: string | null } | null;
      item: { seqccs: number; servico: string | null; precoUnitario: number; quantidade: number | null } | null;
      vigencias: VigenciaPj[];
      reajustes: { data: string | null; valorAnterior: number | null; valorNovo: number | null; aumento: number | null; percentual: number | null }[];
    };
    vigenciaAplicada: VigenciaPj | null;
  };
  manual?: {
    valores: { id: number; vigenciaInicio: string; valor: number; observacao: string | null }[];
    vigenciaAplicada: { vigenciaInicio: string; valor: number } | null;
  };
}

const DESTAQUE = "bg-primary/10";

function Rotulo({ children }: { children: string }) {
  return <p className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">{children}</p>;
}

// ---------- CLT ----------

const COLUNAS_LANC_LOCAIS: ColunaLocal[] = [
  { nome: "conta", tipo: "texto", obrigatoria: true },
  { nome: "historico", tipo: "texto" },
  { nome: "tipo", tipo: "texto", obrigatoria: true },
  { nome: "debcre", tipo: "texto", obrigatoria: true },
  { nome: "valor", tipo: "decimal", obrigatoria: true },
  { nome: "considerado", tipo: "booleano", obrigatoria: true },
];

const rotuloTipo = (l: LancamentoOrigem) => (l.opcctb === 3 ? "Provisão" : "Folha");

const lerLancamento = (l: LancamentoOrigem, coluna: string): unknown => {
  if (coluna === "conta") return `${l.clacta ?? ""} ${l.descta ?? ""} ${l.ctared}`;
  if (coluna === "tipo") return rotuloTipo(l);
  return (l as unknown as Record<string, unknown>)[coluna];
};

const COLUNAS_LANC: DefColuna<LancamentoOrigem>[] = [
  {
    nome: "conta",
    titulo: "Conta",
    fixa: true,
    largura: 330,
    render: (l) => (
      <span className="text-sm text-foreground" title={`${l.clacta ?? ""} · ${l.descta ?? ""}`}>
        <span className="font-mono text-xs text-muted">{l.clacta ?? "—"}</span> {l.descta ?? "(fora do plano)"} <span className="text-xs text-muted">({l.ctared})</span>
      </span>
    ),
  },
  { nome: "historico", titulo: "Histórico", largura: 230, classe: "text-[12.5px] text-muted", render: (l) => `${l.historico ?? ""}${l.codclc != null ? ` · ${l.codclc}` : ""}` },
  { nome: "tipo", titulo: "Folha / provisão", largura: 130, classe: "text-sm text-muted", render: (l) => rotuloTipo(l) },
  { nome: "debcre", titulo: "D/C", largura: 70, centro: true, classe: "font-mono text-sm text-muted", render: (l) => l.debcre },
  { nome: "valor", titulo: "Valor", direita: true, largura: 140, classe: "font-mono text-sm tabular-nums text-foreground", render: (l) => formatarReais(l.valor) },
  {
    nome: "considerado",
    titulo: "No custo",
    largura: 100,
    formatarValor: (v) => (v === true || v === "true" ? "Sim" : "Não"),
    render: (l) => (l.considerado ? <span className="rounded bg-success/15 px-2 py-0.5 text-[11.5px] font-medium text-success">Sim</span> : <span className="rounded bg-muted/15 px-2 py-0.5 text-[11.5px] font-medium text-muted">Não</span>),
  },
];

function OrigemClt({ dados }: { dados: OrigemResposta }) {
  const clt = dados.clt;
  if (!clt) return null;
  const itens = ordenarLancamentos(clt.lancamentos);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-muted">
        <span>
          Colaborador no HCM:{" "}
          <b className="text-foreground">{clt.colaborador?.nome ?? "—"}</b>
          {clt.colaborador ? ` · mat. ${clt.colaborador.matricula}` : ""}
        </span>
        <span>
          Considerado: <b className="text-foreground">{formatarReais(clt.totais.considerado)}</b>
        </span>
        <span>
          Fora do custo: <b className="text-foreground">{formatarReais(clt.totais.fora)}</b>
        </span>
      </div>
      <TabelaLocal<LancamentoOrigem>
        chave="admin.custo-hora.origem-clt"
        defs={COLUNAS_LANC}
        colunas={COLUNAS_LANC_LOCAIS}
        linhas={itens}
        ler={lerLancamento}
        chaveLinha={(l, i) => `${l.ctared}-${l.codclc}-${l.debcre}-${i}`}
        vazio="Sem lançamentos da folha para o colaborador neste mês."
        classeLinha={(l) => (l.considerado ? undefined : "opacity-60")}
        paginacao={{ inicial: 25, rotulo: "lançamentos" }}
      />
    </div>
  );
}

// ---------- PJ ----------

function OrigemPj({ dados }: { dados: OrigemResposta }) {
  const pj = dados.pj;
  if (!pj) return null;
  const { contrato, item, vigencias, reajustes } = pj.historico;
  const aplicada = pj.vigenciaAplicada;
  return (
    <div className="space-y-4">
      {contrato ? (
        <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-muted">
          <span>
            Contrato <b className="text-foreground">{contrato.numctr}</b>
            {contrato.situacao ? ` · ${contrato.situacao === "A" ? "ativo" : "inativo"}` : ""}
          </span>
          {item && (
            <span>
              Item <b className="text-foreground">{item.seqccs}</b>
              {item.servico ? ` · ${item.servico}` : ""} · preço atual <b className="text-foreground">{formatarReais(item.precoUnitario)}</b>
            </span>
          )}
          {contrato.fixo && (
            <span>
              Valor fixo: <b className="text-foreground">{contrato.fixo.qtd.toLocaleString("pt-BR")} h × {formatarReais(contrato.vlrhor)} = {formatarReais(contrato.fixo.valorMensal)}</b> por mês
            </span>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">Sem contrato de valor-hora no Senior.</p>
      )}

      <div>
        <Rotulo>Vigências do valor-hora</Rotulo>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted">
              <th className="py-1.5 pr-3 font-medium">Vigente desde</th>
              <th className="py-1.5 pr-3 text-right font-medium">Valor-hora</th>
              <th className="py-1.5 pr-3 text-right font-medium">Reajuste</th>
              <th className="py-1.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {vigencias.map((v, i) => {
              const valeu = !!aplicada && v.desde === aplicada.desde && v.valor === aplicada.valor;
              return (
                <tr key={i} className={cn("border-t border-border/60", valeu && DESTAQUE)}>
                  <td className="py-1.5 pr-3 text-foreground">{v.desde ? formatarDia(v.desde) : v.origem === "inicial" ? "Início do contrato" : "Sempre"}</td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{formatarReais(v.valor)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-muted">{v.percentual != null ? `${v.percentual.toLocaleString("pt-BR")}%` : "—"}</td>
                  <td className="py-1.5 text-right text-[11.5px] font-medium text-primary">{valeu ? `Valeu em ${rotuloCompetencia(dados.competencia)}` : ""}</td>
                </tr>
              );
            })}
            {vigencias.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-muted">
                  Sem vigências importadas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Contrato de valor fixo: o histórico do Senior mistura valor por hora e total do mês e NÃO entra no cálculo — não é mostrado. */}
      {reajustes.length > 0 && !contrato?.fixo && (
        <div>
          <Rotulo>Reajustes do Senior (E460REA)</Rotulo>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted">
                <th className="py-1.5 pr-3 font-medium">Data</th>
                <th className="py-1.5 pr-3 text-right font-medium">Valor anterior</th>
                <th className="py-1.5 pr-3 text-right font-medium">Valor novo</th>
                <th className="py-1.5 text-right font-medium">Aumento</th>
              </tr>
            </thead>
            <tbody>
              {reajustes.map((r, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="py-1.5 pr-3 text-foreground">{formatarDia(r.data)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-muted">{formatarReais(r.valorAnterior)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{formatarReais(r.valorNovo)}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-muted">
                    {formatarReais(r.aumento)}
                    {r.percentual != null ? ` · ${r.percentual.toLocaleString("pt-BR")}%` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- Manual ----------

function OrigemManual({ dados }: { dados: OrigemResposta }) {
  const m = dados.manual;
  if (!m) return null;
  return (
    <div>
      <Rotulo>Vigências do valor-hora manual</Rotulo>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted">
            <th className="py-1.5 pr-3 font-medium">Vigente desde</th>
            <th className="py-1.5 pr-3 text-right font-medium">Valor-hora</th>
            <th className="py-1.5 pr-3 font-medium">Observação</th>
            <th className="py-1.5 font-medium" />
          </tr>
        </thead>
        <tbody>
          {m.valores.map((v) => {
            const valeu = m.vigenciaAplicada?.vigenciaInicio === v.vigenciaInicio;
            return (
              <tr key={v.id} className={cn("border-t border-border/60", valeu && DESTAQUE)}>
                <td className="py-1.5 pr-3 text-foreground">{formatarDia(v.vigenciaInicio)}</td>
                <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{formatarReais(v.valor)}</td>
                <td className="py-1.5 pr-3 text-muted">{v.observacao ?? ""}</td>
                <td className="py-1.5 text-right text-[11.5px] font-medium text-primary">{valeu ? `Valeu em ${rotuloCompetencia(dados.competencia)}` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Corpo do modal de origem: a frase de conta no alto e, abaixo, os dados da origem que o cálculo usou. */
export function OrigemCustoHora({ dados }: { dados: OrigemResposta }) {
  const vigenteDesde = dados.origem === "pj_contrato" ? dados.pj?.vigenciaAplicada?.desde : dados.origem === "manual" ? dados.manual?.vigenciaAplicada?.vigenciaInicio : null;
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-surface-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-primary/10 px-2 py-0.5 text-[11.5px] font-medium text-primary">{ROTULO_ORIGEM[dados.origem]}</span>
          <span className="font-mono text-lg font-semibold tabular-nums text-foreground">{formatarReais(dados.custoHora)}</span>
          <span className="text-sm text-muted">por hora · {rotuloCompetencia(dados.competencia)}</span>
        </div>
        <p className="mt-1 text-sm text-foreground">{linhaDaConta({ origem: dados.origem, custoHora: dados.custoHora, detalhe: dados.detalhe, vigenteDesde })}</p>
      </div>
      {dados.origem === "clt_folha" && <OrigemClt dados={dados} />}
      {dados.origem === "pj_contrato" && <OrigemPj dados={dados} />}
      {dados.origem === "manual" && <OrigemManual dados={dados} />}
    </div>
  );
}
