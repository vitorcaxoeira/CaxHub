import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { ListaServidor } from "../colunas/ListaServidor";
import { MultiSelectDropdown } from "../ui/MultiSelectDropdown";
import { Skeleton } from "../ui/Skeleton";
import { COLUNAS_PARCELAS_SEM_CONSULTOR, type ParcelaLista } from "../../pages/projetos/descontos/colunasParcelas";
import { fmtMoeda, SITUACAO_OPCOES, useAcessoDescontos, type SituacaoParcela } from "../../pages/projetos/descontos/comum";
import { BotaoVisibilidade } from "./BotaoVisibilidade";

// Seção da Home, logo depois do RDV: as parcelas de desconto do consultor em foco (as mesmas linhas de Gestão de Descontos › Parcelas), num acordeão
// que nasce FECHADO, com o olho para abrir (mesmo molde do card de RDV: dinheiro não fica à mostra em compartilhamento de tela). Fechado, nem busca
// os dados. Não segue o ano/mês do topo da Home: tem os próprios filtros, Ano (anos distintos da competência das parcelas; vem marcado o ano corrente
// e os seguintes) e Situação (vem só "Pendente"), mais o filtro por coluna da lista. Nada marcado = sem filtro. O `codfor` vai sempre explícito para a
// API: sem ele um admin, na própria Home, veria as parcelas de todos os consultores.

/** Ano corrente em Brasília (o do navegador pode estar em outro fuso). */
const anoCorrente = () => Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric" }).format(new Date()));

export function CardDescontosParcelas({ codfor }: { codfor?: number }) {
  const acesso = useAcessoDescontos();
  const [visivel, setVisivel] = useState(false);
  const alvo = codfor ?? acesso?.proprioCodfor ?? null;

  // Anos que existem nas parcelas do consultor (null = ainda buscando). Recarrega, e refaz o padrão de marcação, ao trocar de consultor.
  const [anosDisponiveis, setAnosDisponiveis] = useState<number[] | null>(null);
  const [anos, setAnos] = useState<number[]>([]);
  const [situacoes, setSituacoes] = useState<SituacaoParcela[]>(["pendente"]);

  useEffect(() => {
    setAnosDisponiveis(null);
    if (!visivel || alvo == null) return;
    let cancelado = false;
    axios
      .get<{ anos: number[] }>("/api/descontos/parcelas-anos", { params: { codfor: alvo } })
      .then(({ data }) => {
        if (cancelado) return;
        setAnosDisponiveis(data.anos);
        // Padrão: o ano corrente e os maiores. Se nenhum ano da lista é >= o corrente, nada marcado (= todos): não esconde tudo.
        setAnos(data.anos.filter((a) => a >= anoCorrente()));
      })
      .catch(() => !cancelado && setAnosDisponiveis([]));
    return () => {
      cancelado = true;
    };
  }, [visivel, alvo]);

  const params = useMemo(
    () => ({ codfor: alvo ?? undefined, anos: anos.join(",") || undefined, situacoes: situacoes.join(",") || undefined }),
    [alvo, anos, situacoes]
  );

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Descontos · Parcelas</p>
        <BotaoVisibilidade visivel={visivel} onAlternar={() => setVisivel((v) => !v)} />
      </div>
      {!visivel ? (
        <p className="mt-3 text-sm text-muted">Valores ocultos — clique no ícone pra mostrar.</p>
      ) : !acesso || (alvo != null && anosDisponiveis === null) ? (
        <Skeleton className="mt-3 h-24 w-full rounded-md" />
      ) : alvo == null || (anosDisponiveis?.length ?? 0) === 0 ? (
        <p className="mt-3 text-sm text-muted">Nenhum desconto lançado para este consultor.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <MultiSelectDropdown
              opcoes={(anosDisponiveis ?? []).map((a) => ({ value: a, label: String(a) }))}
              selecionados={anos}
              onChange={setAnos}
              labelTodos="Todos os anos"
              labelSufixo="anos"
            />
            <MultiSelectDropdown
              opcoes={SITUACAO_OPCOES.map((o) => ({ value: o.valor, label: o.rotulo }))}
              selecionados={situacoes}
              onChange={setSituacoes}
              labelTodos="Todas as situações"
              labelSufixo="situações"
            />
          </div>
          <ListaServidor<ParcelaLista>
            chave="home.descontos.parcelas"
            url="/api/descontos/parcelas"
            params={params}
            defs={COLUNAS_PARCELAS_SEM_CONSULTOR}
            chaveLinha={(p) => String(p.id)}
            rotulo="parcelas"
            vazio="Nenhuma parcela com esses filtros."
            pageSize={10}
            opcoesPorPagina={[10, 30, 50]}
            rodape={(d) => (
              <div className="flex flex-wrap gap-x-8 gap-y-1 border-t border-border bg-surface px-5 py-3">
                {(
                  [
                    ["Valor (filtro atual)", d?.totais?.valor],
                    ["Descontado", d?.totais?.valorDescontado],
                    ["Restante", d?.totais?.restante],
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
      )}
    </section>
  );
}
