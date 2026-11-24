import axios from "axios";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAcesso5S } from "../../auth/Require5S";
import { classeBotaoPrimario, classeBotaoSecundario, classeCampo, classeRotulo } from "../../components/gestao5s/campos";
import { DashboardResultado, DesempenhoPorSenso, EvolucaoMensalTabela, KpisResultado, RankingResultado } from "../../components/gestao5s/ResultadoSecoes";
import { CORES_SERIE, LinhasMultiSerie } from "../../components/ui/LinhasMultiSerie";
import { DropdownMenu } from "../../components/ui/DropdownMenu";
import { Skeleton } from "../../components/ui/Skeleton";
import { Tabs } from "../../components/ui/Tabs";
import { cn } from "../../lib/cn";
import { mensagemDeErro } from "../../utils/gestao5s";
import { ModoImpressao5S, SENSOS, TipoArea, mesAtual, rotuloMes, somarMeses } from "../../utils/gestao5s";

// Dashboard de ranking do 5S: resultado geral, ranking por área, desempenho por senso (matriz) e
// evolução mensal. Só considera avaliações FINALIZADAS; a média do mês é a média das avaliações.
export function Dashboard5S() {
  const acesso = useAcesso5S();
  const navigate = useNavigate();
  const [tipo, setTipo] = useState<TipoArea>("setor");
  const [de, setDe] = useState(somarMeses(mesAtual(), -5));
  const [ate, setAte] = useState(mesAtual());
  const [dados, setDados] = useState<DashboardResultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [foco, setFoco] = useState("geral");
  // O "Até" inicial é o último mês com avaliação que o perfil logado enxerga (por aba). Enquanto
  // não chega, o dashboard não carrega — evita buscar o mês corrente e já trocar em seguida. Depois
  // que o usuário mexe no período, trocar de aba não sobrescreve mais a escolha dele.
  const [periodoPronto, setPeriodoPronto] = useState(false);
  const periodoManual = useRef(false);

  useEffect(() => {
    if (periodoManual.current) {
      setPeriodoPronto(true);
      return;
    }
    let cancelado = false;
    axios
      .get<{ mes: string | null }>("/api/5s/ultimo-mes", { params: { tipo } })
      .then(({ data }) => {
        if (cancelado) return;
        const fim = data.mes ?? mesAtual();
        setAte(fim);
        setDe(somarMeses(fim, -5));
      })
      .catch(() => {})
      .finally(() => !cancelado && setPeriodoPronto(true));
    return () => {
      cancelado = true;
    };
  }, [tipo]);

  function trocarTipo(novo: TipoArea) {
    if (!periodoManual.current) {
      setPeriodoPronto(false);
      setLoading(true);
    }
    setTipo(novo);
  }

  function mudarPeriodo(campo: "de" | "ate", valor: string) {
    if (!valor) return;
    periodoManual.current = true;
    if (campo === "de") setDe(valor);
    else setAte(valor);
  }

  useEffect(() => {
    if (!periodoPronto || de > ate) return;
    setLoading(true);
    axios
      .get<DashboardResultado>("/api/5s/dashboard", { params: { tipo, de, ate } })
      .then(({ data }) => {
        setDados(data);
        setErro(null);
      })
      .catch((err) => setErro(mensagemDeErro(err, "Falha ao carregar o dashboard")))
      .finally(() => setLoading(false));
  }, [periodoPronto, tipo, de, ate]);

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

  const semDados = !!dados && dados.areas.length === 0;

  // Abre o relatório numa aba própria (fora do AppShell), com os mesmos filtros da tela — o
  // relatório busca os dados sozinho, então não depende do estado desta página.
  function imprimir(modo: ModoImpressao5S) {
    const params = new URLSearchParams({ tipo, de, ate, modo });
    window.open(`/5s/relatorio?${params.toString()}`, "_blank");
  }

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
        onChange={(k) => trocarTipo(k as TipoArea)}
      />

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="grid w-full max-w-md grid-cols-2 gap-3">
          <div>
            <label className={classeRotulo}>De</label>
            <input type="month" className={classeCampo} value={de} max={ate} onChange={(e) => mudarPeriodo("de", e.target.value)} />
          </div>
          <div>
            <label className={classeRotulo}>Até</label>
            <input type="month" className={classeCampo} value={ate} min={de} onChange={(e) => mudarPeriodo("ate", e.target.value)} />
          </div>
        </div>

        <DropdownMenu placement="bottom-end">
          <DropdownMenu.Trigger>
            <button type="button" disabled={!dados || semDados || de > ate} className={cn(classeBotaoSecundario, "min-h-10 whitespace-nowrap")}>
              Imprimir <span aria-hidden>▾</span>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content className="w-44">
            <DropdownMenu.Item onSelect={() => imprimir("resumido")}>Resumido</DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => imprimir("detalhado")}>Detalhado</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu>
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
          <KpisResultado dados={dados} />
          <RankingResultado dados={dados} />
          <DesempenhoPorSenso dados={dados} />

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

          <EvolucaoMensalTabela dados={dados} />

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
