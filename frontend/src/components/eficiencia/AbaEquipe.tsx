import { useMemo } from "react";
import { ConsultorLinha, PainelEficiencia, clienteCurto, hh, hn, meses1, nomeCurto, paraTsv, pct, tomEficiencia, tomMeses, tomTexto } from "../../lib/eficiencia";
import { BotaoCopiar, Cartao, Indicador, Vazio } from "./comum";
import { TabelaLocal } from "../colunas/TabelaLocal";
import type { ColunaLocal } from "../colunas/aplicarLocal";
import type { DefColuna } from "../colunas/useColunasConfiguraveis";

interface CtxEquipe {
  l: PainelEficiencia["meta"]["limiares"];
  capMin: number;
  limite: number;
  alternar: (codfor: number) => void;
}

// Filtro e ordem por coluna, colunas configuráveis, resumo no rodapé e colunas calculadas (TabelaLocal, 03/11/2026). Abre na ordem de
// sempre (maior carga pendente primeiro). Horas em minutos (hn formata).
const COLUNAS_LOCAIS: ColunaLocal[] = [
  { nome: "nome", tipo: "texto", obrigatoria: true },
  { nome: "departamento", tipo: "texto" },
  { nome: "pendente", tipo: "decimal", obrigatoria: true },
  { nome: "meses", tipo: "decimal", obrigatoria: true },
  { nome: "revisar", tipo: "decimal", obrigatoria: true },
  { nome: "executado", tipo: "decimal", obrigatoria: true },
  { nome: "alocado", tipo: "decimal", obrigatoria: true },
  { nome: "eficienciaPct", tipo: "decimal" },
  { nome: "propostasComSaldo", tipo: "inteiro", obrigatoria: true },
];
const lerConsultor = (c: ConsultorLinha, nome: string): unknown =>
  nome === "eficienciaPct" ? (c.eficiencia == null ? null : c.eficiencia * 100) : (c as unknown as Record<string, unknown>)[nome];

const COLUNAS_CONSULTORES: DefColuna<ConsultorLinha, CtxEquipe>[] = [
  {
    nome: "ignorar",
    titulo: "Ignorar",
    semOrdenar: true,
    largura: 64,
    // Check de ignorar: tira o consultor dos indicadores da equipe (carga, eficiência, sobrecarga, a revisar, mapa e alertas). Não abre a gaveta.
    render: (c, x) => (
      <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={c.ignorado}
          onChange={() => x.alternar(c.codfor)}
          aria-label={`Ignorar ${c.nome} nos indicadores da equipe`}
          title={c.ignorado ? "Ignorado: desmarque para voltar a contar nos indicadores da equipe" : "Marque para tirar este consultor dos indicadores da equipe"}
          className="h-4 w-4 cursor-pointer accent-primary"
        />
      </span>
    ),
  },
  {
    nome: "nome",
    titulo: "Consultor",
    fixa: true,
    largura: 200,
    texto: (c) => c.nome,
    render: (c) => (
      <>
        <span className={`block truncate font-medium text-foreground ${c.ignorado ? "line-through" : ""}`}>{nomeCurto(c.nome)}</span>
        <span className="block truncate text-[11.5px] text-muted">
          {c.departamento ?? "—"}
          {c.ignorado && " · ignorado nos indicadores"}
        </span>
      </>
    ),
  },
  { nome: "departamento", titulo: "Departamento", largura: 150, classe: "text-muted", render: (c) => c.departamento ?? "—" },
  {
    nome: "carteira",
    titulo: "Carteira",
    semOrdenar: true,
    largura: 200,
    render: (c, x) => (
      <span className="relative flex h-3 gap-0.5 rounded bg-surface-2">
        <span className="block rounded bg-primary" style={{ width: `${(c.pendente / x.capMin / x.limite) * 100}%` }} />
        <span className="block rounded bg-muted/50" style={{ width: `${(c.revisar / x.capMin / x.limite) * 100}%` }} />
        <span className="absolute -inset-y-1 border-l-[1.5px] border-dashed border-muted" style={{ left: `${(x.l.mesesSobrecarga / x.limite) * 100}%` }} />
      </span>
    ),
  },
  { nome: "pendente", titulo: "Pendente", direita: true, largura: 95, classe: "font-mono tabular-nums", formatarResumo: hn, render: (c) => hn(c.pendente) },
  {
    nome: "meses",
    titulo: "Meses",
    direita: true,
    largura: 80,
    classe: (c, x) => `font-mono font-semibold tabular-nums ${tomTexto[tomMeses(c.meses, x.l)]}`,
    formatarResumo: meses1,
    render: (c) => meses1(c.meses),
  },
  {
    nome: "revisar",
    titulo: "A revisar",
    direita: true,
    largura: 95,
    classe: "font-mono tabular-nums text-muted",
    formatarResumo: hn,
    render: (c) => (c.revisar >= 30 ? hn(c.revisar) : "—"),
  },
  { nome: "executado", titulo: "Executado", direita: true, largura: 95, classe: "font-mono tabular-nums", formatarResumo: hn, render: (c) => hn(c.executado) },
  { nome: "alocado", titulo: "Alocado", direita: true, largura: 95, classe: "font-mono tabular-nums text-muted", formatarResumo: hn, render: (c) => hn(c.alocado) },
  {
    nome: "eficienciaPct",
    titulo: "Eficiência",
    direita: true,
    largura: 100,
    classe: (c, x) => `font-mono font-semibold tabular-nums ${tomTexto[tomEficiencia(c.eficiencia, x.l)]}`,
    formatarResumo: (v) => pct(v / 100),
    render: (c) => pct(c.eficiencia),
  },
  { nome: "propostasComSaldo", titulo: "Propostas c/ saldo", direita: true, largura: 120, classe: "font-mono tabular-nums", render: (c) => c.propostasComSaldo },
];

export function AbaEquipe({
  painel,
  abrirConsultor,
  abrirProposta,
  recorteDepartamentos,
  onAlternarIgnorado,
}: {
  painel: PainelEficiencia;
  abrirConsultor: (codfor: number) => void;
  abrirProposta: (codemp: number, codpro: number) => void;
  /** Rótulos dos departamentos escolhidos no filtro: a equipe mostra só o time deles. Vazio = sem recorte. */
  recorteDepartamentos?: string;
  /** Liga/desliga o consultor nos indicadores da equipe (escolha pessoal, guardada no navegador). */
  onAlternarIgnorado: (codfor: number) => void;
}) {
  const { meta, equipe, carga } = painel;
  const l = meta.limiares;
  const capMin = meta.capacidadeHorasMes * 60;
  const consultores = equipe.consultores;

  // Os ignorados ficam na lista (esmaecidos, pra dar pra desmarcar), mas não entram em nenhum total daqui.
  const contam = consultores.filter((c) => !c.ignorado);
  const executadoTotal = contam.reduce((t, c) => t + c.executado, 0);
  // Eficiência da equipe: média das eficiências ponderada pelo executado de cada um.
  const eficienciaEquipe = executadoTotal > 0 ? contam.reduce((t, c) => t + (c.eficiencia ?? 0) * c.executado, 0) / executadoTotal : null;

  // Abre da maior carga pendente para a menor (a ordem de sempre); a tabela reordena pelo título.
  const linhas = useMemo(() => [...consultores].sort((a, b) => b.pendente - a.pendente), [consultores]);
  const limite = Math.max(3.5, ...contam.map((c) => (c.pendente + c.revisar) / capMin));

  const { mapa } = equipe;
  const maxCelula = Math.max(1, ...mapa.celulas.map((c) => c.executado));
  const celula = (codfor: number, codemp: number, codpro: number) => mapa.celulas.find((c) => c.codfor === codfor && c.codemp === codemp && c.codpro === codpro);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Indicador rotulo="Carga pendente" valor={<>{hn(carga.pendente)}<small className="ml-0.5 text-[13px] font-medium text-muted">h</small></>} sub={`${meses1(carga.pendente / capMin)} meses de um consultor`} />
        <Indicador
          rotulo="Eficiência da equipe"
          valor={pct(eficienciaEquipe)}
          sub="executado dentro da alocação"
          medidor={eficienciaEquipe ?? 0}
          tom={tomEficiencia(eficienciaEquipe, l)}
          dica="Horas executadas dentro do que foi alocado ÷ horas executadas, nos itens em que o consultor está alocado"
        />
        <Indicador rotulo={`Acima de ${l.mesesSobrecarga} meses`} valor={carga.consultoresEmSobrecarga} sub="consultores em sobrecarga" tom={carga.consultoresEmSobrecarga ? "bad" : "ok"} />
        <Indicador rotulo="Alocação a revisar" valor={<>{hn(carga.revisar)}<small className="ml-0.5 text-[13px] font-medium text-muted">h</small></>} sub="em itens sem saldo" dica="Horas alocadas que sobram em itens que já consumiram o vendido" />
      </div>

      <Cartao
        titulo="Consultores"
        nota={`Carga pendente: horas alocadas que ainda cabem no saldo do item${recorteDepartamentos ? ` · só o time de ${recorteDepartamentos}` : ""}`}
        acao={
          <BotaoCopiar
            montar={() =>
              paraTsv(
                ["Consultor", "Departamento", "Pendente (h)", "Meses", "A revisar (h)", "Executado (h)", "Alocado (h)", "Eficiência %", "Propostas com saldo", "Ignorado nos indicadores"],
                linhas.map((c) => [c.nome, c.departamento ?? "", (c.pendente / 60).toFixed(1), meses1(c.meses), (c.revisar / 60).toFixed(1), (c.executado / 60).toFixed(1), (c.alocado / 60).toFixed(1), c.eficiencia == null ? "" : Math.round(c.eficiencia * 100), c.propostasComSaldo, c.ignorado ? "Sim" : ""])
              )
            }
          />
        }
      >
        <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary" />Carga pendente</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-muted/50" />Alocação a revisar</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0 border-l-[1.5px] border-dashed border-muted" />{l.mesesSobrecarga} meses de capacidade</span>
        </p>
        {linhas.length === 0 ? (
          <Vazio>Nenhum consultor com alocação nas propostas deste recorte.</Vazio>
        ) : (
          <TabelaLocal<ConsultorLinha, CtxEquipe>
            chave="projetos.eficiencia.equipe"
            defs={COLUNAS_CONSULTORES}
            colunas={COLUNAS_LOCAIS}
            linhas={linhas}
            ler={lerConsultor}
            ctx={{ l, capMin, limite, alternar: onAlternarIgnorado }}
            chaveLinha={(c) => String(c.codfor)}
            onLinha={(c) => abrirConsultor(c.codfor)}
            classeLinha={(c) => (c.ignorado ? "opacity-45" : undefined)}
            vazio="Nenhum consultor com alocação nas propostas deste recorte."
          />
        )}
      </Cartao>

      <Cartao titulo="Mapa de alocação" nota="Horas executadas por consultor nas propostas com mais horas · cor mais forte = mais horas">
        {mapa.consultores.length === 0 ? (
          <Vazio>Sem horas executadas neste recorte.</Vazio>
        ) : (
          <div className="overflow-auto">
            <table className="border-separate border-spacing-[3px] text-[12px]">
              <thead>
                <tr>
                  <th />
                  {mapa.propostas.map((p) => (
                    <th key={`${p.codemp}-${p.codpro}`} className="max-w-[76px] min-w-[64px] px-1 pb-1 align-bottom font-mono text-[10.5px] font-medium leading-tight text-muted" title={p.cliente}>
                      <button type="button" onClick={() => abrirProposta(p.codemp, p.codpro)} className="block w-full text-center hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="block font-semibold text-foreground">PS {p.codpro}</span>
                        <span className="block truncate">{clienteCurto(p.cliente).split(" ")[0]}</span>
                      </button>
                    </th>
                  ))}
                  <th className="px-2 text-right font-mono text-[10.5px] font-medium text-muted">Total</th>
                </tr>
              </thead>
              <tbody>
                {mapa.consultores.map((c) => (
                  <tr key={c.codfor}>
                    <th className="min-w-[150px] pr-2 text-left text-[12.5px] font-semibold">
                      <button type="button" onClick={() => abrirConsultor(c.codfor)} className="text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {nomeCurto(c.nome)}
                      </button>
                    </th>
                    {mapa.propostas.map((p) => {
                      const v = celula(c.codfor, p.codemp, p.codpro);
                      if (!v) return <td key={`${p.codemp}-${p.codpro}`} className="h-8 rounded bg-surface-2/60" />;
                      const forca = 0.14 + 0.86 * Math.sqrt(v.executado / maxCelula);
                      return (
                        <td
                          key={`${p.codemp}-${p.codpro}`}
                          className="h-8 cursor-pointer rounded text-center font-mono text-[11.5px]"
                          style={{
                            background: `color-mix(in srgb, var(--primary) ${Math.round(forca * 100)}%, var(--surface))`,
                            color: forca > 0.55 ? "var(--primary-foreground)" : "var(--foreground)",
                          }}
                          onClick={() => abrirProposta(p.codemp, p.codpro)}
                          title={`${c.nome} em ${p.cliente}\nExecutado ${hh(v.executado)} · Alocado ${hh(v.alocado)} · ${pct(v.parteDaProposta)} da proposta`}
                        >
                          {v.executado >= 600 ? hn(v.executado) : ""}
                        </td>
                      );
                    })}
                    <td className="pl-2 text-right font-mono text-[12px] tabular-nums text-foreground">{hn(c.executado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
    </div>
  );
}
