import { useState } from "react";
import { PainelEficiencia, dataHoraBr, hh, hhmm, hn, pct } from "../../lib/eficiencia";
import { Cartao, Indicador, Vazio } from "./comum";
import { TabelaLocal } from "../colunas/TabelaLocal";
import type { ColunaLocal } from "../colunas/aplicarLocal";
import type { DefColuna } from "../colunas/useColunasConfiguraveis";

// Tabelas com filtro e ordem por coluna, colunas configuráveis, resumo no rodapé e colunas calculadas (TabelaLocal, 03/11/2026). Horas em
// minutos (hn/hhmm formatam). As ações (abrir proposta/consultor, restaurar) vêm por `ctx`.
type SemAlocacao = PainelEficiencia["qualidade"]["semAlocacao"][number];
type ARevisar = PainelEficiencia["qualidade"]["aRevisar"][number];
type Exclusao = PainelEficiencia["exclusoes"]["lista"][number];
interface Acoes {
  abrirProposta: (codemp: number, codpro: number) => void;
  abrirConsultor: (codfor: number) => void;
  restaurando: number | null;
  restaurar: (ratItemId: number) => void;
}

const LOCAIS_SEM_ALOCACAO: ColunaLocal[] = [
  { nome: "cliente", tipo: "texto", obrigatoria: true },
  { nome: "codpro", tipo: "inteiro", obrigatoria: true },
  { nome: "semAlocacao", tipo: "decimal", obrigatoria: true },
  { nome: "executado", tipo: "decimal", obrigatoria: true },
  { nome: "pctSem", tipo: "decimal" },
];
const lerSemAlocacao = (p: SemAlocacao, nome: string): unknown =>
  nome === "pctSem" ? (p.executado ? (p.semAlocacao / p.executado) * 100 : null) : (p as unknown as Record<string, unknown>)[nome];
const COLUNAS_SEM_ALOCACAO: DefColuna<SemAlocacao, Acoes>[] = [
  {
    nome: "cliente",
    titulo: "Proposta",
    fixa: true,
    largura: 240,
    texto: (p) => p.cliente,
    render: (p) => (
      <>
        <span className="block truncate font-medium text-foreground">{p.cliente}</span>
        <span className="block text-[11.5px] text-muted">PS {p.codpro}</span>
      </>
    ),
  },
  { nome: "codpro", titulo: "Nº", largura: 80, classe: "font-mono text-muted", render: (p) => p.codpro },
  { nome: "semAlocacao", titulo: "Sem alocação", direita: true, largura: 110, classe: "font-mono tabular-nums text-warning", formatarResumo: hn, render: (p) => hn(p.semAlocacao) },
  { nome: "executado", titulo: "Executado", direita: true, largura: 100, classe: "font-mono tabular-nums", formatarResumo: hn, render: (p) => hn(p.executado) },
  {
    nome: "pctSem",
    titulo: "%",
    direita: true,
    largura: 70,
    classe: "font-mono tabular-nums text-muted",
    formatarResumo: (v) => pct(v / 100),
    render: (p) => pct(p.executado ? p.semAlocacao / p.executado : 0),
  },
];

const LOCAIS_A_REVISAR: ColunaLocal[] = [
  { nome: "item", tipo: "texto" },
  { nome: "cliente", tipo: "texto" },
  { nome: "codpro", tipo: "inteiro", obrigatoria: true },
  { nome: "consultor", tipo: "texto" },
  { nome: "revisar", tipo: "decimal", obrigatoria: true },
];
const COLUNAS_A_REVISAR: DefColuna<ARevisar, Acoes>[] = [
  {
    nome: "item",
    titulo: "Item",
    fixa: true,
    largura: 240,
    texto: (a) => a.item,
    render: (a, x) => (
      <>
        <button
          type="button"
          onClick={() => x.abrirProposta(a.codemp, a.codpro)}
          className="block max-w-full truncate text-left font-medium text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={a.item}
        >
          {a.item || `Item ${a.seqite}`}
        </button>
        <span className="block truncate text-[11.5px] text-muted">
          PS {a.codpro} · {a.cliente}
        </span>
      </>
    ),
  },
  { nome: "cliente", titulo: "Cliente", largura: 180, classe: "text-muted", texto: (a) => a.cliente, render: (a) => a.cliente },
  { nome: "codpro", titulo: "Nº", largura: 80, classe: "font-mono text-muted", render: (a) => a.codpro },
  {
    nome: "consultor",
    titulo: "Consultor",
    largura: 170,
    render: (a, x) => (
      <button type="button" onClick={() => x.abrirConsultor(a.codfor)} className="text-left text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {a.consultor}
      </button>
    ),
  },
  { nome: "revisar", titulo: "A revisar", direita: true, largura: 100, classe: "font-mono tabular-nums text-warning", formatarResumo: hn, render: (a) => hn(a.revisar) },
];

const LOCAIS_EXCLUSOES: ColunaLocal[] = [
  { nome: "item", tipo: "texto" },
  { nome: "cliente", tipo: "texto" },
  { nome: "codpro", tipo: "inteiro", obrigatoria: true },
  { nome: "consultor", tipo: "texto" },
  { nome: "motivoRotulo", tipo: "texto" },
  { nome: "excluidoPorNome", tipo: "texto" },
  { nome: "excluidoEm", tipo: "data" },
  { nome: "minutos", tipo: "decimal", obrigatoria: true },
];
const COLUNAS_EXCLUSOES: DefColuna<Exclusao, Acoes>[] = [
  {
    nome: "item",
    titulo: "Item",
    fixa: true,
    largura: 230,
    texto: (e) => e.item,
    render: (e, x) => (
      <>
        <button
          type="button"
          onClick={() => x.abrirProposta(e.codemp, e.codpro)}
          className="block max-w-full truncate text-left font-medium text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={e.item ?? undefined}
        >
          {e.item || `Item ${e.seqite}`}
        </button>
        <span className="block truncate text-[11.5px] text-muted">
          PS {e.codpro} · {e.cliente}
        </span>
      </>
    ),
  },
  { nome: "cliente", titulo: "Cliente", largura: 170, classe: "text-muted", texto: (e) => e.cliente, render: (e) => e.cliente },
  { nome: "codpro", titulo: "Nº", largura: 80, classe: "font-mono text-muted", render: (e) => e.codpro },
  { nome: "consultor", titulo: "Consultor", largura: 160, classe: "text-foreground", render: (e) => e.consultor ?? <span className="text-muted">Outro consultor</span> },
  {
    nome: "motivoRotulo",
    titulo: "Motivo",
    largura: 220,
    texto: (e) => [e.motivoRotulo, e.observacao].filter(Boolean).join(" — "),
    render: (e) => (
      <>
        <span className="block text-foreground">{e.motivoRotulo}</span>
        {e.observacao && <span className="block truncate text-[11.5px] text-muted">{e.observacao}</span>}
      </>
    ),
  },
  { nome: "excluidoPorNome", titulo: "Quem", largura: 150, classe: "text-[12.5px] text-muted", render: (e) => e.excluidoPorNome },
  { nome: "excluidoEm", titulo: "Quando", largura: 140, classe: "text-[12.5px] text-muted", render: (e) => dataHoraBr(e.excluidoEm) },
  { nome: "minutos", titulo: "Horas", direita: true, largura: 90, classe: "font-mono tabular-nums", formatarResumo: hhmm, render: (e) => hhmm(e.minutos) },
  {
    nome: "restaurar",
    titulo: "Ações",
    semOrdenar: true,
    direita: true,
    largura: 110,
    render: (e, x) =>
      e.podeRestaurar && (
        <button
          type="button"
          disabled={x.restaurando === e.ratItemId}
          onClick={() => x.restaurar(e.ratItemId)}
          className="rounded-md border border-border bg-surface px-2 py-0.5 text-[12px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          {x.restaurando === e.ratItemId ? "Restaurando…" : "Restaurar"}
        </button>
      ),
  },
];

export function AbaQualidade({
  painel,
  abrirProposta,
  abrirConsultor,
  restaurarApontamento,
}: {
  painel: PainelEficiencia;
  abrirProposta: (codemp: number, codpro: number) => void;
  abrirConsultor: (codfor: number) => void;
  restaurarApontamento: (ratItemId: number) => Promise<void>;
}) {
  const [restaurando, setRestaurando] = useState<number | null>(null);
  const { qualidade: q, resumo: r, carga } = painel;
  const l = painel.meta.limiares;
  const fracSemAloc = r.executado > 0 ? r.semAlocacao / r.executado : 0;
  const somaAtipicas = q.atipicas.reduce((t, p) => t + p.acima, 0);
  const acoes: Acoes = {
    abrirProposta,
    abrirConsultor,
    restaurando,
    restaurar: async (ratItemId) => {
      setRestaurando(ratItemId);
      try {
        await restaurarApontamento(ratItemId);
      } finally {
        setRestaurando(null);
      }
    },
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Indicador
          rotulo="Sem consultor alocado"
          valor={<>{hn(r.semAlocacao)}<small className="ml-0.5 text-[13px] font-medium text-muted">h</small></>}
          sub={`${pct(fracSemAloc)} do executado`}
          medidor={fracSemAloc}
          tom={fracSemAloc > 0.1 ? "bad" : "warn"}
          dica="Executado do item que nenhuma alocação ativa explica (apontamento sem vínculo, ou de quem não está alocado no item)"
        />
        <Indicador rotulo="Alocação a revisar" valor={<>{hn(carga.revisar)}<small className="ml-0.5 text-[13px] font-medium text-muted">h</small></>} sub="em itens sem saldo" tom={carga.revisar >= 60 ? "warn" : undefined} />
        <Indicador
          rotulo="Propostas atípicas"
          valor={q.atipicas.length}
          sub={`consumo ≥ ${pct(l.atipicaConsumo)} e ${hh(l.atipicaAcimaMin)} acima`}
          tom={q.atipicas.length ? "warn" : "ok"}
          dica="Distorcem totais e médias da carteira. Para tirar uma delas dos números, marque Ignorar na lista da aba Propostas."
        />
        <Indicador
          rotulo="Estouro sem valor-hora"
          valor={q.itensSemValorHora}
          sub={q.itensSemValorHora ? `${hh(q.estouroSemValorHora)} fora do impacto em R$` : "todo estouro tem valor-hora"}
          tom={q.itensSemValorHora ? "warn" : "ok"}
          dica="Itens acima do vendido sem valor-hora cadastrado: o impacto em R$ deles sai zerado"
        />
      </div>

      {q.apontadoSemItem && (
        <p className="rounded-md border border-border bg-surface px-4 py-3 text-[13px] text-muted">
          <b className="text-foreground">{q.apontadoSemItem.apontamentos} apontamentos ({hh(q.apontadoSemItem.minutos)})</b> dos últimos 12 meses não casam com nenhum item de proposta (sem
          proposta, sem item ou item inexistente). Não entram em nenhum indicador. Só o administrador vê este aviso.
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Cartao titulo="Horas sem consultor alocado" nota="Por proposta · as 30 maiores">
          {q.semAlocacao.length === 0 ? (
            <Vazio>Nenhuma proposta com apontamento sem dono.</Vazio>
          ) : (
            <TabelaLocal<SemAlocacao, Acoes>
              chave="projetos.eficiencia.sem-alocacao"
              defs={COLUNAS_SEM_ALOCACAO}
              colunas={LOCAIS_SEM_ALOCACAO}
              linhas={q.semAlocacao}
              ler={lerSemAlocacao}
              ctx={acoes}
              chaveLinha={(p) => `${p.codemp}-${p.codpro}`}
              onLinha={(p) => abrirProposta(p.codemp, p.codpro)}
              vazio="Nenhuma proposta com apontamento sem dono."
              alturaMax="max-h-[440px]"
            />
          )}
        </Cartao>

        <Cartao titulo="Alocação a revisar" nota="Consultor alocado em item que já consumiu o vendido">
          {q.aRevisar.length === 0 ? (
            <Vazio>Nenhuma alocação em item sem saldo.</Vazio>
          ) : (
            <TabelaLocal<ARevisar, Acoes>
              chave="projetos.eficiencia.a-revisar"
              defs={COLUNAS_A_REVISAR}
              colunas={LOCAIS_A_REVISAR}
              linhas={q.aRevisar}
              ctx={acoes}
              chaveLinha={(a) => `${a.codpro}-${a.seqite}-${a.codfor}`}
              vazio="Nenhuma alocação em item sem saldo."
              alturaMax="max-h-[440px]"
            />
          )}
        </Cartao>
      </div>

      <Cartao
        titulo="Apontamentos fora do cálculo"
        nota={`${painel.exclusoes.total} ${painel.exclusoes.total === 1 ? "apontamento" : "apontamentos"} · ${hh(painel.exclusoes.minutos)} · só neste painel`}
      >
        {painel.exclusoes.lista.length === 0 ? (
          <Vazio>Nenhum apontamento foi tirado do cálculo. O gestor do item faz isso na gaveta da proposta, em “Ver apontamentos do item”.</Vazio>
        ) : (
          <TabelaLocal<Exclusao, Acoes>
            chave="projetos.eficiencia.exclusoes"
            defs={COLUNAS_EXCLUSOES}
            colunas={LOCAIS_EXCLUSOES}
            linhas={painel.exclusoes.lista}
            ctx={acoes}
            chaveLinha={(e) => String(e.id)}
            vazio="Nenhum apontamento foi tirado do cálculo."
            alturaMax="max-h-[420px]"
          />
        )}
      </Cartao>

      <Cartao titulo="Propostas atípicas" nota={`Consumo de ${pct(l.atipicaConsumo)} ou mais e ${hh(l.atipicaAcimaMin)} ou mais acima do vendido`}>
        {q.atipicas.length === 0 ? (
          <Vazio>Nenhuma proposta fora da curva.</Vazio>
        ) : (
          <ul className="space-y-1.5">
            {q.atipicas.map((p) => (
              <li key={`${p.codemp}-${p.codpro}`}>
                <button
                  type="button"
                  onClick={() => abrirProposta(p.codemp, p.codpro)}
                  className="flex w-full flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-medium text-foreground">{p.cliente} · PS {p.codpro}{p.ignorada && <span className="ml-2 font-sans text-[11.5px] font-normal text-muted">(ignorada nos cálculos)</span>}</span>
                  <span className="font-mono text-[12.5px] tabular-nums text-muted">
                    vendido {hh(p.vendido)} · executado {hh(p.executado)} · <b className="text-destructive">+{hh(p.acima)}</b> ({pct(p.consumo)})
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {q.atipicas.length > 0 && (
          <p className="mt-3 text-[12.5px] text-muted">
            Elas somam {hh(somaAtipicas)} de estouro ({pct(r.acima > 0 ? somaAtipicas / r.acima : 0)} dos {hh(r.acima)} da carteira). Costuma ser contrato de
            implantação com horas lançadas por fora do vendido, ou lançamento errado: vale conferir na origem antes de usar a média da carteira. Para tirar uma delas dos números, marque Ignorar na lista da aba Propostas.
          </p>
        )}
      </Cartao>
    </div>
  );
}
