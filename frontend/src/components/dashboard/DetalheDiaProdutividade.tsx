import { BlocoProdutividade, DeslocamentoProdutividade, ItemProdutividade, hhmm, milhar } from "../../lib/produtividade";

// Detalhe de UM dia dentro de "Horas por semana" (Home): as mesmas linhas do relatório Produtividade por
// Fornecedor (RelatorioProdutividade.tsx), só que sem a coluna de data, que já está no título do dia. Recebe os
// blocos de todo o período e filtra pelo dia.
//
// O total do dia no acordeão vem de /meu-resumo e conta também as sessões de execução ainda NÃO confirmadas,
// que só viram item de RAT ao confirmar (e por isso o relatório não as tem). A diferença aparece numa linha
// à parte, pra a soma das linhas não "faltar" em relação ao total do cabeçalho do dia.

const cabecalho = "px-1.5 py-1 text-left font-mono text-[9.5px] font-medium uppercase tracking-tight text-muted";
const celula = "px-1.5 py-[3px] align-top";

export function DetalheDiaProdutividade({ data, minutosDoDia, blocos }: { data: string; minutosDoDia: number; blocos: BlocoProdutividade[] }) {
  const doDia = blocos.filter((b): b is ItemProdutividade | DeslocamentoProdutividade => b.tipo !== "subtotal" && b.data === data);
  const itens = doDia.filter((b): b is ItemProdutividade => b.tipo === "item");
  const somaItens = itens.reduce((s, i) => s + i.minutos, 0);
  const naoConfirmado = Math.max(0, minutosDoDia - somaItens);

  if (doDia.length === 0 && naoConfirmado === 0) {
    return <p className="px-1.5 py-2 text-[12.5px] text-muted">Sem lançamentos de RAT neste dia.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] table-fixed border-collapse text-[12px] leading-tight">
        <colgroup>
          <col style={{ width: "116px" }} />
          <col style={{ width: "58px" }} />
          <col style={{ width: "64px" }} />
          <col style={{ width: "76px" }} />
          <col />
          <col style={{ width: "104px" }} />
          <col style={{ width: "34px" }} />
        </colgroup>
        <thead className="border-y border-border bg-surface-2">
          <tr>
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
          {doDia.map((b, i) =>
            b.tipo === "item" ? (
              <tr key={i} className="border-b border-border/50">
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
            ) : (
              <tr key={i} className="border-b border-border/50 italic text-muted">
                <td className={celula} />
                <td className={`${celula} tabular-nums not-italic text-foreground`}>{hhmm(b.minutos)}</td>
                <td className={celula} colSpan={5}>
                  Referente às horas de deslocamento {b.numrats.length > 1 ? "das RATs" : "da RAT"} ({b.numrats.join(", ")})
                </td>
              </tr>
            )
          )}
          {naoConfirmado > 0 && (
            <tr className="italic text-warning" title="Tempo já rastreado em sessões que ainda não foram confirmadas: vira item de RAT (e linha do relatório) quando você confirmar.">
              <td className={celula} />
              <td className={`${celula} tabular-nums not-italic`}>{hhmm(naoConfirmado)}</td>
              <td className={celula} colSpan={5}>
                Sessões ainda não confirmadas (entram no relatório depois de confirmadas)
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
