import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TabelaLocal } from "../../components/colunas/TabelaLocal";
import type { ColunaLocal } from "../../components/colunas/aplicarLocal";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";
import { Modal } from "../../components/ui/Modal";
import { Skeleton } from "../../components/ui/Skeleton";
import { cn } from "../../lib/cn";
import {
  AJUDA_CLASSE,
  descreverDetalhe,
  formatarPercentual,
  mesAnterior,
  resumirResultado,
  ROTULO_CLASSE,
  ROTULO_ORIGEM,
  ROTULO_TIPO_EVENTO,
  rotuloCompetencia,
  rotuloTipoEvento,
  type ClasseEvento,
} from "../../lib/custoHora";
import { formatarDia, formatarReais } from "../../lib/vinculoConsultores";

interface Encargo {
  id: number;
  codigo: string;
  rotulo: string;
  percentual: number;
  vigenciaInicio: string;
}

interface Config {
  parametros: Record<string, string>;
  definicoesParametros: Record<string, string>;
  encargos: Encargo[];
  eventosClassificados: number;
  ultimaExecucao: { status: string; message: string | null; runAt: string } | null;
}

interface Evento {
  tabeve: number;
  codeve: number;
  descricao: string | null;
  tipeve: number | null;
  classe: ClasseEvento | null;
  linhas: number;
  colaboradores: number;
  valor: number;
}

interface LinhaResultado {
  codemp: number;
  codusu: number;
  nome: string;
  ativo: boolean;
  origem: string | null;
  custoHora: number | null;
  detalhe: unknown;
}

interface ResumoRecalculo {
  competencias: string[];
  gravados: number;
  porOrigem: { clt_folha: number; pj_contrato: number; manual: number };
  semCusto: number;
  avisos: string[];
}

type Aba = "resultado" | "encargos" | "eventos" | "parametros";

const BOTAO = "rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground transition hover:border-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const BOTAO_PRIMARIO = "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const CAMPO = "rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const POR_PAGINA = { opcoes: [10, 25, 50, 100], inicial: 25 };

const mensagemDe = (err: unknown, padrao: string): string => (axios.isAxiosError(err) ? (err.response?.data?.error ?? padrao) : padrao);

export function CustoHora() {
  const [aba, setAba] = useState<Aba>("resultado");
  const [config, setConfig] = useState<Config | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const importarRef = useRef<HTMLInputElement>(null);
  const [importando, setImportando] = useState<{ texto: string; substituir: boolean } | null>(null);

  const carregarConfig = useCallback(() => {
    return axios
      .get<Config>("/api/custo-hora/config")
      .then(({ data }) => setConfig(data))
      .catch((err) => setErro(mensagemDe(err, "Falha ao carregar a configuração")));
  }, []);

  useEffect(() => {
    void carregarConfig();
  }, [carregarConfig]);

  async function exportar() {
    try {
      const { data } = await axios.get("/api/custo-hora/exportar");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "custo-hora-config.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErro(mensagemDe(err, "Falha ao exportar"));
    }
  }

  async function importar() {
    if (!importando) return;
    setErro(null);
    try {
      const corpo = JSON.parse(importando.texto) as Record<string, unknown>;
      const { data } = await axios.post<{ parametros: number; encargos: number; eventos: number }>("/api/custo-hora/importar", { ...corpo, substituir: importando.substituir });
      setAviso(`Importado: ${data.parametros} parâmetro(s), ${data.encargos} encargo(s), ${data.eventos} evento(s) classificado(s).`);
      setImportando(null);
      await carregarConfig();
    } catch (err) {
      setErro(err instanceof SyntaxError ? "O arquivo não é um JSON válido." : mensagemDe(err, "Falha ao importar"));
    }
  }

  const ABAS: { id: Aba; rotulo: string }[] = [
    { id: "resultado", rotulo: "Resultado por mês" },
    { id: "encargos", rotulo: "Encargos" },
    { id: "eventos", rotulo: "Eventos da folha" },
    { id: "parametros", rotulo: "Parâmetros" },
  ];

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Administração · Custo-hora real</p>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-foreground">Custo-hora real</h1>
        <div className="flex gap-2">
          <button type="button" className={BOTAO} onClick={() => importarRef.current?.click()}>
            Importar JSON
          </button>
          <button type="button" className={BOTAO} onClick={() => void exportar()}>
            Exportar JSON
          </button>
          <input
            ref={importarRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              e.target.value = "";
              if (arquivo) void arquivo.text().then((texto) => setImportando({ texto, substituir: false }));
            }}
          />
        </div>
      </div>

      <p className="mb-4 max-w-3xl text-sm text-muted">
        Quanto custa a hora de cada consultor em cada mês. <b>CLT</b>: (remuneração + benefícios + encargos da folha + encargos em % sobre a remuneração) ÷ horas da escala.{" "}
        <b>PJ</b>: valor-hora do contrato no mês (histórico de reajustes do Senior). Quem não é CLT nem tem contrato usa o <b>valor-hora manual</b> (em Vínculo de Consultores).
        Os percentuais, a classificação dos eventos e as horas da escala são configurados aqui — nada vem pronto. O resultado alimenta os campos{" "}
        <span className="font-mono">CustoKyria</span>, <span className="font-mono">CustoRat</span> e <span className="font-mono">CustoReal</span> dos indicadores de rentabilidade.
      </p>

      {erro && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{erro}</p>}
      {aviso && <p className="mb-4 rounded-md border border-success/40 bg-success/10 px-4 py-2.5 text-sm text-success">{aviso}</p>}

      <div className="mb-5 flex gap-1 border-b border-border" role="tablist">
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={aba === a.id}
            onClick={() => setAba(a.id)}
            className={cn("-mb-px border-b-2 px-4 py-2 text-sm transition", aba === a.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted hover:text-foreground")}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      {!config ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          {aba === "resultado" && <AbaResultado config={config} aoRecalcular={carregarConfig} />}
          {aba === "encargos" && <AbaEncargos encargos={config.encargos} recarregar={carregarConfig} setErro={setErro} />}
          {aba === "eventos" && <AbaEventos setErro={setErro} aoMudar={carregarConfig} />}
          {aba === "parametros" && <AbaParametros config={config} recarregar={carregarConfig} setErro={setErro} setAviso={setAviso} />}
        </>
      )}

      <Modal open={importando !== null} onClose={() => setImportando(null)} title="Importar configuração" subtitulo="Parâmetros, encargos e classificação dos eventos">
        <div className="space-y-4 text-sm">
          <p className="text-muted">
            O arquivo é validado por inteiro antes de gravar: se algo estiver errado, nada é alterado. Sem a opção abaixo, o que está no arquivo entra por cima do que já existe e o resto fica como está.
          </p>
          <label className="flex items-center gap-2 text-foreground">
            <input type="checkbox" checked={importando?.substituir ?? false} onChange={(e) => setImportando((i) => (i ? { ...i, substituir: e.target.checked } : i))} />
            Substituir: apagar os encargos e a classificação atuais antes de importar
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className={BOTAO} onClick={() => setImportando(null)}>
              Cancelar
            </button>
            <button type="button" className={BOTAO_PRIMARIO} onClick={() => void importar()}>
              Importar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------- Resultado por mês ----------

const COLUNAS_RESULTADO_LOCAIS: ColunaLocal[] = [
  { nome: "nome", tipo: "texto", obrigatoria: true },
  { nome: "ativo", tipo: "booleano", obrigatoria: true },
  { nome: "origem", tipo: "texto" },
  { nome: "custoHora", tipo: "decimal" },
];

const lerResultado = (l: LinhaResultado, coluna: string): unknown => (coluna === "origem" ? (l.origem ? (ROTULO_ORIGEM as Record<string, string>)[l.origem] : "Sem custo") : (l as unknown as Record<string, unknown>)[coluna]);

const COLUNAS_RESULTADO: DefColuna<LinhaResultado>[] = [
  { nome: "nome", titulo: "Consultor", fixa: true, largura: 240, classe: "text-sm font-semibold text-foreground", render: (l) => l.nome },
  { nome: "ativo", titulo: "Ativo", largura: 90, formatarValor: (v) => (v === true || v === "true" ? "Sim" : "Não"), classe: "text-sm text-muted", render: (l) => (l.ativo ? "Sim" : "Não") },
  {
    nome: "origem",
    titulo: "Origem",
    largura: 150,
    render: (l) =>
      l.origem ? (
        <span className="rounded bg-primary/10 px-2 py-0.5 text-[11.5px] font-medium text-primary">{(ROTULO_ORIGEM as Record<string, string>)[l.origem] ?? l.origem}</span>
      ) : (
        <span className="rounded bg-warning/15 px-2 py-0.5 text-[11.5px] font-medium text-warning">Sem custo</span>
      ),
  },
  { nome: "custoHora", titulo: "Custo-hora", direita: true, largura: 130, classe: "font-mono text-sm tabular-nums text-foreground", render: (l) => formatarReais(l.custoHora) },
  { nome: "detalhe", titulo: "Como chegou", largura: 320, classe: "text-[12.5px] text-muted", render: (l) => descreverDetalhe(l.origem, l.detalhe) },
];

function AbaResultado({ config, aoRecalcular }: { config: Config; aoRecalcular: () => Promise<void> }) {
  const [competencia, setCompetencia] = useState(mesAnterior());
  const [linhas, setLinhas] = useState<LinhaResultado[]>([]);
  const [comResultado, setComResultado] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [de, setDe] = useState(mesAnterior());
  const [ate, setAte] = useState(mesAnterior());
  const [calculando, setCalculando] = useState(false);
  const [resumo, setResumo] = useState<ResumoRecalculo | null>(null);

  const carregar = useCallback(() => {
    setLoading(true);
    return axios
      .get<{ linhas: LinhaResultado[]; competenciasComResultado: string[] }>("/api/custo-hora/resultado", { params: { competencia } })
      .then(({ data }) => {
        setLinhas(data.linhas);
        setComResultado(data.competenciasComResultado);
        setErro(null);
      })
      .catch((err) => setErro(mensagemDe(err, "Falha ao carregar o resultado")))
      .finally(() => setLoading(false));
  }, [competencia]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function recalcular() {
    setCalculando(true);
    setErro(null);
    try {
      const { data } = await axios.post<ResumoRecalculo>("/api/custo-hora/recalcular", { de, ate });
      setResumo(data);
      await Promise.all([carregar(), aoRecalcular()]);
    } catch (err) {
      setErro(mensagemDe(err, "Falha ao recalcular"));
    } finally {
      setCalculando(false);
    }
  }

  const totais = useMemo(() => resumirResultado(linhas), [linhas]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-lg border border-border bg-surface px-4 py-3">
        <label className="text-sm text-muted">
          Competência
          <input type="month" className={cn(CAMPO, "ml-2")} value={competencia} onChange={(e) => e.target.value && setCompetencia(e.target.value)} />
        </label>
        <span className="text-sm text-muted">Recalcular de</span>
        <input type="month" className={CAMPO} value={de} onChange={(e) => e.target.value && setDe(e.target.value)} aria-label="Recalcular a partir de" />
        <span className="text-sm text-muted">até</span>
        <input type="month" className={CAMPO} value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} aria-label="Recalcular até" />
        <button type="button" className={BOTAO_PRIMARIO} disabled={calculando} onClick={() => void recalcular()}>
          {calculando ? "Calculando..." : "Recalcular período"}
        </button>
        <p className="w-full text-[12px] text-muted">
          O cálculo roda sozinho todo dia às 6h40 para os 3 últimos meses. Use "Recalcular período" depois de mudar a configuração ou para preencher meses antigos (até 60 meses).
          {config.ultimaExecucao && <> Última execução: {new Date(config.ultimaExecucao.runAt).toLocaleString("pt-BR")} — {config.ultimaExecucao.message}</>}
        </p>
      </div>

      {resumo && (
        <div className="rounded-md border border-border bg-surface-2 px-4 py-2.5 text-sm text-foreground">
          {resumo.gravados} custos gravados ({resumo.porOrigem.clt_folha} CLT, {resumo.porOrigem.pj_contrato} PJ, {resumo.porOrigem.manual} manual) em {resumo.competencias.length} mês(es); {resumo.semCusto}{" "}
          consultor(es) ativo(s) ficaram sem custo.
          {resumo.avisos.map((a) => (
            <p key={a} className="mt-1 text-warning">
              {a}
            </p>
          ))}
        </div>
      )}
      {erro && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{erro}</p>}

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
        <span>
          Resultado de <b className="text-foreground">{rotuloCompetencia(`${competencia}-01`)}</b>:
        </span>
        <span>
          <b className="text-foreground">{totais.clt_folha}</b> CLT
        </span>
        <span>
          <b className="text-foreground">{totais.pj_contrato}</b> PJ
        </span>
        <span>
          <b className="text-foreground">{totais.manual}</b> manual
        </span>
        <span className={totais.semCusto > 0 ? "text-warning" : undefined}>
          <b>{totais.semCusto}</b> ativo(s) sem custo
        </span>
        {comResultado.length > 0 && <span>Meses com resultado: {comResultado.slice(0, 12).map((c) => rotuloCompetencia(c)).join(", ")}{comResultado.length > 12 ? "…" : ""}</span>}
      </div>

      <TabelaLocal<LinhaResultado>
        chave="admin.custo-hora.resultado"
        defs={COLUNAS_RESULTADO}
        colunas={COLUNAS_RESULTADO_LOCAIS}
        linhas={linhas}
        ler={lerResultado}
        chaveLinha={(l) => `${l.codemp}-${l.codusu}`}
        loading={loading}
        vazio="Nenhum resultado para esta competência. Configure a aba Parâmetros/Encargos/Eventos e use Recalcular período."
        paginacao={{ ...POR_PAGINA, rotulo: "consultores" }}
      />
    </div>
  );
}

// ---------- Encargos ----------

interface RascunhoEncargo {
  id: number | null;
  codigo: string;
  rotulo: string;
  percentual: string;
  vigenciaInicio: string;
}

const RASCUNHO_VAZIO: RascunhoEncargo = { id: null, codigo: "", rotulo: "", percentual: "", vigenciaInicio: "" };

function AbaEncargos({ encargos, recarregar, setErro }: { encargos: Encargo[]; recarregar: () => Promise<void>; setErro: (e: string | null) => void }) {
  const [rascunho, setRascunho] = useState<RascunhoEncargo | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);

  async function salvar() {
    if (!rascunho) return;
    setErroForm(null);
    const corpo = { codigo: rascunho.codigo, rotulo: rascunho.rotulo, percentual: rascunho.percentual, vigenciaInicio: rascunho.vigenciaInicio };
    try {
      if (rascunho.id == null) await axios.post("/api/custo-hora/encargos", corpo);
      else await axios.put(`/api/custo-hora/encargos/${rascunho.id}`, corpo);
      setRascunho(null);
      await recarregar();
    } catch (err) {
      setErroForm(mensagemDe(err, "Falha ao salvar o encargo"));
    }
  }

  async function excluir(e: Encargo) {
    if (!window.confirm(`Excluir "${e.rotulo}" (${formatarPercentual(e.percentual)} desde ${formatarDia(e.vigenciaInicio)})?`)) return;
    try {
      await axios.delete(`/api/custo-hora/encargos/${e.id}`);
      await recarregar();
    } catch (err) {
      setErro(mensagemDe(err, "Falha ao excluir"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted">
          Encargos em <b>percentual sobre a remuneração do mês</b> (a soma dos eventos classificados como remuneração): INSS patronal, RAT, terceiros, provisões de 13º e de férias etc. Cada linha vale a partir da vigência
          até a próxima do mesmo código; para mudar um percentual, acrescente uma nova vigência.
        </p>
        <button type="button" className={BOTAO_PRIMARIO} onClick={() => setRascunho({ ...RASCUNHO_VAZIO })}>
          Novo encargo
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-surface-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted">
              <th className="px-4 py-2.5 font-medium">Código</th>
              <th className="px-4 py-2.5 font-medium">Encargo</th>
              <th className="px-4 py-2.5 text-right font-medium">Percentual</th>
              <th className="px-4 py-2.5 font-medium">Vigente desde</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {encargos.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted">
                  Nenhum encargo configurado: o custo do CLT será só a folha (remuneração + benefícios + encargos da folha). Cadastre aqui ou use Importar JSON.
                </td>
              </tr>
            )}
            {encargos.map((e) => (
              <tr key={e.id} className="border-t border-border/60">
                <td className="px-4 py-2 font-mono text-[12.5px] text-muted">{e.codigo}</td>
                <td className="px-4 py-2 text-foreground">{e.rotulo}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">{formatarPercentual(e.percentual)}</td>
                <td className="px-4 py-2 text-muted">{formatarDia(e.vigenciaInicio)}</td>
                <td className="px-4 py-2 text-right">
                  <button type="button" className="mr-3 text-primary underline-offset-2 hover:underline" onClick={() => setRascunho({ id: e.id, codigo: e.codigo, rotulo: e.rotulo, percentual: String(e.percentual).replace(".", ","), vigenciaInicio: e.vigenciaInicio })}>
                    Editar
                  </button>
                  <button type="button" className="text-destructive underline-offset-2 hover:underline" onClick={() => void excluir(e)}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={rascunho !== null} onClose={() => setRascunho(null)} title={rascunho?.id == null ? "Novo encargo" : "Editar encargo"}>
        {rascunho && (
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="mb-1 block text-muted">Código (minúsculas, números e _)</span>
              <input className={cn(CAMPO, "w-full font-mono")} value={rascunho.codigo} onChange={(e) => setRascunho({ ...rascunho, codigo: e.target.value })} placeholder="ex.: inss_patronal" />
            </label>
            <label className="block">
              <span className="mb-1 block text-muted">Nome</span>
              <input className={cn(CAMPO, "w-full")} value={rascunho.rotulo} onChange={(e) => setRascunho({ ...rascunho, rotulo: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-muted">Percentual (%)</span>
                <input className={cn(CAMPO, "w-full")} inputMode="decimal" value={rascunho.percentual} onChange={(e) => setRascunho({ ...rascunho, percentual: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1 block text-muted">Vigente desde</span>
                <input type="date" className={cn(CAMPO, "w-full")} value={rascunho.vigenciaInicio} onChange={(e) => setRascunho({ ...rascunho, vigenciaInicio: e.target.value })} />
              </label>
            </div>
            {erroForm && <p className="text-destructive">{erroForm}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className={BOTAO} onClick={() => setRascunho(null)}>
                Cancelar
              </button>
              <button type="button" className={BOTAO_PRIMARIO} onClick={() => void salvar()}>
                Salvar
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------- Eventos da folha ----------

const COLUNAS_EVENTO_LOCAIS: ColunaLocal[] = [
  { nome: "tabeve", tipo: "inteiro", obrigatoria: true },
  { nome: "codeve", tipo: "inteiro", obrigatoria: true },
  { nome: "descricao", tipo: "texto" },
  { nome: "tipo", tipo: "texto", obrigatoria: true },
  { nome: "classe", tipo: "texto", obrigatoria: true },
  { nome: "colaboradores", tipo: "inteiro", obrigatoria: true },
  { nome: "valor", tipo: "decimal", obrigatoria: true },
];

const lerEvento = (e: Evento, coluna: string): unknown => {
  if (coluna === "tipo") return rotuloTipoEvento(e.tipeve);
  if (coluna === "classe") return e.classe ? ROTULO_CLASSE[e.classe] : "Ignorado";
  return (e as unknown as Record<string, unknown>)[coluna];
};

interface AcoesEvento {
  classificar: (e: Evento, classe: ClasseEvento | null) => void;
}

const COLUNAS_EVENTO: DefColuna<Evento, AcoesEvento>[] = [
  { nome: "tabeve", titulo: "Tabela", largura: 80, direita: true, classe: "font-mono text-sm tabular-nums text-muted", render: (e) => e.tabeve },
  { nome: "codeve", titulo: "Código", largura: 80, direita: true, classe: "font-mono text-sm tabular-nums text-muted", render: (e) => e.codeve },
  { nome: "descricao", titulo: "Evento", fixa: true, largura: 240, classe: "text-sm text-foreground", render: (e) => e.descricao ?? "(sem cadastro)" },
  { nome: "tipo", titulo: "Tipo no Senior", largura: 170, classe: "text-sm text-muted", render: (e) => rotuloTipoEvento(e.tipeve) },
  { nome: "colaboradores", titulo: "Colaboradores", direita: true, largura: 120, classe: "font-mono text-sm tabular-nums text-muted", render: (e) => e.colaboradores.toLocaleString("pt-BR") },
  { nome: "valor", titulo: "Valor total", direita: true, largura: 150, classe: "font-mono text-sm tabular-nums text-muted", render: (e) => formatarReais(e.valor) },
  {
    nome: "classe",
    titulo: "Conta no custo como",
    largura: 220,
    render: (e, a) => (
      <select
        className={cn(CAMPO, "py-1")}
        value={e.classe ?? ""}
        aria-label={`Classe do evento ${e.descricao ?? e.codeve}`}
        onChange={(ev) => a.classificar(e, ev.target.value === "" ? null : (ev.target.value as ClasseEvento))}
      >
        <option value="">Ignorar</option>
        {(Object.keys(ROTULO_CLASSE) as ClasseEvento[]).map((c) => (
          <option key={c} value={c}>
            {ROTULO_CLASSE[c]}
          </option>
        ))}
      </select>
    ),
  },
];

function AbaEventos({ setErro, aoMudar }: { setErro: (e: string | null) => void; aoMudar: () => Promise<void> }) {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [loading, setLoading] = useState(true);
  const [tipoLote, setTipoLote] = useState("1");
  const [classeLote, setClasseLote] = useState<ClasseEvento>("remuneracao");
  const [sobrescrever, setSobrescrever] = useState(false);

  const carregar = useCallback(() => {
    return axios
      .get<{ eventos: Evento[] }>("/api/custo-hora/eventos")
      .then(({ data }) => setEventos(data.eventos))
      .catch((err) => setErro(mensagemDe(err, "Falha ao carregar os eventos")))
      .finally(() => setLoading(false));
  }, [setErro]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function classificar(e: Evento, classe: ClasseEvento | null) {
    setErro(null);
    try {
      await axios.put(`/api/custo-hora/eventos/${e.tabeve}/${e.codeve}`, { classe });
      await Promise.all([carregar(), aoMudar()]);
    } catch (err) {
      setErro(mensagemDe(err, "Falha ao classificar o evento"));
    }
  }

  async function classificarLote() {
    const tipo = Number(tipoLote);
    const quantos = eventos.filter((e) => e.tipeve === tipo && (sobrescrever || e.classe == null)).length;
    if (!window.confirm(`Marcar ${quantos} evento(s) do tipo "${rotuloTipoEvento(tipo)}" como "${ROTULO_CLASSE[classeLote]}"?`)) return;
    setErro(null);
    try {
      await axios.post("/api/custo-hora/eventos/lote", { tipeve: tipo, classe: classeLote, somenteSemClasse: !sobrescrever });
      await Promise.all([carregar(), aoMudar()]);
    } catch (err) {
      setErro(mensagemDe(err, "Falha ao classificar em lote"));
    }
  }

  const acoes = useMemo<AcoesEvento>(() => ({ classificar: (e, c) => void classificar(e, c) }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const classificados = eventos.filter((e) => e.classe).length;

  return (
    <div className="space-y-4">
      <div className="max-w-3xl space-y-1 text-sm text-muted">
        <p>
          Os eventos que aparecem na folha importada do HCM. Evento sem classe é <b>ignorado</b> no custo. Defina como cada um conta:
        </p>
        <ul className="list-disc pl-5">
          {(Object.keys(ROTULO_CLASSE) as ClasseEvento[]).map((c) => (
            <li key={c}>
              <b className="text-foreground">{ROTULO_CLASSE[c]}</b> — {AJUDA_CLASSE[c]}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
        <span className="text-muted">Marcar de uma vez os eventos do tipo</span>
        <select className={CAMPO} value={tipoLote} onChange={(e) => setTipoLote(e.target.value)} aria-label="Tipo do evento no Senior">
          {Object.entries(ROTULO_TIPO_EVENTO).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <span className="text-muted">como</span>
        <select className={CAMPO} value={classeLote} onChange={(e) => setClasseLote(e.target.value as ClasseEvento)} aria-label="Classe">
          {(Object.keys(ROTULO_CLASSE) as ClasseEvento[]).map((c) => (
            <option key={c} value={c}>
              {ROTULO_CLASSE[c]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-muted">
          <input type="checkbox" checked={sobrescrever} onChange={(e) => setSobrescrever(e.target.checked)} />
          também os já classificados
        </label>
        <button type="button" className={BOTAO} onClick={() => void classificarLote()}>
          Aplicar
        </button>
        <span className="ml-auto text-muted">
          {classificados} de {eventos.length} classificados
        </span>
      </div>

      <TabelaLocal<Evento, AcoesEvento>
        chave="admin.custo-hora.eventos"
        defs={COLUNAS_EVENTO}
        colunas={COLUNAS_EVENTO_LOCAIS}
        linhas={eventos}
        ler={lerEvento}
        chaveLinha={(e) => `${e.tabeve}-${e.codeve}`}
        loading={loading}
        vazio="Nenhum evento de folha importado do HCM."
        ctx={acoes}
        paginacao={{ ...POR_PAGINA, rotulo: "eventos" }}
      />
    </div>
  );
}

// ---------- Parâmetros ----------

function AbaParametros({ config, recarregar, setErro, setAviso }: { config: Config; recarregar: () => Promise<void>; setErro: (e: string | null) => void; setAviso: (a: string | null) => void }) {
  const [valores, setValores] = useState<Record<string, string>>(config.parametros);
  useEffect(() => setValores(config.parametros), [config.parametros]);

  async function salvar(chave: string) {
    setErro(null);
    setAviso(null);
    const texto = (valores[chave] ?? "").trim();
    try {
      await axios.put(`/api/custo-hora/parametros/${chave}`, { valor: texto === "" ? null : texto });
      setAviso(texto === "" ? "Parâmetro removido." : "Parâmetro salvo.");
      await recarregar();
    } catch (err) {
      setErro(mensagemDe(err, "Falha ao salvar o parâmetro"));
    }
  }

  const DICAS: Record<string, string> = {
    horas_mes: "Ex.: as horas da escala do mês. Divide o custo mensal do CLT (e o preço mensal de contrato PJ marcado como mensal).",
    tipos_calculo: "Ex.: 11, 12, 13. Veja os tipos nos cálculos da folha em Importados do HCM › Cálculos de Folha (R044CAL, coluna TipCal).",
  };

  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-sm text-muted">Sem estes dois parâmetros o custo do CLT não é calculado (o PJ e o valor manual não dependem do segundo).</p>
      {Object.entries(config.definicoesParametros).map(([chave, descricao]) => (
        <div key={chave} className="rounded-lg border border-border bg-surface p-4">
          <label className="block text-sm font-medium text-foreground" htmlFor={`param-${chave}`}>
            {descricao}
          </label>
          <p className="mb-2 text-[12px] text-muted">{DICAS[chave]}</p>
          <div className="flex gap-2">
            <input id={`param-${chave}`} className={cn(CAMPO, "w-48 font-mono")} value={valores[chave] ?? ""} onChange={(e) => setValores({ ...valores, [chave]: e.target.value })} />
            <button type="button" className={BOTAO} onClick={() => void salvar(chave)}>
              Salvar
            </button>
          </div>
          <p className="mt-1 text-[11.5px] text-muted">{config.parametros[chave] ? `Valor atual: ${config.parametros[chave]}` : "Não configurado."}</p>
        </div>
      ))}
    </div>
  );
}
