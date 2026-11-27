import axios from "axios";
import { useEffect, useState } from "react";
import { MultiSelectDropdown, MultiSelectOption } from "../../components/ui/MultiSelectDropdown";
import { Skeleton } from "../../components/ui/Skeleton";

interface DepartamentoRow {
  codemp: number;
  depexe: number;
  depexeLabel: string;
  gestorNome: string | null;
  times: string[];
  labels: string[];
}

interface RespostaDepartamentos {
  departamentos: DepartamentoRow[];
  timesDisponiveis: MultiSelectOption<string>[];
  labelsDisponiveis: MultiSelectOption<string>[];
  gruposHabilitados: number;
}

// Tela de administração da tabela DepartamentoTimeKyria (100% nativa do CaxHub, nunca sincronizada)
// — liga cada departamento aos times do Kyria cujo atendimento ele representa. É a "Categoria" do
// sistema de chamados anterior na rentabilidade: o time do TICKET diz de qual departamento são as horas de suporte.
// Mesmo molde de Departamento x Grupo Contábil (pages/admin/DepartamentoGrupoContabil.tsx).
export function DepartamentoTimeKyria() {
  const [departamentos, setDepartamentos] = useState<DepartamentoRow[]>([]);
  const [timesDisponiveis, setTimesDisponiveis] = useState<MultiSelectOption<string>[]>([]);
  const [labelsDisponiveis, setLabelsDisponiveis] = useState<MultiSelectOption<string>[]>([]);
  const [gruposHabilitados, setGruposHabilitados] = useState(0);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Chave "codemp-depexe" da linha sendo salva — desabilita o dropdown dela só, sem travar a tela inteira.
  const [salvando, setSalvando] = useState<string | null>(null);

  function carregar() {
    setLoading(true);
    axios
      .get<RespostaDepartamentos>("/api/sync-kyria/departamentos-times")
      .then(({ data }) => {
        setDepartamentos(data.departamentos);
        setTimesDisponiveis(data.timesDisponiveis);
        setLabelsDisponiveis(data.labelsDisponiveis);
        setGruposHabilitados(data.gruposHabilitados);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar departamentos"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    carregar();
  }, []);

  function salvarTimes(row: DepartamentoRow, novosTimes: string[]) {
    const chave = `${row.codemp}-${row.depexe}`;
    const anteriores = row.times;
    // Otimista: atualiza a tela antes da resposta do servidor, desfaz se der erro.
    setDepartamentos((atual) => atual.map((d) => (d.codemp === row.codemp && d.depexe === row.depexe ? { ...d, times: novosTimes } : d)));
    setSalvando(chave);
    axios
      .put(`/api/sync-kyria/departamentos-times/${row.codemp}/${row.depexe}`, { timeIds: novosTimes })
      .catch((err) => {
        setErro(err.response?.data?.error ?? "Falha ao salvar times do departamento");
        setDepartamentos((atual) => atual.map((d) => (d.codemp === row.codemp && d.depexe === row.depexe ? { ...d, times: anteriores } : d)));
      })
      .finally(() => setSalvando((atual) => (atual === chave ? null : atual)));
  }

  // Mesma ideia de salvarTimes, para as etiquetas do departamento (filtro dos tickets da análise).
  function salvarLabels(row: DepartamentoRow, novas: string[]) {
    const chave = `${row.codemp}-${row.depexe}-labels`;
    const anteriores = row.labels;
    setDepartamentos((atual) => atual.map((d) => (d.codemp === row.codemp && d.depexe === row.depexe ? { ...d, labels: novas } : d)));
    setSalvando(chave);
    axios
      .put(`/api/sync-kyria/departamentos-times/${row.codemp}/${row.depexe}/labels`, { labelIds: novas })
      .catch((err) => {
        setErro(err.response?.data?.error ?? "Falha ao salvar etiquetas do departamento");
        setDepartamentos((atual) => atual.map((d) => (d.codemp === row.codemp && d.depexe === row.depexe ? { ...d, labels: anteriores } : d)));
      })
      .finally(() => setSalvando((atual) => (atual === chave ? null : atual)));
  }

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Administração · Integração Kyria · Departamento x Time</p>

      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-foreground">Departamento x Time Kyria</h1>
      </div>

      <p className="mb-6 max-w-2xl text-sm text-muted">
        Define de qual departamento são as horas de suporte de cada time do Kyria (o time do ticket). Substitui a "Categoria" do sistema de
        chamados anterior na rentabilidade. Um departamento pode ter vários times, e um time pode servir a mais de um departamento — as horas de um time ligado a dois
        departamentos entram nos dois. Ao lado de cada time vão as horas apontadas nos últimos 12 meses, pra ajudar a decidir.
      </p>
      <p className="mb-6 max-w-2xl text-sm text-muted">
        As <b>etiquetas</b> definem quais tickets entram na análise do departamento. Aparecem todas as etiquetas dos grupos de etiqueta marcados com{" "}
        <span className="font-mono">fitro_dep_time = Sim</span> (marque o grupo em Integração Kyria › Sincronização › Grupos de Etiqueta › Ver dados).
      </p>
      {!loading && !erro && gruposHabilitados === 0 && (
        <p className="mb-4 rounded-md border border-border bg-surface-2 px-4 py-2.5 text-sm text-muted">
          Nenhum grupo de etiqueta está marcado com fitro_dep_time = Sim, então não há etiqueta para escolher.
        </p>
      )}

      {erro && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{erro}</p>}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Departamento</th>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Gestor</th>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Times do Kyria</th>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Etiquetas (filtro dos tickets)</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-5 py-3.5">
                      <Skeleton className="h-4 w-32" />
                    </td>
                    <td className="px-5 py-3.5">
                      <Skeleton className="h-4 w-40" />
                    </td>
                    <td className="px-5 py-3.5">
                      <Skeleton className="h-8 w-56" />
                    </td>
                    <td className="px-5 py-3.5">
                      <Skeleton className="h-8 w-56" />
                    </td>
                  </tr>
                ))}

              {!loading && departamentos.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-6 text-center text-sm text-muted">
                    Nenhum departamento com gestor cadastrado (DepartamentoGestor).
                  </td>
                </tr>
              )}

              {!loading &&
                departamentos.map((row) => {
                  const chave = `${row.codemp}-${row.depexe}`;
                  return (
                    <tr key={chave} className="border-t border-border/60 transition hover:bg-surface-2">
                      <td className="px-5 py-3.5 text-sm font-semibold text-foreground">{row.depexeLabel}</td>
                      <td className="px-5 py-3.5 text-sm text-muted">{row.gestorNome ?? "—"}</td>
                      <td className="px-5 py-3.5">
                        <MultiSelectDropdown
                          opcoes={timesDisponiveis}
                          selecionados={row.times}
                          onChange={(novos) => salvarTimes(row, novos)}
                          labelTodos="Nenhum time"
                          labelSufixo="times"
                        />
                        {salvando === chave && <span className="ml-2 text-[11px] text-muted">salvando...</span>}
                      </td>
                      <td className="px-5 py-3.5">
                        <MultiSelectDropdown
                          opcoes={labelsDisponiveis}
                          selecionados={row.labels}
                          onChange={(novas) => salvarLabels(row, novas)}
                          labelTodos="Nenhuma etiqueta"
                          labelSufixo="etiquetas"
                          gruposRecolhiveis
                        />
                        {salvando === `${chave}-labels` && <span className="ml-2 text-[11px] text-muted">salvando...</span>}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
