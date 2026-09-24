import { useState } from "react";
import { useRdvConsultor, type GrupoRdv } from "../../hooks/useRdvConsultor";
import type { FiltroDashboard } from "../../hooks/useDashboardConsultor";
import { Skeleton } from "../ui/Skeleton";
import { BotaoVisibilidade } from "./BotaoVisibilidade";
import { ModalRegistrosRdv, type ItemTituloComFaixa, type SelecaoRdv } from "./ModalRegistrosRdv";

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Valor clicável: abre o modal com os registros que o compõem. Zero não vira link, porque não
// haveria nada pra listar.
function ValorRdv({
  label,
  grupo,
  cor,
  onAbrir,
  destaque = false,
  dica = "Ver os registros que compõem este valor",
}: {
  label: string;
  grupo: GrupoRdv<unknown>;
  cor: string;
  onAbrir: () => void;
  destaque?: boolean;
  dica?: string;
}) {
  const tamanho = destaque ? "text-xl" : "text-lg";
  return (
    <div className={destaque ? "sm:border-l sm:border-border sm:pl-4" : undefined}>
      <p className="text-[11px] text-muted">{label}</p>
      {grupo.itens.length > 0 ? (
        <button
          type="button"
          onClick={onAbrir}
          title={dica}
          className={`font-mono ${tamanho} font-semibold underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none ${cor}`}
        >
          {moeda.format(grupo.total)}
        </button>
      ) : (
        <p className={`font-mono ${tamanho} font-semibold ${cor}`}>{moeda.format(0)}</p>
      )}
    </div>
  );
}

// Card irmão do CardValorHora (mesmo visual e mesmo olho de privacidade), com o dinheiro de
// despesa de viagem do consultor em cada etapa: RDV em RAT ainda não aprovada (Digitada ou
// Fechada, dentro do filtro de período) → título a pagar gerado na aprovação (E501TCP,
// codtpt 10), por vencimento relativo a hoje. Ver rdvDoConsultor no backend.
export function CardRdv({ filtro, rotuloPeriodo }: { filtro: FiltroDashboard; rotuloPeriodo: string }) {
  const { rdv, loading, erro } = useRdvConsultor(filtro);
  const [visivel, setVisivel] = useState(false);
  const [selecao, setSelecao] = useState<SelecaoRdv | null>(null);

  const temVencidos = (rdv?.titulos.vencidos.itens.length ?? 0) > 0;

  // Total a receber = RDV em RAT (segue o filtro de período da página) + TODOS os títulos em
  // aberto (não seguem o filtro: dependem de hoje). Somado em centavos, como o backend faz.
  const centavos = (v: number) => Math.round(v * 100);
  const totalTitulos = rdv
    ? (centavos(rdv.titulos.vencidos.total) + centavos(rdv.titulos.esteMes.total) + centavos(rdv.titulos.proximosMeses.total)) / 100
    : 0;
  const totalReceber = rdv ? (centavos(rdv.rdvEmRat.total) + centavos(totalTitulos)) / 100 : 0;
  const titulosComFaixa: ItemTituloComFaixa[] = rdv
    ? [
        ...rdv.titulos.vencidos.itens.map((t) => ({ ...t, faixa: "Vencido" as const })),
        ...rdv.titulos.esteMes.itens.map((t) => ({ ...t, faixa: "No mês" as const })),
        ...rdv.titulos.proximosMeses.itens.map((t) => ({ ...t, faixa: "Próximos meses" as const })),
      ].sort((a, b) => (a.vctpro < b.vctpro ? -1 : a.vctpro > b.vctpro ? 1 : 0))
    : [];

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">RDV · Despesas de viagem</p>
        <BotaoVisibilidade visivel={visivel} onAlternar={() => setVisivel((v) => !v)} />
      </div>
      {loading && !rdv ? (
        <Skeleton className="mt-3 h-12 rounded-md" />
      ) : erro ? (
        <p className="mt-3 text-sm text-destructive">{erro}</p>
      ) : !rdv ? (
        <p className="mt-3 text-sm text-muted">Cadastro de consultor não encontrado.</p>
      ) : !visivel ? (
        <p className="mt-3 text-sm text-muted">Valores ocultos — clique no ícone pra mostrar.</p>
      ) : (
        <div className={`mt-3 grid grid-cols-2 gap-4 ${temVencidos ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
          <ValorRdv
            label="Em RAT (Digitada/Fechada)"
            grupo={rdv.rdvEmRat}
            cor="text-foreground"
            onAbrir={() => setSelecao({ tipo: "rdv", titulo: "RDV em RATs Digitadas e Fechadas", grupo: rdv.rdvEmRat })}
          />
          {temVencidos && (
            <ValorRdv
              label="Vencidos"
              grupo={rdv.titulos.vencidos}
              cor="text-destructive"
              onAbrir={() => setSelecao({ tipo: "titulos", titulo: "Títulos de RDV vencidos", grupo: rdv.titulos.vencidos })}
            />
          )}
          <ValorRdv
            label="A receber no mês"
            grupo={rdv.titulos.esteMes}
            cor="text-primary"
            onAbrir={() => setSelecao({ tipo: "titulos", titulo: "Títulos de RDV a receber no mês", grupo: rdv.titulos.esteMes })}
          />
          <ValorRdv
            label="Próximos meses"
            grupo={rdv.titulos.proximosMeses}
            cor="text-foreground"
            onAbrir={() => setSelecao({ tipo: "titulos", titulo: "Títulos de RDV a receber nos próximos meses", grupo: rdv.titulos.proximosMeses })}
          />
          <ValorRdv
            label="Total a receber"
            grupo={{ total: totalReceber, itens: [...rdv.rdvEmRat.itens, ...titulosComFaixa] }}
            cor="text-primary"
            destaque
            dica="Soma do RDV em RAT (segue o período filtrado) com todos os títulos em aberto (de hoje em diante) — clique para ver os registros"
            onAbrir={() =>
              setSelecao({
                tipo: "total",
                titulo: "Total a receber das RDVs",
                rdv: rdv.rdvEmRat,
                titulos: { total: totalTitulos, itens: titulosComFaixa },
                total: totalReceber,
              })
            }
          />
        </div>
      )}
      {selecao && (
        <ModalRegistrosRdv
          selecao={selecao}
          // Só o RDV em RAT respeita o filtro de período; os títulos são sempre relativos a hoje.
          subtitulo={
            selecao.tipo === "rdv"
              ? rotuloPeriodo
              : selecao.tipo === "total"
                ? `RDV em RAT: ${rotuloPeriodo} · títulos em aberto: de hoje em diante`
                : "Títulos a pagar em aberto no Senior"
          }
          onClose={() => setSelecao(null)}
        />
      )}
    </section>
  );
}
