import { MemoriaDeCalculoDto, TomMemoria } from "../../lib/planoEvolucao";

const corDoTom: Record<TomMemoria, string> = {
  ok: "text-success",
  bad: "text-destructive",
  warn: "text-warning",
  off: "text-muted",
};

const dataHoraBr = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

// A memória de cálculo da devolutiva (item 11.3 do regulamento): cada requisito, o portão, o reforçador e o Valor Hora do Ciclo,
// a partir do registro congelado da apuração. O texto vem pronto do servidor (que já esconde os R$ de quem não pode ver),
// então a tela, o PDF e a impressão mostram exatamente a mesma coisa.
export function MemoriaCalculo({ memoria }: { memoria: MemoriaDeCalculoDto }) {
  return (
    <div className="space-y-5">
      {memoria.ensaio && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-foreground" role="status">
          <b>Simulação.</b> Ciclo anterior ao início do plano (01/01/2027): serve para conhecer o cálculo e não vale como resultado, não conta na sequência nem efetiva o valor.
        </p>
      )}
      <header>
        <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted">{memoria.titulo}</p>
        <h2 className="mt-0.5 font-display text-xl font-bold text-foreground">{memoria.consultor}</h2>
        <p className="text-[13px] text-muted">
          {memoria.ciclo} · {memoria.periodo} · apurado em {dataHoraBr(memoria.apuradoEm)}
        </p>
        <p className="mt-2 text-[15px] font-semibold text-foreground">{memoria.resumo}</p>
      </header>

      {memoria.secoes.map((s) => (
        <section key={s.titulo} className="break-inside-avoid">
          <h3 className="font-display text-[14px] font-semibold text-foreground">{s.titulo}</h3>
          {s.nota && <p className="mt-0.5 text-[12px] text-muted">{s.nota}</p>}
          <dl className="mt-2 divide-y divide-border/60 rounded-md border border-border">
            {s.linhas.map((l) => (
              <div key={l.rotulo} className="grid gap-x-4 gap-y-0.5 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <dt className="text-[13px] text-foreground">{l.rotulo}</dt>
                <dd className="text-[13px]">
                  <span className={`font-medium ${l.tom ? corDoTom[l.tom] : "text-foreground"}`}>{l.valor}</span>
                  {l.detalhe && <span className="block text-[12px] text-muted">{l.detalhe}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <p className="break-inside-avoid rounded-md border border-border bg-surface-2/60 px-3 py-2 text-[12.5px] text-muted">{memoria.formula}</p>
    </div>
  );
}
