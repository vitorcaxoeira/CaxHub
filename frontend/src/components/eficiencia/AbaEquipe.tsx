import { useMemo, useState } from "react";
import { ConsultorLinha, PainelEficiencia, clienteCurto, hh, hn, meses1, nomeCurto, paraTsv, pct, tomEficiencia, tomMeses, tomTexto } from "../../lib/eficiencia";
import { BotaoCopiar, Cartao, Indicador, Ordem, TabelaRolavel, Th, Vazio, ordenar, proximaOrdem } from "./comum";

type Chave = "nome" | "pendente" | "meses" | "revisar" | "executado" | "eficiencia" | "propostasComSaldo";

export function AbaEquipe({
  painel,
  abrirConsultor,
  abrirProposta,
}: {
  painel: PainelEficiencia;
  abrirConsultor: (codfor: number) => void;
  abrirProposta: (codemp: number, codpro: number) => void;
}) {
  const [ordem, setOrdem] = useState<Ordem<Chave>>({ chave: "pendente", dir: -1 });
  const { meta, equipe, carga } = painel;
  const l = meta.limiares;
  const capMin = meta.capacidadeHorasMes * 60;
  const consultores = equipe.consultores;

  const executadoTotal = consultores.reduce((t, c) => t + c.executado, 0);
  // Eficiência da equipe: média das eficiências ponderada pelo executado de cada um.
  const eficienciaEquipe = executadoTotal > 0 ? consultores.reduce((t, c) => t + (c.eficiencia ?? 0) * c.executado, 0) / executadoTotal : null;

  const linhas = useMemo(
    () => ordenar<ConsultorLinha, Chave>(consultores, ordem, (c, k) => (k === "nome" ? c.nome : k === "eficiencia" ? c.eficiencia ?? 2 : c[k])),
    [consultores, ordem]
  );
  const limite = Math.max(3.5, ...consultores.map((c) => (c.pendente + c.revisar) / capMin));
  const ordenarPor = (k: Chave) => setOrdem((o) => proximaOrdem(o, k, ["nome"]));

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
        nota="Carga pendente: horas alocadas que ainda cabem no saldo do item"
        acao={
          <BotaoCopiar
            montar={() =>
              paraTsv(
                ["Consultor", "Departamento", "Pendente (h)", "Meses", "A revisar (h)", "Executado (h)", "Alocado (h)", "Eficiência %", "Propostas com saldo"],
                linhas.map((c) => [c.nome, c.departamento ?? "", (c.pendente / 60).toFixed(1), meses1(c.meses), (c.revisar / 60).toFixed(1), (c.executado / 60).toFixed(1), (c.alocado / 60).toFixed(1), c.eficiencia == null ? "" : Math.round(c.eficiencia * 100), c.propostasComSaldo])
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
          <TabelaRolavel altura="max-h-[60vh]">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <Th rotulo="Consultor" chave="nome" ordem={ordem} onOrdenar={ordenarPor} />
                  <Th rotulo="Carteira" className="min-w-[200px]" />
                  <Th rotulo="Pendente" chave="pendente" ordem={ordem} onOrdenar={ordenarPor} numerico />
                  <Th rotulo="Meses" chave="meses" ordem={ordem} onOrdenar={ordenarPor} numerico />
                  <Th rotulo="A revisar" chave="revisar" ordem={ordem} onOrdenar={ordenarPor} numerico />
                  <Th rotulo="Executado" chave="executado" ordem={ordem} onOrdenar={ordenarPor} numerico />
                  <Th rotulo="Eficiência" chave="eficiencia" ordem={ordem} onOrdenar={ordenarPor} numerico />
                  <Th rotulo="Propostas c/ saldo" chave="propostasComSaldo" ordem={ordem} onOrdenar={ordenarPor} numerico />
                </tr>
              </thead>
              <tbody>
                {linhas.map((c) => (
                  <tr
                    key={c.codfor}
                    tabIndex={0}
                    onClick={() => abrirConsultor(c.codfor)}
                    onKeyDown={(e) => e.key === "Enter" && abrirConsultor(c.codfor)}
                    className="cursor-pointer border-t border-border/60 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <td className="px-2.5 py-2">
                      <span className="block font-medium text-foreground">{nomeCurto(c.nome)}</span>
                      <span className="block text-[11.5px] text-muted">{c.departamento ?? "—"}</span>
                    </td>
                    <td className="px-2.5 py-2">
                      <span className="relative flex h-3 gap-0.5 rounded bg-surface-2">
                        <span className="block rounded bg-primary" style={{ width: `${(c.pendente / capMin / limite) * 100}%` }} />
                        <span className="block rounded bg-muted/50" style={{ width: `${(c.revisar / capMin / limite) * 100}%` }} />
                        <span className="absolute -inset-y-1 border-l-[1.5px] border-dashed border-muted" style={{ left: `${(l.mesesSobrecarga / limite) * 100}%` }} />
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{hn(c.pendente)}</td>
                    <td className={`whitespace-nowrap px-2.5 py-2 text-right font-mono font-semibold tabular-nums ${tomTexto[tomMeses(c.meses, l)]}`}>{meses1(c.meses)}</td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums text-muted">{c.revisar >= 30 ? hn(c.revisar) : "—"}</td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{hn(c.executado)}</td>
                    <td className={`whitespace-nowrap px-2.5 py-2 text-right font-mono font-semibold tabular-nums ${tomTexto[tomEficiencia(c.eficiencia, l)]}`}>{pct(c.eficiencia)}</td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{c.propostasComSaldo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabelaRolavel>
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
