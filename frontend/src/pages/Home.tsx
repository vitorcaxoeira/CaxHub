import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { DashboardConsultor } from "../components/dashboard/DashboardConsultor";
import { MultiSelectDropdown } from "../components/ui/MultiSelectDropdown";
import { SelectBuscavel } from "../components/ui/SelectBuscavel";
import { MESES_OPCOES } from "../lib/periodos";

interface Integrante {
  codusu: number;
  nome: string;
}

interface DepartamentoGerenciado {
  depexe: number;
  depexeLabel: string;
  integrantes: Integrante[];
}

interface MeuPerfil {
  consultor: { codfor: number | null; nome: string; depexe: number; depexeLabel: string } | null;
  departamentosGerenciados: DepartamentoGerenciado[];
}

interface ConsultorFiltravel {
  codfor: number;
  nome: string;
}

function DepartamentosGerenciadosCard({ departamentos }: { departamentos: DepartamentoGerenciado[] }) {
  if (departamentos.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Departamentos que você gerencia
      </p>
      <div className="space-y-4">
        {departamentos.map((dep) => (
          <div key={dep.depexe} className="rounded-md border border-border/60 p-4">
            <h3 className="text-sm font-semibold text-foreground">{dep.depexeLabel}</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {dep.integrantes.map((integrante) => (
                <span key={integrante.codusu} className="rounded bg-muted/15 px-2 py-1 text-[12px] text-muted">
                  {integrante.nome}
                </span>
              ))}
              {dep.integrantes.length === 0 && <span className="text-[12px] text-muted">Sem integrantes cadastrados.</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Home() {
  const { user } = useAuth();
  const [perfil, setPerfil] = useState<MeuPerfil | null>(null);
  const [consultores, setConsultores] = useState<ConsultorFiltravel[]>([]);
  const [codforSelecionado, setCodforSelecionado] = useState<number | null>(null);

  const hoje = useMemo(() => new Date(), []);
  const [anos, setAnos] = useState<number[]>([hoje.getFullYear()]);
  const [meses, setMeses] = useState<number[]>([hoje.getMonth() + 1]);
  const [anosDisponiveis, setAnosDisponiveis] = useState<number[]>([]);

  useEffect(() => {
    axios
      .get("/api/dashboard/meu-perfil")
      .then(({ data }) => setPerfil(data))
      .catch(() => setPerfil(null));
  }, []);

  // Dashboard novo pra quem é consultor de execução puro: tem cadastro de Consultor, não
  // gerencia departamento nenhum e não é admin — pra esses, o painel é sempre o próprio, sem
  // filtro de consultor (só o de período, mais abaixo).
  const ehConsultorComum = user?.role !== "admin" && !!perfil?.consultor && perfil.departamentosGerenciados.length === 0;
  // Quem gerencia departamento (Líder Técnico) ou é admin ganha um filtro pra escolher QUAL
  // consultor ver — admin entre todos, gestor só entre o time (ver GET
  // /dashboard/consultores-filtraveis, mesma definição de "time" do apontamento manual).
  const podeFiltrarConsultor = user?.role === "admin" || (perfil?.departamentosGerenciados.length ?? 0) > 0;

  useEffect(() => {
    if (!podeFiltrarConsultor) return;
    axios
      .get("/api/dashboard/consultores-filtraveis")
      .then(({ data }) => setConsultores(data.consultores ?? []))
      .catch(() => setConsultores([]));
  }, [podeFiltrarConsultor]);

  // Default: gestor/admin caem no próprio painel primeiro (se tiverem cadastro de
  // Consultor) — só depois de `perfil` chegar é que dá pra saber qual é o próprio codfor.
  useEffect(() => {
    if (codforSelecionado == null && perfil?.consultor?.codfor != null) {
      setCodforSelecionado(perfil.consultor.codfor);
    }
  }, [perfil, codforSelecionado]);

  const mostraDashboard = ehConsultorComum || (podeFiltrarConsultor && consultores.length > 0);

  useEffect(() => {
    if (!mostraDashboard) return;
    axios
      .get("/api/dashboard/anos-com-dado", { params: { codfor: codforSelecionado ?? undefined } })
      .then(({ data }) => setAnosDisponiveis(data.anos ?? []))
      .catch(() => setAnosDisponiveis([]));
  }, [mostraDashboard, codforSelecionado]);

  // Mescla os anos com dado real com o que já está selecionado — um ano escolhido antes (ou
  // o ano corrente, default) não pode sumir da lista só porque ainda não tem apontamento
  // nenhum (mesmo padrão de `opcoesAnos` em ResultadoAnalitico.tsx).
  const opcoesAnos = useMemo(() => {
    const todos = [...new Set([...anosDisponiveis, ...anos])].sort((a, b) => b - a);
    return todos.map((ano) => ({ value: ano, label: String(ano) }));
  }, [anosDisponiveis, anos]);

  const nomeDoSelecionado = consultores.find((c) => c.codfor === codforSelecionado)?.nome;

  if (!mostraDashboard) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-border bg-surface p-8">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">CaxHub</p>
          <h1 className="mt-2 font-display text-2xl font-bold text-foreground">
            Bem-vindo{user ? `, ${user.nome}` : ""}
          </h1>
          {perfil?.consultor && (
            <p className="mt-1 text-sm text-muted">
              Você está cadastrado como consultor(a) em <span className="text-foreground">{perfil.consultor.depexeLabel}</span>.
            </p>
          )}
          <p className="mt-2 text-sm text-muted">Selecione uma opção no menu para começar.</p>
        </div>

        {perfil && <DepartamentosGerenciadosCard departamentos={perfil.departamentosGerenciados} />}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        {podeFiltrarConsultor && (
          <SelectBuscavel
            className="w-64"
            opcoes={consultores.map((c) => ({ value: c.codfor, grupo: "Consultores", rotulo: `${c.codfor} - ${c.nome}` }))}
            valor={codforSelecionado}
            onChange={setCodforSelecionado}
            placeholder="Selecione um consultor"
            textoVazio="Nenhum consultor disponível."
          />
        )}
        <MultiSelectDropdown opcoes={opcoesAnos} selecionados={anos} onChange={setAnos} labelTodos="Nenhum ano" labelSufixo="anos" />
        <MultiSelectDropdown opcoes={MESES_OPCOES} selecionados={meses} onChange={setMeses} labelTodos="Nenhum mês" labelSufixo="meses" />
      </div>

      {podeFiltrarConsultor && codforSelecionado == null ? (
        <p className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">Selecione um consultor para ver o painel.</p>
      ) : anos.length === 0 || meses.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">Selecione ao menos um ano e um mês.</p>
      ) : (
        <DashboardConsultor
          anos={anos}
          meses={meses}
          codfor={podeFiltrarConsultor ? codforSelecionado ?? undefined : undefined}
          nomeExibido={podeFiltrarConsultor ? nomeDoSelecionado : undefined}
        />
      )}

      {perfil && <DepartamentosGerenciadosCard departamentos={perfil.departamentosGerenciados} />}
    </div>
  );
}
