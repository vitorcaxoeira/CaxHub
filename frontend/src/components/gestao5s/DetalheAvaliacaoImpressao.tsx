import { CAMPOS_BLOCO, DetalheAvaliacao5S, SENSOS, formatarDiaIso, formatarPerc } from "../../utils/gestao5s";
import { GradeFotos } from "./ImagemRelatorio";
import { Celula } from "./ResultadoSecoes";

export interface FilhaDetalhe {
  id: number;
  nome: string;
  // null = a busca do detalhe falhou
  detalhe: DetalheAvaliacao5S | null;
}

const rotuloCampo = "mb-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted";

// Faixa com o resultado de cada senso + geral (mesmas células coloridas do dashboard).
function FaixaSensos({ av }: { av: DetalheAvaliacao5S }) {
  return (
    <div className="grid grid-cols-6 gap-2">
      {SENSOS.map((s) => (
        <div key={s.chave} className="rounded-md border border-border/60 p-2 text-center">
          <p className="text-[11px] text-muted">{s.curto}</p>
          <Celula valor={av.percentuais.porSenso[s.chave]} />
        </div>
      ))}
      <div className="rounded-md border border-border p-2 text-center">
        <p className="text-[11px] font-semibold text-foreground">Geral</p>
        <Celula valor={av.percentuais.geral} negrito />
      </div>
    </div>
  );
}

// Perguntas e fechamento de cada senso de UMA avaliação (não-pai).
function CorpoAvaliacao({ av }: { av: DetalheAvaliacao5S }) {
  return (
    <div className="space-y-4">
      {SENSOS.map((s) => {
        const perguntas = av.respostas.filter((r) => r.senso === s.chave);
        const bloco = av.sensos.find((b) => b.senso === s.chave);
        const temFechamento = !!bloco && (CAMPOS_BLOCO.some((c) => bloco[c.chave]) || bloco.imagens.length > 0);
        if (perguntas.length === 0 && !temFechamento) return null;
        return (
          <div key={s.chave}>
            <h4 className="mb-1 flex items-baseline justify-between gap-2 border-b border-border pb-1 font-display text-sm font-bold text-foreground">
              <span>{s.rotulo}</span>
              <span className="font-mono text-xs tabular-nums text-muted">{formatarPerc(av.percentuais.porSenso[s.chave])}</span>
            </h4>
            {perguntas.length > 0 && (
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {perguntas.map((r, i) => (
                    <tr key={r.id} className="break-inside-avoid border-t border-border/60 align-top first:border-t-0">
                      <td className="w-8 py-1.5 pr-2 font-mono text-xs text-muted">{i + 1}.</td>
                      <td className="py-1.5 pr-3 text-foreground">
                        {r.texto}
                        {r.inconsistencia && (
                          <div className="mt-1">
                            <p className={rotuloCampo}>Inconsistência</p>
                            <p className="whitespace-pre-wrap text-foreground">{r.inconsistencia}</p>
                          </div>
                        )}
                        {r.complemento && (
                          <div className="mt-1">
                            <p className={rotuloCampo}>Informações complementares</p>
                            <p className="whitespace-pre-wrap text-foreground">{r.complemento}</p>
                          </div>
                        )}
                        <GradeFotos imagens={r.imagens} />
                      </td>
                      <td className="w-14 py-1.5 text-center font-semibold text-foreground">{r.naoSeAplica ? "NA" : (r.nota ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {temFechamento && bloco && (
              <div className="mt-2 break-inside-avoid space-y-1.5 rounded-md bg-surface-2 p-2.5">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Fechamento de {s.nome}</p>
                {CAMPOS_BLOCO.map((c) =>
                  bloco[c.chave] ? (
                    <div key={c.chave}>
                      <p className={rotuloCampo}>{c.rotulo}</p>
                      <p className="whitespace-pre-wrap text-sm text-foreground">{bloco[c.chave]}</p>
                    </div>
                  ) : null
                )}
                <GradeFotos imagens={bloco.imagens} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Quantas fotos `DetalheAvaliacaoImpressao` vai desenhar para esta avaliação — mesma regra do render
// (fotos das respostas e do fechamento de cada senso, das filhas quando é pai, e das observações da
// equipe do próprio av). O relatório usa o total pra saber se TODAS as fotos já terminaram de carregar
// (sem depender de as fotos já terem se registrado).
export function contarFotos(av: DetalheAvaliacao5S, filhas: FilhaDetalhe[]): number {
  const doCorpo = (d: DetalheAvaliacao5S) => d.respostas.reduce((n, r) => n + r.imagens.length, 0) + d.sensos.reduce((n, b) => n + b.imagens.length, 0);
  const corpo = av.filhas.length > 0 ? filhas.reduce((n, f) => n + (f.detalhe ? doCorpo(f.detalhe) : 0), 0) : doCorpo(av);
  return corpo + av.observacoesEquipe.reduce((n, o) => n + o.imagens.length, 0);
}

function Falha({ id }: { id: number }) {
  return <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">Não foi possível carregar a avaliação #{id}.</p>;
}

// Detalhe completo de uma avaliação no relatório "Detalhado" — o PDF precisa se bastar, porque quem o
// recebe não tem acesso ao módulo 5S. Cada avaliação começa em página nova. Avaliação-pai (área
// agrupadora) não tem perguntas: mostra o acumulado e um bloco por ambiente (`filhas`). As
// observações da equipe vêm uma vez só, no pai (o detalhe do pai já traz as das áreas filhas).
export function DetalheAvaliacaoImpressao({ av, filhas }: { av: DetalheAvaliacao5S; filhas: FilhaDetalhe[] }) {
  const ehPai = av.filhas.length > 0;
  return (
    <article id={`avaliacao-${av.id}`} className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-sm print:break-before-page print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">
          Avaliação #{av.id} · {av.areaTipo === "comum" ? "Ambiente comum" : "Setor"}
        </p>
        <h3 className="font-display text-xl font-bold text-foreground">{av.titulo}</h3>
        <p className="text-sm text-muted">
          {formatarDiaIso(av.data)} · Avaliador: {av.avaliadorNome ?? "—"}
          {ehPai && ` · ${av.filhas.length} ambientes`}
        </p>
      </header>

      <FaixaSensos av={av} />

      {ehPai ? (
        filhas.map((f) => (
          <section key={f.id} className="space-y-3 border-t-2 border-border pt-3">
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="font-display text-base font-bold text-foreground">{f.nome}</h4>
              {f.detalhe && <Celula valor={f.detalhe.percentuais.geral} negrito />}
            </div>
            {f.detalhe ? <CorpoAvaliacao av={f.detalhe} /> : <Falha id={f.id} />}
          </section>
        ))
      ) : (
        <CorpoAvaliacao av={av} />
      )}

      {av.observacoesEquipe.length > 0 && (
        <section className="space-y-2 border-t-2 border-border pt-3">
          <h4 className="font-display text-base font-bold text-foreground">Observações da equipe no mês</h4>
          {av.observacoesEquipe.map((o) => (
            <div key={o.id} className="break-inside-avoid rounded-md border border-border/60 p-2.5">
              <p className="text-[11px] text-muted">
                {formatarDiaIso(o.dataOcorrido)} · {o.areaNome} · {o.autorNome ?? "—"}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{o.texto}</p>
              <GradeFotos imagens={o.imagens} />
            </div>
          ))}
        </section>
      )}
    </article>
  );
}

export { Falha as FalhaAvaliacao };
