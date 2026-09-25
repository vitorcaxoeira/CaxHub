import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAcesso5S } from "../../auth/Require5S";
import { TendenciaSeta } from "../../components/gestao5s/TendenciaSeta";
import { classeBotaoPrimario, classeCampo, classeRotulo } from "../../components/gestao5s/campos";
import { CORES_SERIE, LinhasMultiSerie } from "../../components/ui/LinhasMultiSerie";
import { Skeleton } from "../../components/ui/Skeleton";
import { Tabs } from "../../components/ui/Tabs";
import { cn } from "../../lib/cn";
import { mensagemDeErro } from "../../utils/gestao5s";
import { CELULA_TOM, PorSenso, SENSOS, Tendencia, TipoArea, formatarPerc, mesAtual, rotuloMes, somarMeses, tomDaNota } from "../../utils/gestao5s";

interface MesBloco {
  mes: string;
  quantidade?: number;
  geral: number | null;
  porSenso: PorSenso;
}

interface AreaResultado {
  areaId: number;
  nome: string;
  acumulado?: boolean;
  avaliacoes: number;
  geral: number | null;
  porSenso: PorSenso;
  meses: MesBloco[];
  tendencia: Tendencia;
}

interface Dashboard {
  tipo: TipoArea;
  de: string;
  ate: string;
  meses: string[];
  ranking: { posicao: number; areaId: number; nome: string; acumulado?: boolean; geral: number | null; tendencia: Tendencia }[];
  areas: AreaResultado[];
  empresa: { geral: number | null; porSenso: PorSenso; meses: MesBloco[]; tendencia: Tendencia };
}

function Celula({ valor, negrito = false }: { valor: number | null; negrito?: boolean }) {
  return (
    <span className={cn("inline-block min-w-12 rounded px-1.5 py-0.5 text-center font-mono text-xs tabular-nums", CELULA_TOM[tomDaNota(valor)], negrito && "font-bold")}>
      {formatarPerc(valor)}
    </span>
  );
}

function Kpi({ rotulo, valor, rodape, tom }: { rotulo: string; valor: string; rodape?: React.ReactNode; tom?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">{rotulo}</p>
      <p className={cn("mt-1 font-display text-2xl font-bold tabular-nums", tom ?? "text-foreground")}>{valor}</p>
      {rodape && <div className="mt-1 text-[12px] text-muted">{rodape}</div>}
    </div>
  );
}

const MEDALHA = ["🥇", "🥈", "🥉"];

// Dashboard de ranking do 5S: resultado geral, ranking por área, desempenho por senso (matriz) e
// evolução mensal. Só considera avaliações FINALIZADAS; a média do mês é a média das avaliações.
export function Dashboard5S() {
  const acesso = useAcesso5S();
  const navigate = useNavigate();
  const [tipo, setTipo] = useState<TipoArea>("setor");
  const [de, setDe] = useState(somarMeses(mesAtual(), -5));
  const [ate, setAte] = useState(mesAtual());
  const [dados, setDados] = useState<Dashboard | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [foco, setFoco] = useState("geral");

  useEffect(() => {
    if (de > ate) return;
    setLoading(true);
    axios
      .get<Dashboard>("/api/5s/dashboard", { params: { tipo, de, ate } })
      .then(({ data }) => {
        setDados(data);
        setErro(null);
      })
      .catch((err) => setErro(mensagemDeErro(err, "Falha ao carregar o dashboard")))
      .finally(() => setLoading(false));
  }, [tipo, de, ate]);

  useEffect(() => setFoco("geral"), [tipo]);

  const serieEvolucao = useMemo(() => {
    if (!dados) return [];
    if (foco === "geral") {
      return dados.areas.map((a, i) => ({ nome: a.nome, cor: CORES_SERIE[i % CORES_SERIE.length], valores: a.meses.map((m) => m.geral) }));
    }
    if (foco === "empresa") {
      return SENSOS.map((s, i) => ({ nome: s.curto, cor: CORES_SERIE[i], valores: dados.empresa.meses.map((m) => m.porSenso[s.chave]) }));
    }
    const area = dados.areas.find((a) => String(a.areaId) === foco);
    if (!area) return [];
    return SENSOS.map((s, i) => ({ nome: s.curto, cor: CORES_SERIE[i], valores: area.meses.map((m) => m.porSenso[s.chave]) }));
  }, [dados, foco]);

  const tituloEvolucao = foco === "geral" ? "Evolução mensal por área (resultado geral)" : foco === "empresa" ? "Evolução mensal por senso (média geral)" : `Evolução mensal por senso · ${dados?.areas.find((a) => String(a.areaId) === foco)?.nome ?? ""}`;

  const melhor = dados?.ranking[0];
  const pior = dados && dados.ranking.length > 1 ? dados.ranking[dados.ranking.length - 1] : null;
  const semDados = !!dados && dados.areas.length === 0;

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão 5S</p>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-foreground">Resultado geral 5S</h1>
        {acesso.pode.avaliar && (
          <Link to="/5s/nova" className={`${classeBotaoPrimario} min-h-10 leading-7`}>
            + Nova avaliação
          </Link>
        )}
      </div>

      <Tabs
        tabs={[
          { key: "setor", label: "Setores" },
          { key: "comum", label: "Ambientes comuns" },
        ]}
        activeKey={tipo}
        onChange={(k) => setTipo(k as TipoArea)}
      />

      <div className="mb-6 grid max-w-md grid-cols-2 gap-3">
        <div>
          <label className={classeRotulo}>De</label>
          <input type="month" className={classeCampo} value={de} max={ate} onChange={(e) => e.target.value && setDe(e.target.value)} />
        </div>
        <div>
          <label className={classeRotulo}>Até</label>
          <input type="month" className={classeCampo} value={ate} min={de} onChange={(e) => e.target.value && setAte(e.target.value)} />
        </div>
      </div>

      {erro && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{erro}</p>}
      {loading && !dados && <Skeleton className="h-64 w-full" />}

      {dados && semDados && (
        <p className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
          Nenhuma avaliação finalizada neste período. Os resultados aparecem quando uma avaliação é finalizada.
        </p>
      )}

      {dados && !semDados && (
        <div className={cn("space-y-6 transition-opacity", loading && "opacity-60")}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              rotulo={tipo === "setor" ? "Geral da empresa" : "Geral dos ambientes"}
              valor={formatarPerc(dados.empresa.geral, 1)}
              tom={CELULA_TOM[tomDaNota(dados.empresa.geral)].split(" ")[1]}
              rodape={<TendenciaSeta tendencia={dados.empresa.tendencia} comTexto />}
            />
            <Kpi rotulo="Melhor resultado" valor={formatarPerc(melhor?.geral ?? null, 1)} rodape={melhor?.nome} />
            <Kpi rotulo="Menor resultado" valor={pior ? formatarPerc(pior.geral, 1) : "—"} rodape={pior?.nome ?? "—"} />
            <Kpi rotulo="Avaliações no período" valor={String(dados.areas.reduce((a, x) => a + x.avaliacoes, 0))} rodape={`${dados.areas.length} ${tipo === "setor" ? "setor(es)" : "ambiente(s)"}`} />
          </div>

          <section className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6">
            <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-muted">🏆 Ranking por {tipo === "setor" ? "área" : "ambiente"}</p>
            <ol className="space-y-3">
              {dados.ranking.map((r) => (
                <li key={r.areaId}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm text-foreground">
                      <span className="mr-2 inline-block w-7 font-mono text-xs text-muted">{MEDALHA[r.posicao - 1] ?? `${r.posicao}º`}</span>
                      {r.nome}
                      {r.acumulado && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary" title="Soma das respostas dos ambientes vinculados">acumulado</span>}
                    </span>
                    <span className="flex flex-none items-center gap-2">
                      <TendenciaSeta tendencia={r.tendencia} />
                      <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{formatarPerc(r.geral, 1)}</span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(2, r.geral ?? 0)}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
            <p className="px-4 pt-4 font-mono text-[10px] uppercase tracking-widest text-muted sm:px-6 sm:pt-6">Desempenho por senso</p>
            <div className="overflow-x-auto p-2 sm:p-4">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    <th className="px-3 py-2">{tipo === "setor" ? "Área" : "Ambiente"}</th>
                    {SENSOS.map((s) => (
                      <th key={s.chave} className="px-2 py-2 text-center" title={s.rotulo}>
                        {s.curto}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-center">Geral</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.areas
                    .slice()
                    .sort((a, b) => (b.geral ?? -1) - (a.geral ?? -1))
                    .map((a) => (
                      <tr key={a.areaId} className="border-t border-border/60">
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-foreground">
                          {a.nome}
                          {a.acumulado && <span className="ml-2 text-[10px] text-primary">acumulado</span>}
                        </td>
                        {SENSOS.map((s) => (
                          <td key={s.chave} className="px-2 py-2 text-center">
                            <Celula valor={a.porSenso[s.chave]} />
                          </td>
                        ))}
                        <td className="px-2 py-2 text-center">
                          <Celula valor={a.geral} negrito />
                        </td>
                      </tr>
                    ))}
                  <tr className="border-t-2 border-border bg-surface-2">
                    <td className="px-3 py-2 text-sm font-semibold text-foreground">{tipo === "setor" ? "Média da empresa" : "Média geral"}</td>
                    {SENSOS.map((s) => (
                      <td key={s.chave} className="px-2 py-2 text-center">
                        <Celula valor={dados.empresa.porSenso[s.chave]} />
                      </td>
                    ))}
                    <td className="px-2 py-2 text-center">
                      <Celula valor={dados.empresa.geral} negrito />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <div>
            <div className="mb-3 max-w-sm">
              <label className={classeRotulo}>Ver evolução de</label>
              <select className={classeCampo} value={foco} onChange={(e) => setFoco(e.target.value)}>
                <option value="geral">Todas as áreas (resultado geral)</option>
                <option value="empresa">Média por senso</option>
                {dados.areas.map((a) => (
                  <option key={a.areaId} value={a.areaId}>
                    Por senso · {a.nome}
                  </option>
                ))}
              </select>
            </div>
            <LinhasMultiSerie titulo={tituloEvolucao} rotulos={dados.meses.map(rotuloMes)} series={serieEvolucao} descricao="Média das avaliações finalizadas no mês" />
          </div>

          <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
            <p className="px-4 pt-4 font-mono text-[10px] uppercase tracking-widest text-muted sm:px-6 sm:pt-6">Evolução mensal (%)</p>
            <div className="overflow-x-auto p-2 sm:p-4">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    <th className="px-3 py-2">{tipo === "setor" ? "Área" : "Ambiente"}</th>
                    {dados.meses.map((m) => (
                      <th key={m} className="px-2 py-2 text-center">
                        {rotuloMes(m)}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-center">Tendência</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.areas.map((a) => (
                    <tr key={a.areaId} className="border-t border-border/60">
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-foreground">{a.nome}</td>
                      {a.meses.map((m) => (
                        <td key={m.mes} className="px-2 py-2 text-center">
                          <Celula valor={m.geral} />
                        </td>
                      ))}
                      <td className="px-2 py-2 text-center">
                        <TendenciaSeta tendencia={a.tendencia} comTexto />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-[12px] text-muted">
            Veja o detalhe de cada avaliação em{" "}
            <button type="button" onClick={() => navigate("/5s/avaliacoes")} className="text-primary hover:underline">
              Avaliações
            </button>
            .
          </p>
        </div>
      )}
    </div>
  );
}
