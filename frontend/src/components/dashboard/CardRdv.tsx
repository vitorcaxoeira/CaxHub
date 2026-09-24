import { useState } from "react";
import { useRdvConsultor, type GrupoRdv } from "../../hooks/useRdvConsultor";
import type { FiltroDashboard } from "../../hooks/useDashboardConsultor";
import { Skeleton } from "../ui/Skeleton";
import { BotaoVisibilidade } from "./BotaoVisibilidade";
import { ModalRegistrosRdv, type SelecaoRdv } from "./ModalRegistrosRdv";

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Valor clicável: abre o modal com os registros que o compõem. Zero não vira link, porque não
// haveria nada pra listar.
function ValorRdv({ label, grupo, cor, onAbrir }: { label: string; grupo: GrupoRdv<unknown>; cor: string; onAbrir: () => void }) {
  return (
    <div>
      <p className="text-[11px] text-muted">{label}</p>
      {grupo.itens.length > 0 ? (
        <button
          type="button"
          onClick={onAbrir}
          title="Ver os registros que compõem este valor"
          className={`font-mono text-lg font-semibold underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none ${cor}`}
        >
          {moeda.format(grupo.total)}
        </button>
      ) : (
        <p className={`font-mono text-lg font-semibold ${cor}`}>{moeda.format(0)}</p>
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
        <div className={`mt-3 grid grid-cols-2 gap-4 ${temVencidos ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
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
        </div>
      )}
      {selecao && (
        <ModalRegistrosRdv
          selecao={selecao}
          // Só o RDV em RAT respeita o filtro de período; os títulos são sempre relativos a hoje.
          subtitulo={selecao.tipo === "rdv" ? rotuloPeriodo : "Títulos a pagar em aberto no Senior"}
          onClose={() => setSelecao(null)}
        />
      )}
    </section>
  );
}
