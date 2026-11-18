import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TabelaLocal } from "../../components/colunas/TabelaLocal";
import type { ColunaLocal } from "../../components/colunas/aplicarLocal";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";
import { Modal } from "../../components/ui/Modal";
import { SelectBuscavel } from "../../components/ui/SelectBuscavel";
import { Skeleton } from "../../components/ui/Skeleton";
import { cn } from "../../lib/cn";
import {
  agruparOpcoesVinculo,
  contarSugestoesSeguras,
  formatarDia,
  formatarReais,
  ROTULO_REGIME,
  type OpcaoVinculo,
  type Regime,
  type SugestaoVinculo,
} from "../../lib/vinculoConsultores";

interface ValorHoraResumo {
  fixo: boolean;
  precoAtual: number | null;
  reajustes: number;
  ultimoReajuste: string | null;
  divergencia: { precoAtual: number; ultimoValorDoHistorico: number } | null;
}

interface LinhaVinculo {
  codemp: number;
  codusu: number;
  nome: string;
  nomeFornecedor: string | null;
  email: string | null;
  ativo: boolean;
  contaHabilitada: boolean;
  depexe: number | null;
  depexeLabel: string;
  contrato: { numctr: number | null; codmot: number | null; vlrhor: number | null; qtdctr: number | null; fixo: { qtd: number; valorMensal: number } | null } | null;
  valorHora: ValorHoraResumo | null;
  regime: Regime;
  valorManual: { vigencias: number; atual: number | null };
  contratoMensal: boolean;
  mensalDesde: string | null;
  mensalAte: string | null;
  kyriaMemberIds: string[];
  hcm: string | null;
  observacao: string | null;
  sugestaoKyria: SugestaoVinculo | null;
  sugestaoHcm: SugestaoVinculo | null;
}

interface Painel {
  linhas: LinhaVinculo[];
  atendentes: OpcaoVinculo[];
  funcionarios: OpcaoVinculo[];
  espelhosContrato: { contratos: number; itens: number; reajustes: number };
}

interface HistoricoValorHora {
  contrato: { numctr: number; codmot: number | null; vlrhor: number | null; qtdctr: number | null; fixo: { qtd: number; valorMensal: number } | null; situacao: string | null; periodicidadeReajusteMeses: number | null; ultimoReajuste: string | null } | null;
  item: { seqccs: number; servico: string | null; precoUnitario: number; quantidade: number | null; retencoes: Record<string, number | null> } | null;
  vigencias: { desde: string | null; valor: number; origem: "inicial" | "reajuste" | "preco_atual"; percentual: number | null }[];
  divergencia: { precoAtual: number; ultimoValorDoHistorico: number } | null;
  reajustes: { data: string | null; valorAnterior: number | null; valorNovo: number | null; aumento: number | null; percentual: number | null; descricao: string | null }[];
}

type Lado = "kyria" | "hcm";

interface Acoes {
  opcoesKyria: OpcaoVinculo[];
  opcoesHcm: OpcaoVinculo[];
  rotuloKyria: Map<string, string>;
  rotuloHcm: Map<string, string>;
  vincular: (linha: LinhaVinculo, lado: Lado, valor: string | null) => void;
  salvarObservacao: (linha: LinhaVinculo, texto: string) => void;
  abrirHistorico: (linha: LinhaVinculo) => void;
  abrirManual: (linha: LinhaVinculo) => void;
  abrirMensal: (linha: LinhaVinculo) => void;
  salvando: string | null;
}

const BOTAO = "rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground transition hover:border-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const CAMPO = "w-full rounded-md border border-border bg-surface px-2.5 py-1 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const TOM_REGIME: Record<Regime, string> = {
  pj: "bg-primary/10 text-primary",
  folha: "bg-success/15 text-success",
  ambos: "bg-warning/15 text-warning",
  indefinido: "bg-muted/15 text-muted",
};

// Colunas que o funil e a ordem enxergam (a lista inteira já está na tela — filtro local, como as demais listas do CaxHub).
const COLUNAS_LOCAIS: ColunaLocal[] = [
  { nome: "contaHabilitada", tipo: "booleano", obrigatoria: true },
  { nome: "consultor", tipo: "texto", obrigatoria: true },
  { nome: "depexeLabel", tipo: "texto", obrigatoria: true },
  { nome: "regime", tipo: "texto", obrigatoria: true },
  { nome: "valorHora", tipo: "decimal" },
  { nome: "contratoMensal", tipo: "booleano", obrigatoria: true },
  { nome: "valorManual", tipo: "decimal" },
  { nome: "kyria", tipo: "texto" },
  { nome: "hcm", tipo: "texto" },
  { nome: "observacao", tipo: "texto" },
];

/** Seletor de um lado do vínculo (atendente do Kyria ou funcionário do HCM) com a sugestão logo abaixo. */
function CelulaVinculo({ linha, lado, acoes }: { linha: LinhaVinculo; lado: Lado; acoes: Acoes }) {
  const opcoes = lado === "kyria" ? acoes.opcoesKyria : acoes.opcoesHcm;
  const rotulos = lado === "kyria" ? acoes.rotuloKyria : acoes.rotuloHcm;
  const atual = lado === "kyria" ? (linha.kyriaMemberIds[0] ?? null) : linha.hcm;
  const sugestao = lado === "kyria" ? linha.sugestaoKyria : linha.sugestaoHcm;
  const ocupado = acoes.salvando === `${linha.codemp}-${linha.codusu}-${lado}`;
  const agrupadas = useMemo(() => agruparOpcoesVinculo(opcoes, linha.codusu), [opcoes, linha.codusu]);

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <SelectBuscavel<string>
          opcoes={agrupadas}
          valor={atual}
          onChange={(v) => acoes.vincular(linha, lado, v)}
          placeholder={lado === "kyria" ? "Escolher atendente…" : "Escolher funcionário…"}
          placeholderBusca={lado === "kyria" ? "Buscar atendente por nome ou e-mail…" : "Buscar funcionário por nome ou matrícula…"}
          textoVazio={lado === "kyria" ? "Nenhum atendente sincronizado." : "Nenhum funcionário sincronizado."}
          desabilitado={ocupado}
          className="min-w-0 flex-1"
        />
        {atual && (
          <button
            type="button"
            aria-label={lado === "kyria" ? "Remover atendente" : "Remover funcionário"}
            title="Remover o vínculo"
            disabled={ocupado}
            onClick={() => acoes.vincular(linha, lado, null)}
            className="rounded px-1.5 py-0.5 text-sm text-muted hover:bg-surface-2 hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            ✕
          </button>
        )}
      </div>
      {!atual && sugestao && (
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted">
          <span className={sugestao.confianca === "alta" ? "text-success" : "text-warning"}>{sugestao.confianca === "alta" ? "Sugerido" : "Possível"}:</span>
          <span className="max-w-[210px] truncate text-foreground" title={rotulos.get(sugestao.valor)}>
            {rotulos.get(sugestao.valor) ?? sugestao.valor}
          </span>
          <span>({sugestao.motivo})</span>
          <button type="button" className="text-primary underline-offset-2 hover:underline" disabled={ocupado} onClick={() => acoes.vincular(linha, lado, sugestao.valor)}>
            Aceitar
          </button>
        </p>
      )}
      {ocupado && <p className="mt-1 text-[11px] text-muted">salvando...</p>}
    </div>
  );
}

const COLUNAS: DefColuna<LinhaVinculo, Acoes>[] = [
  {
    nome: "contaHabilitada",
    titulo: "Conta habilitada",
    dica: "Conta do consultor habilitada no Senior (USU_VBI00Cons.conhab = 1): libera o consultor nas telas de projeto.",
    largura: 130,
    formatarValor: (v) => (v === true || v === "true" ? "Sim" : "Não"),
    render: (l) => (
      <span className={cn("inline-block rounded px-2 py-0.5 text-[11.5px] font-medium", l.contaHabilitada ? "bg-success/15 text-success" : "bg-muted/15 text-muted")}>
        {l.contaHabilitada ? "Sim" : "Não"}
      </span>
    ),
  },
  {
    nome: "consultor",
    titulo: "Consultor",
    fixa: true,
    largura: 220,
    render: (l) => (
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground" title={l.nomeFornecedor ?? undefined}>
          {l.nome}
          {!l.ativo && <span className="ml-1.5 rounded bg-muted/15 px-1 text-[10px] font-medium uppercase text-muted">inativo</span>}
        </p>
        <p className="truncate text-[11.5px] text-muted">
          {l.codusu}
          {l.email ? ` · ${l.email}` : ""}
        </p>
      </div>
    ),
  },
  { nome: "depexeLabel", titulo: "Departamento", largura: 150, classe: "text-sm text-muted", render: (l) => l.depexeLabel },
  {
    nome: "regime",
    titulo: "Custo vem de",
    largura: 170,
    dica: "PJ: valor-hora do contrato (E460). Folha: funcionário do HCM. Os dois: confira se o consultor mudou de regime.",
    render: (l) => <span className={cn("inline-block whitespace-nowrap rounded px-2 py-0.5 text-[11.5px] font-medium", TOM_REGIME[l.regime])}>{ROTULO_REGIME[l.regime]}</span>,
  },
  {
    nome: "valorHora",
    titulo: "Valor-hora (contrato)",
    direita: true,
    largura: 170,
    render: (l, a) =>
      l.valorHora?.precoAtual != null ? (
        <div className="text-right">
          <p className="font-mono text-sm tabular-nums text-foreground">{formatarReais(l.valorHora.precoAtual)}</p>
          <button type="button" className="text-[11.5px] text-primary underline-offset-2 hover:underline" onClick={() => a.abrirHistorico(l)}>
            {l.valorHora.fixo ? "valor fixo" : `${l.valorHora.reajustes} ${l.valorHora.reajustes === 1 ? "reajuste" : "reajustes"}`}
            {l.valorHora.divergencia ? " ⚠" : ""}
          </button>
        </div>
      ) : l.contrato?.vlrhor != null ? (
        <span className="font-mono text-sm tabular-nums text-muted" title="Valor da view de contratos do Senior; sincronize os contratos de compra para ver o histórico.">
          {formatarReais(l.contrato.vlrhor)}
        </span>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  {
    nome: "contratoMensal",
    titulo: "Preço do contrato",
    largura: 190,
    dica: "Alguns contratos PJ guardam no Senior o valor do MÊS em vez do valor por hora. Marque quando o preço for mensal (e o período, se mudou).",
    formatarValor: (v) => (v === true || v === "true" ? "Mensal" : "Por hora (ou valor fixo)"),
    render: (l, a) =>
      l.contrato?.fixo ? (
        <span className="text-sm text-foreground" title={`Contrato de valor fixo: ${l.contrato.fixo.qtd} h × valor-hora = ${formatarReais(l.contrato.fixo.valorMensal)} por mês. O custo-hora é o valor-hora da view de contratos do Senior, como na Home.`}>
          Valor fixo · {l.contrato.fixo.qtd.toLocaleString("pt-BR")} h
        </span>
      ) : l.contrato ? (
        <button type="button" className="text-left text-sm text-primary underline-offset-2 hover:underline" onClick={() => a.abrirMensal(l)}>
          {l.contratoMensal ? `Mensal${l.mensalDesde || l.mensalAte ? ` (${l.mensalDesde ? rotuloMesCurto(l.mensalDesde) : "…"} a ${l.mensalAte ? rotuloMesCurto(l.mensalAte) : "hoje"})` : ""}` : "Por hora"}
        </button>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  {
    nome: "valorManual",
    titulo: "Valor-hora manual",
    direita: true,
    largura: 170,
    dica: "Para quem não é CLT nem tem contrato. Vale por vigência; só entra no custo-hora real quando não há folha nem contrato no mês.",
    render: (l, a) => (
      <button type="button" className="text-right text-sm text-primary underline-offset-2 hover:underline" onClick={() => a.abrirManual(l)}>
        {l.valorManual.vigencias > 0 ? `${formatarReais(l.valorManual.atual)} · ${l.valorManual.vigencias} vig.` : "Definir"}
      </button>
    ),
  },
  { nome: "kyria", titulo: "Atendente no Kyria", largura: 330, render: (l, a) => <CelulaVinculo linha={l} lado="kyria" acoes={a} /> },
  { nome: "hcm", titulo: "Funcionário no HCM", largura: 360, render: (l, a) => <CelulaVinculo linha={l} lado="hcm" acoes={a} /> },
  {
    nome: "observacao",
    titulo: "Observação",
    largura: 220,
    render: (l, a) => (
      <input
        key={`${l.codusu}-${l.observacao ?? ""}`}
        className={CAMPO}
        defaultValue={l.observacao ?? ""}
        maxLength={500}
        placeholder="Ex.: CLT até 2023, depois PJ"
        aria-label={`Observação de ${l.nome}`}
        onBlur={(e) => {
          if (e.target.value.trim() !== (l.observacao ?? "")) a.salvarObservacao(l, e.target.value);
        }}
      />
    ),
  },
];

export function VinculoConsultores() {
  const [painel, setPainel] = useState<Painel | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [inativos, setInativos] = useState(false);
  // "codemp-codusu-lado" da linha sendo salva — trava só aquele seletor.
  const [salvando, setSalvando] = useState<string | null>(null);
  const [historico, setHistorico] = useState<{ linha: LinhaVinculo; dados: HistoricoValorHora | null; erro: string | null } | null>(null);
  const [manual, setManual] = useState<LinhaVinculo | null>(null);
  const [mensal, setMensal] = useState<LinhaVinculo | null>(null);

  const carregar = useCallback(
    (silencioso = false) => {
      if (!silencioso) setLoading(true);
      return axios
        .get<Painel>("/api/consultores-vinculos", { params: inativos ? { inativos: 1 } : {} })
        .then(({ data }) => {
          setPainel(data);
          setErro(null);
        })
        .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar os consultores"))
        .finally(() => setLoading(false));
    },
    [inativos]
  );

  useEffect(() => {
    carregar();
  }, [carregar]);

  const rotuloKyria = useMemo(() => new Map((painel?.atendentes ?? []).map((o) => [o.value, o.label])), [painel]);
  const rotuloHcm = useMemo(() => new Map((painel?.funcionarios ?? []).map((o) => [o.value, o.label])), [painel]);

  async function vincular(linha: LinhaVinculo, lado: Lado, valor: string | null, forcar = false): Promise<void> {
    const chave = `${linha.codemp}-${linha.codusu}-${lado}`;
    setSalvando(chave);
    setAviso(null);
    try {
      const corpo = lado === "kyria" ? { memberId: valor, forcar } : { colaborador: valor, forcar };
      await axios.put(`/api/consultores-vinculos/${linha.codemp}/${linha.codusu}/${lado}`, corpo);
      await carregar(true);
      setErro(null);
    } catch (err) {
      const resposta = axios.isAxiosError(err) ? err.response : undefined;
      if (resposta?.status === 409 && window.confirm(`${resposta.data?.error ?? "Já vinculado a outro consultor."}\n\nTrocar o vínculo para ${linha.nome}?`)) {
        setSalvando(null);
        return vincular(linha, lado, valor, true);
      }
      if (resposta?.status !== 409) setErro(resposta?.data?.error ?? "Falha ao salvar o vínculo");
    } finally {
      setSalvando((atual) => (atual === chave ? null : atual));
    }
  }

  async function salvarObservacao(linha: LinhaVinculo, texto: string): Promise<void> {
    try {
      await axios.put(`/api/consultores-vinculos/${linha.codemp}/${linha.codusu}/observacao`, { observacao: texto });
      await carregar(true);
      setErro(null);
    } catch (err) {
      setErro(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Falha ao salvar a observação") : "Falha ao salvar a observação");
    }
  }

  async function aplicarSugestoes(lado: Lado, quantas: number): Promise<void> {
    const alvo = lado === "kyria" ? "atendentes do Kyria" : "funcionários do HCM";
    if (!window.confirm(`Aplicar as ${quantas} sugestões de confiança ALTA (nome ou e-mail idêntico) para os ${alvo}? Só entram consultores sem vínculo; as sugestões "possíveis" não são aplicadas.`)) return;
    setErro(null);
    try {
      const { data } = await axios.post<{ aplicadas: number }>("/api/consultores-vinculos/aplicar-sugestoes", { lado });
      setAviso(`${data.aplicadas} ${data.aplicadas === 1 ? "vínculo aplicado" : "vínculos aplicados"}.`);
      await carregar(true);
    } catch (err) {
      setErro(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Falha ao aplicar as sugestões") : "Falha ao aplicar as sugestões");
    }
  }

  function abrirHistorico(linha: LinhaVinculo): void {
    setHistorico({ linha, dados: null, erro: null });
    axios
      .get<HistoricoValorHora>(`/api/consultores-vinculos/${linha.codemp}/${linha.codusu}/valor-hora`)
      .then(({ data }) => setHistorico({ linha, dados: data, erro: null }))
      .catch((err) => setHistorico({ linha, dados: null, erro: err.response?.data?.error ?? "Falha ao carregar o histórico" }));
  }

  const acoes: Acoes = {
    opcoesKyria: painel?.atendentes ?? [],
    opcoesHcm: painel?.funcionarios ?? [],
    rotuloKyria,
    rotuloHcm,
    vincular: (l, lado, v) => void vincular(l, lado, v),
    salvarObservacao: (l, t) => void salvarObservacao(l, t),
    abrirHistorico,
    abrirManual: setManual,
    abrirMensal: setMensal,
    salvando,
  };

  const linhas = painel?.linhas ?? [];
  const ler = useCallback(
    (l: LinhaVinculo, coluna: string): unknown => {
      switch (coluna) {
        case "consultor":
          return l.nome;
        case "regime":
          return ROTULO_REGIME[l.regime];
        case "valorHora":
          return l.valorHora?.precoAtual ?? null;
        case "valorManual":
          return l.valorManual.atual;
        case "kyria":
          return l.kyriaMemberIds.map((id) => rotuloKyria.get(id) ?? id).join(", ");
        case "hcm":
          return l.hcm ? (rotuloHcm.get(l.hcm) ?? l.hcm) : "";
        default:
          return (l as unknown as Record<string, unknown>)[coluna];
      }
    },
    [rotuloKyria, rotuloHcm]
  );

  const resumo = useMemo(() => {
    const comKyria = linhas.filter((l) => l.kyriaMemberIds.length > 0).length;
    const comHcm = linhas.filter((l) => l.hcm).length;
    return {
      total: linhas.length,
      comKyria,
      comHcm,
      semCusto: linhas.filter((l) => l.regime === "indefinido").length,
      conferir: linhas.filter((l) => l.regime === "ambos").length,
      seguraKyria: contarSugestoesSeguras(linhas.map((l) => l.sugestaoKyria)),
      seguraHcm: contarSugestoesSeguras(linhas.map((l) => l.sugestaoHcm)),
    };
  }, [linhas]);

  const espelhoVazio = !!painel && painel.espelhosContrato.contratos === 0;

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Administração · Vínculo de Consultores</p>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-foreground">Vínculo de Consultores</h1>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} />
          Mostrar consultores inativos
        </label>
      </div>

      <p className="mb-3 max-w-3xl text-sm text-muted">
        Liga cada consultor ao <b>atendente do Kyria</b> (de onde vêm as horas dos tickets) e ao <b>funcionário do HCM</b> (de onde vem a folha do CLT) — a
        base do custo-hora real. O consultor PJ não tem funcionário: o custo dele é o valor-hora do <b>contrato</b> (E460), com o histórico de reajustes.
        O vínculo com o Kyria é o mesmo campo de "Ver dados › Membros" (só atendente); o do HCM guarda um funcionário por consultor.
      </p>

      {espelhoVazio && (
        <p className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-warning">
          Os contratos de compra ainda não foram importados: sincronize "Contratos de Compra", "Itens dos Contratos de Compra" e "Reajustes dos Contratos de Compra"
          em Administração › Importados do ERP para ver o histórico do valor-hora.
        </p>
      )}
      {erro && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{erro}</p>}
      {aviso && <p className="mb-4 rounded-md border border-success/40 bg-success/10 px-4 py-2.5 text-sm text-success">{aviso}</p>}

      {loading && !painel ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted">
            <span>
              <b className="text-foreground">{resumo.total}</b> consultores
            </span>
            <span>
              <b className="text-foreground">{resumo.comKyria}</b> com atendente no Kyria
            </span>
            <span>
              <b className="text-foreground">{resumo.comHcm}</b> com funcionário no HCM
            </span>
            <span>
              <b className="text-foreground">{resumo.semCusto}</b> sem custo definido
            </span>
            {resumo.conferir > 0 && (
              <span className="text-warning">
                <b>{resumo.conferir}</b> com contrato e HCM — conferir
              </span>
            )}
            <span className="ml-auto flex flex-wrap gap-2">
              <button type="button" className={BOTAO} disabled={resumo.seguraKyria === 0} onClick={() => void aplicarSugestoes("kyria", resumo.seguraKyria)}>
                Aceitar sugestões seguras do Kyria ({resumo.seguraKyria})
              </button>
              <button type="button" className={BOTAO} disabled={resumo.seguraHcm === 0} onClick={() => void aplicarSugestoes("hcm", resumo.seguraHcm)}>
                Aceitar sugestões seguras do HCM ({resumo.seguraHcm})
              </button>
            </span>
          </div>

          <TabelaLocal<LinhaVinculo, Acoes>
            chave="admin.vinculo-consultores"
            defs={COLUNAS}
            colunas={COLUNAS_LOCAIS}
            linhas={linhas}
            paginacao={{ opcoes: [5, 10, 25, 50, 100], inicial: 10, rotulo: "consultores" }}
            ler={ler}
            chaveLinha={(l) => `${l.codemp}-${l.codusu}`}
            loading={loading}
            vazio="Nenhum consultor encontrado."
            ctx={acoes}
          />
        </>
      )}

      <ModalValorManual linha={manual} onClose={() => setManual(null)} aoMudar={() => carregar(true)} />
      <ModalContratoMensal linha={mensal} onClose={() => setMensal(null)} aoMudar={() => carregar(true)} />

      <Modal
        open={historico !== null}
        onClose={() => setHistorico(null)}
        title={historico ? `Valor-hora — ${historico.linha.nome}` : "Valor-hora"}
        subtitulo="Contrato de compra do consultor (E460CTR / CCS / REA)"
        className="max-w-2xl"
      >
        {historico?.erro && <p className="text-sm text-destructive">{historico.erro}</p>}
        {historico && !historico.dados && !historico.erro && <Skeleton className="h-32 w-full" />}
        {historico?.dados && <HistoricoValorHoraView dados={historico.dados} />}
      </Modal>
    </div>
  );
}

/** "2023-03" → "03/2023". */
const rotuloMesCurto = (ym: string): string => `${ym.slice(5, 7)}/${ym.slice(0, 4)}`;

interface ValorManualApi {
  id: number;
  vigenciaInicio: string;
  valor: number;
  observacao: string | null;
}

/** Valor-hora manual do consultor: lista as vigências e permite incluir, corrigir (mesma vigência) e excluir. */
function ModalValorManual({ linha, onClose, aoMudar }: { linha: LinhaVinculo | null; onClose: () => void; aoMudar: () => Promise<void> }) {
  const [valores, setValores] = useState<ValorManualApi[] | null>(null);
  const [vigencia, setVigencia] = useState("");
  const [valor, setValor] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const url = linha ? `/api/custo-hora/valor-hora-manual/${linha.codemp}/${linha.codusu}` : "";

  const carregar = useCallback(() => {
    if (!linha) return Promise.resolve();
    return axios
      .get<{ valores: ValorManualApi[] }>(url)
      .then(({ data }) => setValores(data.valores))
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar os valores"));
  }, [linha, url]);

  useEffect(() => {
    setValores(null);
    setErro(null);
    setVigencia("");
    setValor("");
    setObservacao("");
    void carregar();
  }, [carregar]);

  async function salvar() {
    setErro(null);
    try {
      await axios.post(url, { vigenciaInicio: vigencia, valor, observacao });
      setVigencia("");
      setValor("");
      setObservacao("");
      await Promise.all([carregar(), aoMudar()]);
    } catch (err) {
      setErro(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Falha ao salvar") : "Falha ao salvar");
    }
  }

  async function excluir(v: ValorManualApi) {
    if (!window.confirm(`Excluir o valor de ${formatarReais(v.valor)} desde ${formatarDia(v.vigenciaInicio)}?`)) return;
    try {
      await axios.delete(`/api/custo-hora/valor-hora-manual/${v.id}`);
      await Promise.all([carregar(), aoMudar()]);
    } catch (err) {
      setErro(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Falha ao excluir") : "Falha ao excluir");
    }
  }

  return (
    <Modal open={linha !== null} onClose={onClose} title={linha ? `Valor-hora manual — ${linha.nome}` : "Valor-hora manual"} subtitulo="Vale do mês da vigência em diante, até a próxima vigência" className="max-w-2xl">
      <div className="space-y-4 text-sm">
        <p className="text-muted">Para quem não é CLT nem tem contrato no Senior. Se houver folha ou contrato no mês, eles têm prioridade e este valor não é usado.</p>
        {valores === null ? (
          <Skeleton className="h-16 w-full" />
        ) : valores.length === 0 ? (
          <p className="text-muted">Nenhum valor cadastrado.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted">
                <th className="py-1.5 pr-3 font-medium">Vigente desde</th>
                <th className="py-1.5 pr-3 text-right font-medium">Valor-hora</th>
                <th className="py-1.5 pr-3 font-medium">Observação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {valores.map((v) => (
                <tr key={v.id} className="border-t border-border/60">
                  <td className="py-1.5 pr-3 text-foreground">{formatarDia(v.vigenciaInicio)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{formatarReais(v.valor)}</td>
                  <td className="py-1.5 pr-3 text-muted">{v.observacao ?? ""}</td>
                  <td className="py-1.5 text-right">
                    <button type="button" className="text-destructive underline-offset-2 hover:underline" onClick={() => void excluir(v)}>
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="rounded-md border border-border bg-surface-2 p-3">
          <p className="mb-2 text-[12px] text-muted">Nova vigência (a mesma data corrige o valor):</p>
          <div className="flex flex-wrap items-end gap-2">
            <input type="date" className={CAMPO} value={vigencia} onChange={(e) => setVigencia(e.target.value)} aria-label="Vigente desde" />
            <input className={`${CAMPO} w-32`} inputMode="decimal" placeholder="Valor-hora" value={valor} onChange={(e) => setValor(e.target.value)} aria-label="Valor-hora" />
            <input className={`${CAMPO} min-w-[10rem] flex-1`} placeholder="Observação (opcional)" maxLength={500} value={observacao} onChange={(e) => setObservacao(e.target.value)} aria-label="Observação" />
            <button type="button" className={BOTAO} disabled={!vigencia || !valor} onClick={() => void salvar()}>
              Salvar
            </button>
          </div>
        </div>
        {erro && <p className="text-destructive">{erro}</p>}
      </div>
    </Modal>
  );
}

/** Se o preço do item do contrato PJ é um valor MENSAL (e em que período) — o custo-hora passa a ser preço ÷ horas da escala. */
function ModalContratoMensal({ linha, onClose, aoMudar }: { linha: LinhaVinculo | null; onClose: () => void; aoMudar: () => Promise<void> }) {
  const [ehMensal, setEhMensal] = useState(false);
  const [desde, setDesde] = useState("");
  const [ate, setAte] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setEhMensal(linha?.contratoMensal ?? false);
    setDesde(linha?.mensalDesde ?? "");
    setAte(linha?.mensalAte ?? "");
    setErro(null);
  }, [linha]);

  async function salvar() {
    if (!linha) return;
    setErro(null);
    try {
      await axios.put(`/api/consultores-vinculos/${linha.codemp}/${linha.codusu}/contrato-mensal`, { mensal: ehMensal, desde: desde || null, ate: ate || null });
      await aoMudar();
      onClose();
    } catch (err) {
      setErro(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Falha ao salvar") : "Falha ao salvar");
    }
  }

  return (
    <Modal open={linha !== null} onClose={onClose} title={linha ? `Preço do contrato — ${linha.nome}` : "Preço do contrato"} subtitulo={linha?.contrato?.numctr ? `Contrato ${linha.contrato.numctr}` : undefined}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          O Senior não diz se o preço do item é <b>por hora</b> ou o <b>valor do mês</b>. Se for mensal (ex.: R$ 12.000,00), o custo-hora é o preço ÷ horas da escala (parâmetro em Custo-hora real). Há contratos que mudaram de um para o outro:
          informe o período em que o preço é mensal.
        </p>
        <label className="flex items-center gap-2 text-foreground">
          <input type="checkbox" checked={ehMensal} onChange={(e) => setEhMensal(e.target.checked)} />O preço do contrato é um valor mensal
        </label>
        {ehMensal && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">de</span>
            <input type="month" className={CAMPO} value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Mensal desde" />
            <span className="text-muted">até</span>
            <input type="month" className={CAMPO} value={ate} onChange={(e) => setAte(e.target.value)} aria-label="Mensal até" />
            <span className="text-[12px] text-muted">(vazio = sem limite)</span>
          </div>
        )}
        {erro && <p className="text-destructive">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTAO} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90" onClick={() => void salvar()}>
            Salvar
          </button>
        </div>
      </div>
    </Modal>
  );
}

const ROTULO_RETENCAO: Record<string, string> = { iss: "ISS", irrf: "IRRF", inss: "INSS", pis: "PIS", csll: "CSLL", cofins: "Cofins", outras: "Outras" };

function HistoricoValorHoraView({ dados }: { dados: HistoricoValorHora }) {
  if (!dados.contrato) return <p className="text-sm text-muted">Este consultor não tem contrato de valor-hora no Senior.</p>;
  const retencoes = Object.entries(dados.item?.retencoes ?? {}).filter(([, v]) => v != null && v !== 0);
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted">
        Contrato <b className="text-foreground">{dados.contrato.numctr}</b>
        {dados.contrato.situacao ? ` · situação ${dados.contrato.situacao === "A" ? "ativo" : "inativo"}` : ""}
        {dados.contrato.periodicidadeReajusteMeses ? ` · reajuste a cada ${dados.contrato.periodicidadeReajusteMeses} meses` : ""}
        {dados.item ? ` · item ${dados.item.seqccs}${dados.item.servico ? ` (${dados.item.servico})` : ""}` : ""}
      </p>

      {dados.contrato.fixo && (
        <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-muted">
          <b className="text-foreground">Contrato de valor fixo:</b> {dados.contrato.fixo.qtd.toLocaleString("pt-BR")} h × {formatarReais(dados.contrato.vlrhor)} por hora = {formatarReais(dados.contrato.fixo.valorMensal)} por mês. O custo-hora usa o
          valor-hora da view de contratos do Senior (o mesmo do card "Valor-hora · Projeção de ganhos" da Home). O histórico de reajustes da E460REA não é usado: nesses contratos ele mistura valor por hora e total do mês.
        </p>
      )}

      {dados.divergencia && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-warning">
          O preço atual do item ({formatarReais(dados.divergencia.precoAtual)}) difere do último valor do histórico ({formatarReais(dados.divergencia.ultimoValorDoHistorico)}): há
          mudança de preço sem registro de reajuste no Senior.
        </p>
      )}

      {dados.vigencias.length === 0 ? (
        <p className="text-muted">Sem preço nem reajuste importados. Sincronize os contratos de compra.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted">
              <th className="py-1.5 pr-3 font-medium">Vigente desde</th>
              <th className="py-1.5 pr-3 text-right font-medium">Valor-hora</th>
              <th className="py-1.5 text-right font-medium">Reajuste</th>
            </tr>
          </thead>
          <tbody>
            {dados.vigencias.map((v, i) => (
              <tr key={i} className="border-t border-border/60">
                <td className="py-1.5 pr-3 text-foreground">{v.desde ? formatarDia(v.desde) : v.origem === "inicial" ? "Início do contrato" : "Sempre"}</td>
                <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-foreground">{formatarReais(v.valor)}</td>
                <td className="py-1.5 text-right font-mono tabular-nums text-muted">{v.percentual != null ? `${v.percentual.toLocaleString("pt-BR")}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {retencoes.length > 0 && (
        <p className="text-[12px] text-muted">
          Retenções do item (só informativas — o custo do PJ é o valor bruto):{" "}
          {retencoes.map(([k, v]) => `${ROTULO_RETENCAO[k] ?? k} ${(v as number).toLocaleString("pt-BR")}%`).join(" · ")}
        </p>
      )}
    </div>
  );
}
