import axios from "axios";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { GradeDoMes, Legenda, ModalDia, SaldoDeFerias, horas, useCalendarioMes } from "../../components/calendario/pecas";
import { SelectBuscavel } from "../../components/ui/SelectBuscavel";
import { useToast } from "../../components/ui/Toast";
import { cn } from "../../lib/cn";
import { MESES } from "../../lib/feriasCalendario";

interface ConsultorOpcao {
  codemp: number;
  codfor: number;
  nome: string;
  depexeLabel: string | null;
}

// Calendário de trabalho do consultor (13/11/2026): cada dia mostra a meta, as horas apontadas, as férias (lançadas pelo gestor na tela Férias) e as folgas
// que o consultor lança sozinho (dia inteiro ou parte do dia). Férias e folgas saem da meta do "Progresso da meta" da Home. O gestor e o admin veem e mexem
// no calendário de quem é do time.
export function Calendario() {
  const toast = useToast();
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [consultores, setConsultores] = useState<ConsultorOpcao[]>([]);
  const [codfor, setCodfor] = useState<number | null>(null);
  const [diaAberto, setDiaAberto] = useState<string | null>(null);
  const { dados, semConsultor, loading, erro, feriados, recarregar } = useCalendarioMes(ano, mes, codfor);

  // Quem eu posso ver: o próprio (consultor comum) ou o time (gestor/admin) — mesma lista da Meta diária.
  useEffect(() => {
    axios
      .get("/api/jornadas/consultores")
      .then(({ data }) => setConsultores(data.consultores))
      .catch(() => undefined);
  }, []);

  function mudarMes(delta: number) {
    const d = new Date(ano, mes - 1 + delta, 1);
    setAno(d.getFullYear());
    setMes(d.getMonth() + 1);
  }

  const diaSelecionado = dados?.dias.find((d) => d.data === diaAberto) ?? null;

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Gestão de Projetos · Calendário</p>
      <h1 className="mt-1 font-display text-2xl font-bold text-foreground">Calendário de trabalho</h1>
      <p className="mt-1 text-sm text-muted">
        As férias lançadas pelo gestor e as folgas que você marca aqui (dia inteiro ou parte do dia) saem da meta do "Progresso da meta". Clique num dia para
        marcar ou remover uma folga.
      </p>

      {erro && <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {(consultores.length > 1 || semConsultor) && (
          <SelectBuscavel
            opcoes={consultores.map((c) => ({ value: c.codfor, grupo: c.depexeLabel ?? "Sem departamento", rotulo: c.nome }))}
            valor={codfor ?? dados?.consultor.codfor ?? null}
            onChange={setCodfor}
            placeholder="Escolha o consultor..."
            textoVazio="Nenhum consultor disponível"
            className="w-72"
          />
        )}
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => mudarMes(-1)} aria-label="Mês anterior" className="rounded-md border border-border p-1.5 text-muted hover:bg-surface-2 hover:text-foreground">
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-36 text-center font-display text-base font-semibold text-foreground">
            {MESES[mes - 1]} {ano}
          </span>
          <button type="button" onClick={() => mudarMes(1)} aria-label="Próximo mês" className="rounded-md border border-border p-1.5 text-muted hover:bg-surface-2 hover:text-foreground">
            <ChevronRight size={16} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setAno(hoje.getFullYear());
            setMes(hoje.getMonth() + 1);
          }}
          className="rounded-md border border-border px-3 py-1.5 text-[12.5px] text-muted hover:bg-surface-2 hover:text-foreground"
        >
          Hoje
        </button>
        {dados && <span className="text-sm text-muted">{dados.consultor.nome}</span>}
      </div>

      {semConsultor && !loading && (
        <p className="mt-4 rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted">
          {consultores.length > 0
            ? "Seu usuário não tem cadastro de consultor: escolha acima o consultor cujo calendário você quer ver."
            : "Seu usuário não tem cadastro de consultor: não há calendário de trabalho para mostrar."}
        </p>
      )}

      {dados && (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Resumo rotulo="Meta do mês" valor={horas(dados.totais.metaMinutos)} />
          <Resumo rotulo="Apontado" valor={horas(dados.totais.apontadoMinutos)} />
          <Resumo rotulo="Férias (fora da meta)" valor={horas(dados.totais.abonadoFeriasMinutos)} tom="info" />
          <Resumo rotulo="Folgas (fora da meta)" valor={horas(dados.totais.abonadoFolgaMinutos)} tom="warning" />
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <GradeDoMes dados={dados} loading={loading} feriados={feriados} onDia={setDiaAberto} />

        <aside className="space-y-3">
          <SaldoDeFerias saldos={dados?.saldos ?? []} />
          <Legenda />
        </aside>
      </div>

      {diaSelecionado && dados && (
        <ModalDia
          dia={diaSelecionado}
          dados={dados}
          feriado={feriados[diaSelecionado.data]}
          onFechar={() => setDiaAberto(null)}
          onMudou={recarregar}
          toast={toast.mostrar}
        />
      )}
    </div>
  );
}

function Resumo({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: "info" | "warning" }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="text-[11px] text-muted">{rotulo}</p>
      <p className={cn("font-mono text-lg font-semibold", tom === "info" ? "text-primary" : tom === "warning" ? "text-warning" : "text-foreground")}>{valor}</p>
    </div>
  );
}
