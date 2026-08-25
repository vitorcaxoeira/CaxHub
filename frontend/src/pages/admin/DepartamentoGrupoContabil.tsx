import axios from "axios";
import { useEffect, useState } from "react";
import { MultiSelectDropdown, MultiSelectOption } from "../../components/ui/MultiSelectDropdown";
import { Skeleton } from "../../components/ui/Skeleton";

interface DepartamentoRow {
  codemp: number;
  depexe: number;
  depexeLabel: string;
  gestorNome: string | null;
  grupos: string[];
}

interface RespostaDepartamentos {
  departamentos: DepartamentoRow[];
  gruposDisponiveis: MultiSelectOption<string>[];
}

// Tela de administração da tabela DepartamentoGrupoContabil (100% nativa do CaxHub, nunca
// sincronizada do Senior) — liga cada departamento aos grupos contábeis (PlanoContabil.despar)
// que ele representa, pro RBAC do módulo Contábil por gestor de departamento (ver
// backend/src/routes/contabil.ts, gruposPermitidos). Nasceu semeada por migration a partir do
// mapeamento confirmado em 12/08/2026 (ex.: ADM->Administrativo, COM->Comercial); daqui em
// diante é editada só por aqui, sem precisar de deploy pra corrigir/estender.
export function DepartamentoGrupoContabil() {
  const [departamentos, setDepartamentos] = useState<DepartamentoRow[]>([]);
  const [gruposDisponiveis, setGruposDisponiveis] = useState<MultiSelectOption<string>[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Chave "codemp-depexe" da linha sendo salva — desabilita o dropdown dela só, sem travar a
  // tela inteira.
  const [salvando, setSalvando] = useState<string | null>(null);

  function carregar() {
    setLoading(true);
    axios
      .get<RespostaDepartamentos>("/api/contabil/departamentos-grupos")
      .then(({ data }) => {
        setDepartamentos(data.departamentos);
        setGruposDisponiveis(data.gruposDisponiveis);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar departamentos"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    carregar();
  }, []);

  function salvarGrupos(row: DepartamentoRow, novosGrupos: string[]) {
    const chave = `${row.codemp}-${row.depexe}`;
    const anteriores = row.grupos;
    // Otimista: atualiza a tela antes da resposta do servidor, desfaz se der erro.
    setDepartamentos((atual) => atual.map((d) => (d.codemp === row.codemp && d.depexe === row.depexe ? { ...d, grupos: novosGrupos } : d)));
    setSalvando(chave);
    axios
      .put(`/api/contabil/departamentos-grupos/${row.codemp}/${row.depexe}`, { despares: novosGrupos })
      .catch((err) => {
        setErro(err.response?.data?.error ?? "Falha ao salvar grupos do departamento");
        setDepartamentos((atual) =>
          atual.map((d) => (d.codemp === row.codemp && d.depexe === row.depexe ? { ...d, grupos: anteriores } : d))
        );
      })
      .finally(() => setSalvando((atual) => (atual === chave ? null : atual)));
  }

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Administração · Departamento x Grupo Contábil
      </p>

      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-foreground">Departamento x Grupo Contábil</h1>
      </div>

      <p className="mb-6 max-w-2xl text-sm text-muted">
        Define quais grupos contábeis (Conta Paralela) cada departamento representa. É o que decide o que um gestor
        de departamento vê no filtro de grupos do Contábil (Resultado Analítico) — quem não gerencia nenhum
        departamento com grupo configurado aqui não acessa a tela.
      </p>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{erro}</p>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Departamento
                </th>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Gestor
                </th>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Grupos Contábeis
                </th>
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
                  </tr>
                ))}

              {!loading && departamentos.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-6 text-center text-sm text-muted">
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
                          opcoes={gruposDisponiveis}
                          selecionados={row.grupos}
                          onChange={(novos) => salvarGrupos(row, novos)}
                          labelTodos="Nenhum grupo"
                          labelSufixo="grupos"
                        />
                        {salvando === chave && <span className="ml-2 text-[11px] text-muted">salvando...</span>}
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
