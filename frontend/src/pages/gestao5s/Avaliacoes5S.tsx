import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TendenciaSeta } from "../../components/gestao5s/TendenciaSeta";
import { classeBotaoPrimario, classeCampo, classeRotulo } from "../../components/gestao5s/campos";
import { Pagination } from "../../components/ui/Pagination";
import { ListaServidor } from "../../components/colunas/ListaServidor";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";
import { campoParDatas } from "../../components/ui/padroesFiltros/campos";
import { regras } from "../../components/ui/padroesFiltros/regras";
import { usePadroesTela } from "../../components/ui/padroesFiltros/usePadroesTela";
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
  quantidadeAmbientes: number;
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

// Histórico com filtro e ordem por coluna, colunas configuráveis, resumo no rodapé e colunas calculadas (ListaServidor + lista em memória no
// servidor, 03/11/2026). O recorte de quem vê o quê continua no servidor.
const COLUNAS_AVALIACOES: DefColuna<Linha>[] = [
  { nome: "data", titulo: "Data", fixa: true, largura: 100, classe: "text-sm text-foreground", render: (a) => formatarDiaIso(a.data) },
  {
    nome: "areaNome",
    titulo: "Setor / ambiente",
    largura: 240,
    classe: "text-sm font-medium text-foreground",
    texto: (a) => a.areaNome,
    render: (a) => (
      <>
        {a.areaNome}
        {a.quantidadeAmbientes > 0 && <span className="ml-2 text-[11px] font-normal text-muted">{a.quantidadeAmbientes} ambientes</span>}
      </>
    ),
  },
  { nome: "avaliadorNome", titulo: "Avaliador", largura: 160, classe: "text-sm text-muted", render: (a) => a.avaliadorNome ?? "—" },
  { nome: "quantidadeAmbientes", ocultaPorPadrao: true, titulo: "Ambientes", direita: true, largura: 90, classe: "text-sm tabular-nums text-muted", render: (a) => a.quantidadeAmbientes },
  { nome: "percGeral", titulo: "Geral", centro: true, largura: 90, formatarResumo: (v) => formatarPerc(v), render: (a) => <CelulaPerc valor={a.percentuais.geral} /> },
  ...SENSOS.map(
    (s): DefColuna<Linha> => ({
      nome: `perc${s.nome}`,
      titulo: s.curto,
      dica: s.rotulo,
      centro: true,
      largura: 100,
      formatarResumo: (v) => formatarPerc(v),
      render: (a) => <CelulaPerc valor={a.percentuais.porSenso[s.chave]} />,
    })
  ),
  {
    nome: "situacao",
    titulo: "Situação",
    largura: 120,
    render: (a) => (
      <span className={`text-xs ${a.status === "finalizada" ? "text-success" : "text-warning"}`}>{a.status === "finalizada" ? "Finalizada" : "Em andamento"}</span>
    ),
  },
];

function Historico({ areas, ehLider }: { areas: AreaOpcao[]; ehLider: boolean }) {
  const navigate = useNavigate();
  const [filtros, setFiltros] = useState({ areaId: "", status: "", de: "", ate: "" });
  // Padrão de cada filtro (estrela, 03/11/2026): aplicado uma vez ao abrir, antes da 1ª consulta. O setor só confere o formato (as áreas
  // chegam pela tela de cima); setor que não existir mais simplesmente não traz avaliação.
  const p = usePadroesTela({
    tela: "gestao5s.avaliacoes",
    campos: {
      areaId: { rotulo: "Setor / ambiente", atual: filtros.areaId, aplicar: (v: string) => setFiltros((f) => ({ ...f, areaId: v })), validar: regras.texto(), semOpcoes: true },
      status: {
        rotulo: "Situação",
        atual: filtros.status,
        aplicar: (v: string) => setFiltros((f) => ({ ...f, status: v })),
        validar: (v: unknown) => (v === "" || v === "em_andamento" || v === "finalizada" ? { ok: true as const, valor: v as string } : { ok: false as const }),
        semOpcoes: true,
      },
      periodo: campoParDatas("Período", filtros.de || null, filtros.ate || null, (de, ate) => setFiltros((f) => ({ ...f, de: de ?? "", ate: ate ?? "" }))),
    },
  });



  function mudar(campo: keyof typeof filtros, valor: string) {
    setFiltros((f) => ({ ...f, [campo]: valor }));
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="relative col-span-2 md:col-span-1">
          {p.estrela("areaId")}
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
          <div className="relative">
            {p.estrela("status")}
            <label className={classeRotulo}>Situação</label>
            <select className={classeCampo} value={filtros.status} onChange={(e) => mudar("status", e.target.value)}>
              <option value="">Todas</option>
              <option value="em_andamento">Em andamento</option>
              <option value="finalizada">Finalizadas</option>
            </select>
          </div>
        )}
        <div className="relative">
          {p.estrela("periodo")}
          <label className={classeRotulo}>De</label>
          <input type="date" className={classeCampo} value={filtros.de} onChange={(e) => mudar("de", e.target.value)} />
        </div>
        <div>
          <label className={classeRotulo}>Até</label>
          <input type="date" className={classeCampo} value={filtros.ate} onChange={(e) => mudar("ate", e.target.value)} />
        </div>
      </div>

      {p.pronto && (
        <ListaServidor<Linha>
          chave="gestao5s.avaliacoes"
          url="/api/5s/avaliacoes"
          params={Object.fromEntries(Object.entries(filtros).filter(([, v]) => v))}
          defs={COLUNAS_AVALIACOES}
          chaveLinha={(a) => String(a.id)}
          onLinha={(a) => navigate(`/5s/avaliacoes/${a.id}`)}
          rotulo="avaliações"
          vazio="Nenhuma avaliação encontrada."
          pageSize={20}
          opcoesPorPagina={[20, 50, 100, 200]}
        />
      )}
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
