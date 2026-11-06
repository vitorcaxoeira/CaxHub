import { useMemo, useState } from "react";
import { ListaServidor } from "../../../components/colunas/ListaServidor";
import { COLUNAS_PARCELAS, type ParcelaLista } from "./colunasParcelas";
import { classeFiltro, fmtMoeda, SITUACAO_OPCOES, useOpcoesDescontos } from "./comum";

// Gestão de Descontos › Parcelas: uma linha por parcela, de todos os processos. É a base dos relatórios (por competência, parcelas pendentes,
// previsão de descontos futuros, canceladas/estornadas, saldo por consultor): filtre, ordene, agrupe pelo resumo do rodapé e exporte.

export function DescontosParcelas() {
  const { consultores, tipos } = useOpcoesDescontos();
  const [codfor, setCodfor] = useState("");
  const [tipoId, setTipoId] = useState("");
  const [processo, setProcesso] = useState("");
  const [situacao, setSituacao] = useState("");
  const [competenciaDe, setCompetenciaDe] = useState("");
  const [competenciaAte, setCompetenciaAte] = useState("");

  const params = useMemo(
    () => ({
      codfor: codfor || undefined,
      tipoId: tipoId || undefined,
      processo: processo.trim() || undefined,
      situacao: situacao || undefined,
      competenciaDe: competenciaDe || undefined,
      competenciaAte: competenciaAte || undefined,
    }),
    [codfor, tipoId, processo, situacao, competenciaDe, competenciaAte]
  );

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão de Projetos · Gestão de Descontos</p>
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold text-foreground">Parcelas de descontos</h1>
        <p className="mt-1 text-sm text-muted">
          Cada parcela cai na competência do seu vencimento. Filtre por situação “Pendente” para ver o que ainda será descontado (previsão), ou por competência
          para conferir um mês.
        </p>
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
        <select aria-label="Tipo de desconto" className={classeFiltro} value={tipoId} onChange={(e) => setTipoId(e.target.value)}>
          <option value="">Todos os tipos</option>
          {tipos.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nome}
            </option>
          ))}
        </select>
        <input aria-label="Número do processo" className={`${classeFiltro} w-44`} value={processo} onChange={(e) => setProcesso(e.target.value)} placeholder="Processo (DESC-2026-…)" />
        <select aria-label="Situação da parcela" className={classeFiltro} value={situacao} onChange={(e) => setSituacao(e.target.value)}>
          <option value="">Todas as situações</option>
          {SITUACAO_OPCOES.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
          Competência
          <input type="month" aria-label="Competência de" className={classeFiltro} value={competenciaDe} max={competenciaAte || undefined} onChange={(e) => setCompetenciaDe(e.target.value)} />
          –
          <input type="month" aria-label="Competência até" className={classeFiltro} value={competenciaAte} min={competenciaDe || undefined} onChange={(e) => setCompetenciaAte(e.target.value)} />
        </label>
      </div>

      <ListaServidor<ParcelaLista>
        chave="projetos.descontos.parcelas"
        exportavel="descontos-parcelas"
        url="/api/descontos/parcelas"
        params={params}
        defs={COLUNAS_PARCELAS}
        chaveLinha={(p) => String(p.id)}
        rotulo="parcelas"
        vazio="Nenhuma parcela encontrada."
        pageSize={30}
        opcoesPorPagina={[30, 50, 100, 200]}
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
  );
}
