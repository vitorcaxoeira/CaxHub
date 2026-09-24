import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TendenciaSeta } from "../../components/gestao5s/TendenciaSeta";
import { classeBotaoPrimario, classeCampo, classeRotulo } from "../../components/gestao5s/campos";
import { Pagination } from "../../components/ui/Pagination";
import { Skeleton } from "../../components/ui/Skeleton";
import { Tabs } from "../../components/ui/Tabs";
import { cn } from "../../lib/cn";
import { mensagemDeErro } from "../../utils/gestao5s";
import { useAcesso5S } from "../../auth/Require5S";
import {
  CELULA_TOM,
  Percentuais,
  SENSOS,
  Tendencia,
  TipoArea,
  formatarDiaIso,
  formatarPerc,
  mesAtual,
  rotuloMes,
  somarMeses,
  tendenciaEntre,
  tomDaNota,
} from "../../utils/gestao5s";

interface AreaOpcao {
  id: number;
  nome: string;
  tipo: TipoArea;
}

interface Linha {
  id: number;
  titulo: string;
  areaNome: string;
  areaTipo: TipoArea;
  avaliadorNome: string | null;
  data: string;
  status: "em_andamento" | "finalizada";
  percentuais: Percentuais;
}

interface Comparativo {
  meses: string[];
  linhas: { chave: string; rotulo: string; valores: Array<number | null> }[];
}

function CelulaPerc({ valor }: { valor: number | null }) {
  return <span className={cn("inline-block min-w-12 rounded px-1.5 py-0.5 text-center font-mono text-xs tabular-nums", CELULA_TOM[tomDaNota(valor)])}>{formatarPerc(valor)}</span>;
}

// Histórico das avaliações (com filtros) e comparativo mensal por senso.
export function Avaliacoes5S() {
  const [aba, setAba] = useState<"historico" | "comparativo">("historico");
  const acesso = useAcesso5S();
  const [areas, setAreas] = useState<AreaOpcao[]>([]);

  useEffect(() => {
    axios.get<AreaOpcao[]>("/api/5s/areas").then(({ data }) => setAreas(data)).catch(() => {});
  }, []);

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão 5S</p>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-foreground">Avaliações</h1>
        {acesso.pode.avaliar && (
          <Link to="/5s/nova" className={`${classeBotaoPrimario} min-h-10 leading-7`}>
            + Nova avaliação
          </Link>
        )}
      </div>
      <Tabs
        tabs={[
          { key: "historico", label: "Histórico" },
          { key: "comparativo", label: "Comparativo mensal" },
        ]}
        activeKey={aba}
        onChange={(k) => setAba(k as typeof aba)}
      />
      {aba === "historico" ? <Historico areas={areas} ehLider={acesso.papel === "lider"} /> : <ComparativoMensal areas={areas} />}
    </div>
  );
}

function Historico({ areas, ehLider }: { areas: AreaOpcao[]; ehLider: boolean }) {
  const navigate = useNavigate();
  const [filtros, setFiltros] = useState({ areaId: "", status: "", de: "", ate: "" });
  const [page, setPage] = useState(1);
  const [dados, setDados] = useState<{ total: number; itens: Linha[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pageSize = 20;

  useEffect(() => {
    setLoading(true);
    axios
      .get<{ total: number; itens: Linha[] }>("/api/5s/avaliacoes", {
        params: { ...Object.fromEntries(Object.entries(filtros).filter(([, v]) => v)), page, pageSize },
      })
      .then(({ data }) => {
        setDados(data);
        setErro(null);
      })
      .catch((err) => setErro(mensagemDeErro(err, "Falha ao carregar as avaliações")))
      .finally(() => setLoading(false));
  }, [filtros, page]);

  function mudar(campo: keyof typeof filtros, valor: string) {
    setFiltros((f) => ({ ...f, [campo]: valor }));
    setPage(1);
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="col-span-2 md:col-span-1">
          <label className={classeRotulo}>Setor / ambiente</label>
          <select className={classeCampo} value={filtros.areaId} onChange={(e) => mudar("areaId", e.target.value)}>
            <option value="">Todos</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </div>
        {!ehLider && (
          <div>
            <label className={classeRotulo}>Situação</label>
            <select className={classeCampo} value={filtros.status} onChange={(e) => mudar("status", e.target.value)}>
              <option value="">Todas</option>
              <option value="em_andamento">Em andamento</option>
              <option value="finalizada">Finalizadas</option>
            </select>
          </div>
        )}
        <div>
          <label className={classeRotulo}>De</label>
          <input type="date" className={classeCampo} value={filtros.de} onChange={(e) => mudar("de", e.target.value)} />
        </div>
        <div>
          <label className={classeRotulo}>Até</label>
          <input type="date" className={classeCampo} value={filtros.ate} onChange={(e) => mudar("ate", e.target.value)} />
        </div>
      </div>

      {erro && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{erro}</p>}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-surface-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Setor / ambiente</th>
                <th className="hidden px-4 py-3 md:table-cell">Avaliador</th>
                <th className="px-4 py-3 text-center">Geral</th>
                {SENSOS.map((s) => (
                  <th key={s.chave} className="hidden px-3 py-3 text-center xl:table-cell" title={s.rotulo}>
                    {s.curto}
                  </th>
                ))}
                <th className="hidden px-4 py-3 sm:table-cell">Situação</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td colSpan={5} className="px-4 py-3">
                      <Skeleton className="h-5 w-full" />
                    </td>
                  </tr>
                ))}
              {!loading && dados?.itens.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-sm text-muted">
                    Nenhuma avaliação encontrada.
                  </td>
                </tr>
              )}
              {!loading &&
                dados?.itens.map((a) => (
                  <tr key={a.id} onClick={() => navigate(`/5s/avaliacoes/${a.id}`)} className="cursor-pointer border-t border-border/60 transition hover:bg-surface-2">
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-foreground">{formatarDiaIso(a.data)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-foreground">{a.areaNome}</td>
                    <td className="hidden px-4 py-3 text-sm text-muted md:table-cell">{a.avaliadorNome ?? "—"}</td>
                    <td className="px-4 py-3 text-center">
                      <CelulaPerc valor={a.percentuais.geral} />
                    </td>
                    {SENSOS.map((s) => (
                      <td key={s.chave} className="hidden px-3 py-3 text-center xl:table-cell">
                        <CelulaPerc valor={a.percentuais.porSenso[s.chave]} />
                      </td>
                    ))}
                    <td className="hidden px-4 py-3 text-xs sm:table-cell">
                      <span className={a.status === "finalizada" ? "text-success" : "text-warning"}>{a.status === "finalizada" ? "Finalizada" : "Em andamento"}</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={dados?.total ?? 0} loading={loading} onPageChange={setPage} label="avaliações" />
      </div>
    </>
  );
}

function ComparativoMensal({ areas }: { areas: AreaOpcao[] }) {
  const atual = mesAtual();
  const opcoesMes = useMemo(() => Array.from({ length: 12 }, (_, i) => somarMeses(atual, -i)), [atual]);
  const [meses, setMeses] = useState<string[]>([somarMeses(atual, -1), atual]);
  const [tipo, setTipo] = useState<TipoArea>("setor");
  const [areaId, setAreaId] = useState("");
  const [dados, setDados] = useState<Comparativo | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (meses.length < 2) {
      setDados(null);
      return;
    }
    axios
      .get<Comparativo>("/api/5s/comparativo", { params: { meses: meses.join(","), tipo, ...(areaId ? { areaId } : {}) } })
      .then(({ data }) => {
        setDados(data);
        setErro(null);
      })
      .catch((err) => setErro(mensagemDeErro(err, "Falha ao carregar o comparativo")));
  }, [meses, tipo, areaId]);

  function alternarMes(m: string) {
    setMeses((atuais) => (atuais.includes(m) ? atuais.filter((x) => x !== m) : [...atuais, m].sort()));
  }

  const areasDoTipo = areas.filter((a) => a.tipo === tipo);

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={classeRotulo}>Tipo</label>
          <select
            className={classeCampo}
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value as TipoArea);
              setAreaId("");
            }}
          >
            <option value="setor">Setores</option>
            <option value="comum">Ambientes comuns</option>
          </select>
        </div>
        <div>
          <label className={classeRotulo}>Área</label>
          <select className={classeCampo} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            <option value="">Todas (média)</option>
            {areasDoTipo.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className={classeRotulo}>Meses a comparar (escolha 2 ou mais)</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {opcoesMes.map((m) => {
          const ativo = meses.includes(m);
          return (
            <button
              key={m}
              type="button"
              aria-pressed={ativo}
              onClick={() => alternarMes(m)}
              className={cn("min-h-9 rounded-md border px-3 text-xs font-medium transition", ativo ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted hover:bg-surface-2")}
            >
              {rotuloMes(m)}
            </button>
          );
        })}
      </div>

      {erro && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{erro}</p>}
      {meses.length < 2 && <p className="text-sm text-muted">Selecione pelo menos dois meses.</p>}

      {dados && (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-surface-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  <th className="px-4 py-3">Senso</th>
                  {dados.meses.map((m) => (
                    <th key={m} className="px-4 py-3 text-center">
                      {rotuloMes(m)}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center">Evolução</th>
                </tr>
              </thead>
              <tbody>
                {dados.linhas.map((l) => {
                  const t: Tendencia = tendenciaEntre(l.valores);
                  return (
                    <tr key={l.chave} className={cn("border-t border-border/60", l.chave === "geral" && "bg-surface-2 font-semibold")}>
                      <td className="px-4 py-3 text-sm text-foreground">{l.rotulo}</td>
                      {l.valores.map((v, i) => (
                        <td key={i} className="px-4 py-3 text-center">
                          <CelulaPerc valor={v} />
                        </td>
                      ))}
                      <td className="px-4 py-3 text-center">
                        <TendenciaSeta tendencia={t} comTexto />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
