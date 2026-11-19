import axios from "axios";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal } from "../../components/ui/Modal";
import { SeletorContas } from "../../components/rentabilidade/SeletorContas";
import { Skeleton } from "../../components/ui/Skeleton";
import { CONTROLE } from "../../components/ui/estilos";
import { cn } from "../../lib/cn";
import { analisarFormula, FUNCOES, type ColunaDisponivel } from "../../lib/formulas/formula";
import { normalizar } from "../../lib/normalizarBusca";
import {
  mesAnterior,
  ROTULO_BASE,
  ROTULO_FORMATO,
  ROTULO_NATUREZA,
  ROTULO_TIPO,
  type BaseIndicador,
  type ContaDoPlano,
  type FormatoIndicador,
  type Indicador,
  type NaturezaIndicador,
  type RegraConta,
  type TipoIndicador,
} from "../../lib/rentabilidade";

type Fontes = Record<string, string>;

interface Rascunho {
  id: number | null;
  codigo: string;
  rotulo: string;
  tipo: TipoIndicador;
  base: BaseIndicador;
  natureza: NaturezaIndicador;
  formato: FormatoIndicador;
  formulaTexto: string;
  fonte: string;
  ordem: number;
  visivel: boolean;
  contas: RegraConta[];
}

const BOTAO = "rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground transition hover:border-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const BOTAO_PRIMARIO = "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const CAMPO = "w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const CHIP = "rounded border border-border bg-surface-2/60 px-1.5 py-0.5 text-[11.5px] text-foreground transition hover:border-primary hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const ERRO_BOX = "rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive";

const CODEMP = 1;

const vazio = (ordem: number): Rascunho => ({ id: null, codigo: "", rotulo: "", tipo: "contas", base: "realizado", natureza: "ambos", formato: "moeda", formulaTexto: "", fonte: "", ordem, visivel: true, contas: [] });

const doIndicador = (i: Indicador): Rascunho => ({
  id: i.id,
  codigo: i.codigo,
  rotulo: i.rotulo,
  tipo: i.tipo,
  base: i.base,
  natureza: i.natureza,
  formato: i.formato,
  formulaTexto: i.formulaTexto ?? "",
  fonte: i.fonte ?? "",
  ordem: i.ordem,
  visivel: i.visivel,
  contas: i.contas,
});

function resumo(i: Indicador, fontes: Fontes): string {
  if (i.tipo === "formula") return i.formulaTexto ?? "";
  if (i.tipo === "sistema") return fontes[i.fonte ?? ""] ?? i.fonte ?? "";
  const inc = i.contas.filter((c) => c.acao === "incluir").length;
  const exc = i.contas.length - inc;
  return `${ROTULO_BASE[i.base]} · ${ROTULO_NATUREZA[i.natureza]} · ${inc} conta${inc === 1 ? "" : "s"} incluída${inc === 1 ? "" : "s"}${exc ? `, ${exc} excluída${exc === 1 ? "" : "s"}` : ""}`;
}

// Administração › Indicadores de Rentabilidade (17/11/2026). Aqui se configura QUAIS contas e QUAIS fórmulas formam cada coluna da Rentabilidade por CC:
// nada disso mora no código. O BI de origem usa listas fixas de contas; esta tela as substitui, e "Importar JSON" traz a configuração do BI de uma vez.
export function IndicadoresRentabilidade() {
  const [indicadores, setIndicadores] = useState<Indicador[]>([]);
  const [fontes, setFontes] = useState<Fontes>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<Rascunho | null>(null);
  const [excluindo, setExcluindo] = useState<Indicador | null>(null);
  const [importando, setImportando] = useState(false);
  const [diagnostico, setDiagnostico] = useState(false);
  const [plano, setPlano] = useState<ContaDoPlano[] | null>(null);

  function carregar() {
    setCarregando(true);
    axios
      .get<{ indicadores: Indicador[]; fontes: Fontes }>("/api/rentabilidade/indicadores")
      .then(({ data }) => {
        setIndicadores(data.indicadores);
        setFontes(data.fontes);
        setErro(null);
      })
      .catch((e) => setErro(e.response?.data?.error ?? "Falha ao carregar os indicadores"))
      .finally(() => setCarregando(false));
  }
  useEffect(carregar, []);

  function carregarPlano() {
    if (plano) return;
    axios
      .get<{ contas: ContaDoPlano[] }>("/api/rentabilidade/plano")
      .then(({ data }) => setPlano(data.contas))
      .catch((e) => setErro(e.response?.data?.error ?? "Falha ao carregar o plano de contas"));
  }

  const proximaOrdem = useMemo(() => (indicadores.reduce((m, i) => Math.max(m, i.ordem), 0) || 0) + 10, [indicadores]);

  function exportar() {
    axios
      .get("/api/rentabilidade/exportar")
      .then(({ data }) => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = "indicadores-rentabilidade.json";
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch((e) => setErro(e.response?.data?.error ?? "Falha ao exportar"));
  }

  function excluir() {
    if (!excluindo) return;
    const alvo = excluindo;
    axios
      .delete(`/api/rentabilidade/indicadores/${alvo.id}`)
      .then(() => {
        setExcluindo(null);
        setAviso(`Indicador ${alvo.codigo} excluído.`);
        carregar();
      })
      .catch((e) => {
        setExcluindo(null);
        setErro(e.response?.data?.error ?? "Falha ao excluir");
      });
  }

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Administração · Contábil · Indicadores de Rentabilidade</p>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-foreground">Indicadores de Rentabilidade</h1>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BOTAO} onClick={() => setDiagnostico(true)}>
            Diagnóstico de contas
          </button>
          <button type="button" className={BOTAO} onClick={() => setImportando(true)}>
            Importar JSON
          </button>
          <button type="button" className={BOTAO} onClick={exportar} disabled={indicadores.length === 0}>
            Exportar JSON
          </button>
          <button
            type="button"
            className={BOTAO_PRIMARIO}
            onClick={() => {
              carregarPlano();
              setEditando(vazio(proximaOrdem));
            }}
          >
            Novo indicador
          </button>
        </div>
      </div>
      <p className="mb-6 max-w-3xl text-sm text-muted">
        Cada indicador é uma coluna da <b>Rentabilidade por CC</b>: uma <b>soma de contas</b> (qualquer nível do plano: a conta sintética vale por todas as analíticas abaixo dela), uma
        <b> fórmula</b> sobre outros indicadores ou um <b>campo do sistema</b> (horas do Kyria e de RAT). Nenhuma conta fica no código: o que está aqui é o que o cálculo usa.
      </p>

      {erro && (
        <p className={cn(ERRO_BOX, "mb-4")} role="alert">
          {erro}
        </p>
      )}
      {aviso && <p className="mb-4 rounded-md border border-border bg-surface-2 px-4 py-2.5 text-sm text-foreground">{aviso}</p>}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {["Ordem", "Nome", "Código", "Tipo", "Como é calculado", "Formato", ""].map((h) => (
                  <th key={h} className="bg-surface-2 px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {carregando &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td colSpan={7} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))}
              {!carregando && indicadores.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted">
                    Nenhum indicador ainda. Use <b>Importar JSON</b> para trazer a configuração do BI, ou <b>Novo indicador</b>.
                  </td>
                </tr>
              )}
              {!carregando &&
                indicadores.map((i) => (
                  <tr key={i.id} className="border-t border-border/60 align-top hover:bg-surface-2">
                    <td className="px-4 py-3 font-mono text-xs text-muted">{i.ordem}</td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {i.rotulo}
                      {!i.visivel && <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-normal text-muted">oculto</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">{i.codigo}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{ROTULO_TIPO[i.tipo]}</td>
                    <td className="max-w-md px-4 py-3 text-muted">
                      <span className={i.tipo === "formula" ? "font-mono text-xs" : ""}>{resumo(i, fontes)}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{ROTULO_FORMATO[i.formato]}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        type="button"
                        className="mr-2 text-primary underline-offset-2 hover:underline"
                        onClick={() => {
                          carregarPlano();
                          setEditando(doIndicador(i));
                        }}
                      >
                        Editar
                      </button>
                      <button type="button" className="text-destructive underline-offset-2 hover:underline" onClick={() => setExcluindo(i)}>
                        Excluir
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {editando && (
        <EditorIndicador
          rascunho={editando}
          indicadores={indicadores}
          fontes={fontes}
          plano={plano}
          onFechar={() => setEditando(null)}
          onSalvo={(msg) => {
            setEditando(null);
            setAviso(msg);
            setErro(null);
            carregar();
          }}
        />
      )}

      <Modal open={!!excluindo} onClose={() => setExcluindo(null)} title="Excluir indicador">
        <p className="mb-4 text-sm text-foreground">
          Excluir <b>{excluindo?.rotulo}</b> ({excluindo?.codigo})? A configuração de contas dele se perde. Se alguma fórmula usa este indicador, o servidor recusa.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTAO} onClick={() => setExcluindo(null)}>
            Cancelar
          </button>
          <button type="button" className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white hover:opacity-90" onClick={excluir}>
            Excluir
          </button>
        </div>
      </Modal>

      {importando && (
        <ModalImportar
          existentes={indicadores.length}
          onFechar={() => setImportando(false)}
          onImportado={(msg) => {
            setImportando(false);
            setAviso(msg);
            setErro(null);
            carregar();
          }}
        />
      )}
      {diagnostico && <ModalDiagnostico onFechar={() => setDiagnostico(false)} />}
    </div>
  );
}

// ---------- editor ----------

function Campo({ rotulo, children, dica }: { rotulo: string; children: ReactNode; dica?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {rotulo}
      {children}
      {dica && <span className="text-[11px] text-muted/80">{dica}</span>}
    </label>
  );
}

function EditorIndicador({
  rascunho,
  indicadores,
  fontes,
  plano,
  onFechar,
  onSalvo,
}: {
  rascunho: Rascunho;
  indicadores: Indicador[];
  fontes: Fontes;
  plano: ContaDoPlano[] | null;
  onFechar: () => void;
  onSalvo: (mensagem: string) => void;
}) {
  const [d, setD] = useState<Rascunho>(rascunho);
  const [gravando, setGravando] = useState(false);
  const [erroServidor, setErroServidor] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const novo = d.id === null;

  const outros = useMemo(() => indicadores.filter((i) => i.id !== d.id), [indicadores, d.id]);
  const colunas: ColunaDisponivel[] = useMemo(() => outros.map((i) => ({ nome: i.codigo, titulo: i.rotulo, tipo: "decimal" })), [outros]);
  const analise = useMemo(() => (d.tipo === "formula" && d.formulaTexto.trim() ? analisarFormula(d.formulaTexto, colunas) : null), [d.tipo, d.formulaTexto, colunas]);

  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setD((a) => ({ ...a, [k]: v }));

  const inserir = (texto: string) => {
    const el = area.current;
    const ini = el?.selectionStart ?? d.formulaTexto.length;
    const fim = el?.selectionEnd ?? d.formulaTexto.length;
    set("formulaTexto", d.formulaTexto.slice(0, ini) + texto + d.formulaTexto.slice(fim));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(ini + texto.length, ini + texto.length);
    });
  };

  const problema = (() => {
    if (!d.codigo.trim()) return "Informe o código.";
    if (!d.rotulo.trim()) return "Informe o nome.";
    if (d.tipo === "formula") {
      if (!d.formulaTexto.trim()) return "Escreva a fórmula.";
      if (analise && !analise.ok) return analise.erro;
    }
    if (d.tipo === "sistema" && !d.fonte) return "Escolha o campo do sistema.";
    return null;
  })();

  function salvar() {
    if (problema) return;
    setGravando(true);
    setErroServidor(null);
    const corpo = {
      codigo: d.codigo.trim(),
      rotulo: d.rotulo.trim(),
      tipo: d.tipo,
      base: d.base,
      natureza: d.base === "orcado" ? "ambos" : d.natureza,
      formato: d.formato,
      formulaTexto: d.tipo === "formula" ? d.formulaTexto.trim() : null,
      formulaArvore: d.tipo === "formula" && analise?.ok ? analise.arvore : null,
      fonte: d.tipo === "sistema" ? d.fonte : null,
      ordem: d.ordem,
      visivel: d.visivel,
      contas: d.tipo === "contas" ? d.contas : [],
    };
    const req = novo ? axios.post("/api/rentabilidade/indicadores", corpo) : axios.put(`/api/rentabilidade/indicadores/${d.id}`, corpo);
    req
      .then(() => onSalvo(`Indicador ${corpo.codigo} ${novo ? "criado" : "salvo"}.`))
      .catch((e) => setErroServidor(e.response?.data?.error ?? "Falha ao salvar"))
      .finally(() => setGravando(false));
  }

  return (
    <Modal open onClose={onFechar} title={novo ? "Novo indicador" : `Editar ${rascunho.rotulo}`} className="max-w-3xl" fecharPorFora={false}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Nome na tela">
            <input id="ind-rotulo" className={CAMPO} value={d.rotulo} onChange={(e) => set("rotulo", e.target.value)} maxLength={80} />
          </Campo>
          <Campo rotulo="Código (usado nas fórmulas)" dica="Começa por letra; letras, números e _.">
            <input id="ind-codigo" className={cn(CAMPO, "font-mono")} value={d.codigo} onChange={(e) => set("codigo", e.target.value)} maxLength={40} />
          </Campo>
          <Campo rotulo="Tipo">
            <select id="ind-tipo" className={CONTROLE} value={d.tipo} onChange={(e) => set("tipo", e.target.value as TipoIndicador)}>
              {(Object.keys(ROTULO_TIPO) as TipoIndicador[]).map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO[t]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Formato">
            <select id="ind-formato" className={CONTROLE} value={d.formato} onChange={(e) => set("formato", e.target.value as FormatoIndicador)}>
              {(Object.keys(ROTULO_FORMATO) as FormatoIndicador[]).map((f) => (
                <option key={f} value={f}>
                  {ROTULO_FORMATO[f]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Ordem na tela">
            <input id="ind-ordem" type="number" min={0} className={CAMPO} value={d.ordem} onChange={(e) => set("ordem", Number(e.target.value) || 0)} />
          </Campo>
          <label className="flex items-center gap-2 pt-5 text-sm text-foreground">
            <input id="ind-visivel" type="checkbox" checked={d.visivel} onChange={(e) => set("visivel", e.target.checked)} />
            Aparece na tela de resultado (desmarque para usar só como insumo de fórmula)
          </label>
        </div>

        {d.tipo === "contas" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Base">
                <select id="ind-base" className={CONTROLE} value={d.base} onChange={(e) => set("base", e.target.value as BaseIndicador)}>
                  {(Object.keys(ROTULO_BASE) as BaseIndicador[]).map((b) => (
                    <option key={b} value={b}>
                      {ROTULO_BASE[b]}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Lado do lançamento" dica={d.base === "orcado" ? "O orçado não tem débito/crédito." : undefined}>
                <select id="ind-natureza" className={CONTROLE} value={d.base === "orcado" ? "ambos" : d.natureza} disabled={d.base === "orcado"} onChange={(e) => set("natureza", e.target.value as NaturezaIndicador)}>
                  {(Object.keys(ROTULO_NATUREZA) as NaturezaIndicador[]).map((n) => (
                    <option key={n} value={n}>
                      {ROTULO_NATUREZA[n]}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            <SeletorContas plano={plano} regras={d.contas} onChange={(r) => set("contas", r)} />
          </>
        )}

        {d.tipo === "formula" && (
          <div className="flex flex-col gap-2">
            <Campo rotulo="Fórmula" dica="Indicadores entre colchetes, funções com argumentos separados por ponto e vírgula. TOTAL([x]) é o total de x em todas as linhas do recorte.">
              <textarea
                id="ind-formula"
                ref={area}
                className={cn(CAMPO, "min-h-[84px] font-mono text-[13px]")}
                value={d.formulaTexto}
                onChange={(e) => set("formulaTexto", e.target.value)}
                spellCheck={false}
                placeholder="[Receita] - ABS([Custos])"
              />
            </Campo>
            {analise && !analise.ok && (
              <p className="text-xs text-destructive" role="alert">
                {analise.erro}
                {analise.posicao !== null ? ` (posição ${analise.posicao + 1})` : ""}
              </p>
            )}
            {analise?.ok && <p className="text-xs text-muted">Fórmula válida.</p>}
            <div className="flex flex-wrap gap-1.5" aria-label="Indicadores disponíveis">
              {outros.map((i) => (
                <button key={i.id} type="button" className={CHIP} title={i.rotulo} onClick={() => inserir(`[${i.codigo}]`)}>
                  {i.codigo}
                </button>
              ))}
              {outros.length === 0 && <span className="text-xs text-muted">Cadastre os outros indicadores primeiro para citá-los aqui.</span>}
            </div>
            <div className="flex flex-wrap gap-1.5" aria-label="Funções">
              {FUNCOES.filter((f) => ["ABS", "TOTAL", "SE", "SEVAZIO", "MIN", "MAX", "ARRED"].includes(f.nome)).map((f) => (
                <button key={f.nome} type="button" className={CHIP} title={f.descricao} onClick={() => inserir(f.nome === "TOTAL" ? "TOTAL([" : `${f.nome}(`)}>
                  {f.assinatura}
                </button>
              ))}
            </div>
          </div>
        )}

        {d.tipo === "sistema" && (
          <Campo rotulo="Campo do sistema" dica="O CC vem do cadastro: do cliente do ticket (Kyria) ou do projeto da RAT. Ainda não filtram por setor.">
            <select id="ind-fonte" className={CONTROLE} value={d.fonte} onChange={(e) => set("fonte", e.target.value)}>
              <option value="">Escolha…</option>
              {Object.entries(fontes).map(([k, v]) => (
                <option key={k} value={k}>
                  {k} · {v}
                </option>
              ))}
            </select>
          </Campo>
        )}

        {erroServidor && (
          <p className={ERRO_BOX} role="alert">
            {erroServidor}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-destructive">{problema && (d.codigo || d.rotulo || d.formulaTexto) ? problema : ""}</span>
          <div className="flex gap-2">
            <button type="button" className={BOTAO} onClick={onFechar}>
              Cancelar
            </button>
            <button type="button" className={BOTAO_PRIMARIO} disabled={!!problema || gravando} onClick={salvar}>
              {gravando ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------- importar ----------

interface ItemArquivo {
  codigo?: string;
  rotulo?: string;
  tipo?: string;
  formula?: string | null;
  [k: string]: unknown;
}

function ModalImportar({ existentes, onFechar, onImportado }: { existentes: number; onFechar: () => void; onImportado: (mensagem: string) => void }) {
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [payload, setPayload] = useState<Record<string, unknown>[] | null>(null);
  const [problemas, setProblemas] = useState<string[]>([]);
  const [modo, setModo] = useState<"substituir" | "mesclar">("substituir");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function lerArquivo(arquivo: File) {
    setNomeArquivo(arquivo.name);
    setPayload(null);
    setErro(null);
    try {
      const doc = JSON.parse(await arquivo.text()) as { indicadores?: ItemArquivo[] };
      if (!Array.isArray(doc.indicadores) || doc.indicadores.length === 0) throw new Error("O arquivo não tem a lista \"indicadores\".");
      // Leitor de texto de fórmula é o da tela (o servidor só aceita a árvore): cada fórmula é lida aqui contra os códigos do próprio arquivo.
      const colunas: ColunaDisponivel[] = doc.indicadores.map((i) => ({ nome: String(i.codigo ?? ""), titulo: String(i.rotulo ?? i.codigo ?? ""), tipo: "decimal" }));
      const erros: string[] = [];
      const itens = doc.indicadores.map((i) => {
        let formulaArvore: unknown = null;
        if (i.tipo === "formula") {
          const a = analisarFormula(String(i.formula ?? ""), colunas);
          if (a.ok) formulaArvore = a.arvore;
          else erros.push(`${i.codigo}: ${a.erro}`);
        }
        return { ...i, formulaTexto: i.formula ?? null, formulaArvore };
      });
      setProblemas(erros);
      setPayload(itens);
    } catch (e) {
      setProblemas([e instanceof Error ? e.message : "Arquivo inválido"]);
    }
  }

  function importar() {
    if (!payload) return;
    setEnviando(true);
    setErro(null);
    axios
      .post<{ importados: number; mantidos: number; contasForaDoPlano: number[] }>("/api/rentabilidade/importar", { modo, indicadores: payload })
      .then(({ data }) => {
        const fora = data.contasForaDoPlano.length ? ` Contas citadas que não existem no plano atual: ${data.contasForaDoPlano.join(", ")}.` : "";
        onImportado(`${data.importados} indicador${data.importados === 1 ? "" : "es"} importado${data.importados === 1 ? "" : "s"}${data.mantidos ? `, ${data.mantidos} mantido${data.mantidos === 1 ? "" : "s"}` : ""}.${fora}`);
      })
      .catch((e) => setErro(e.response?.data?.error ?? "Falha ao importar"))
      .finally(() => setEnviando(false));
  }

  return (
    <Modal open onClose={onFechar} title="Importar configuração (JSON)" fecharPorFora={false}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Arquivo no mesmo formato do <b>Exportar JSON</b>. As fórmulas são lidas aqui, antes de enviar; nada é gravado até você confirmar.</p>
        <input id="imp-arquivo" type="file" accept="application/json,.json" onChange={(e) => e.target.files?.[0] && lerArquivo(e.target.files[0])} className="text-sm" />
        {nomeArquivo && payload && problemas.length === 0 && (
          <p className="text-sm text-foreground">
            <b>{nomeArquivo}</b>: {payload.length} indicadores ({(payload as ItemArquivo[]).filter((p) => p.tipo === "contas").length} de contas, {(payload as ItemArquivo[]).filter((p) => p.tipo === "formula").length} fórmulas,{" "}
            {(payload as ItemArquivo[]).filter((p) => p.tipo === "sistema").length} do sistema).
          </p>
        )}
        {problemas.length > 0 && (
          <ul className={cn(ERRO_BOX, "list-disc pl-8")}>
            {problemas.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <fieldset className="flex flex-col gap-1.5 text-sm text-foreground">
          <legend className="mb-1 text-xs text-muted">O que fazer com os {existentes} indicadores atuais</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="modo-importar" checked={modo === "substituir"} onChange={() => setModo("substituir")} /> Substituir tudo pelo arquivo
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="modo-importar" checked={modo === "mesclar"} onChange={() => setModo("mesclar")} /> Mesclar: o que está no arquivo troca pelo mesmo código, o resto fica
          </label>
        </fieldset>
        {erro && (
          <p className={ERRO_BOX} role="alert">
            {erro}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTAO} onClick={onFechar}>
            Cancelar
          </button>
          <button type="button" className={BOTAO_PRIMARIO} disabled={!payload || problemas.length > 0 || enviando} onClick={importar}>
            {enviando ? "Importando…" : modo === "substituir" && existentes > 0 ? "Substituir e importar" : "Importar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- diagnóstico ----------

interface RespostaDiagnostico {
  semIndicador: { codemp: number; ctared: number; clacta: string; descta: string; valor: number }[];
  emMaisDeUm: { codemp: number; ctared: number; clacta: string; descta: string; indicadores: string[] }[];
}

function ModalDiagnostico({ onFechar }: { onFechar: () => void }) {
  const [mes, setMes] = useState(mesAnterior());
  const [dados, setDados] = useState<RespostaDiagnostico | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!mes) return;
    let cancelado = false;
    setCarregando(true);
    axios
      .get<RespostaDiagnostico>("/api/rentabilidade/diagnostico", { params: { inicio: mes, fim: mes } })
      .then(({ data }) => !cancelado && (setDados(data), setErro(null)))
      .catch((e) => !cancelado && setErro(e.response?.data?.error ?? "Falha no diagnóstico"))
      .finally(() => !cancelado && setCarregando(false));
    return () => {
      cancelado = true;
    };
  }, [mes]);

  const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  return (
    <Modal open onClose={onFechar} title="Diagnóstico de contas" subtitulo="O que a configuração deixa de fora ou conta em dobro" className="max-w-3xl">
      <div className="flex flex-col gap-4">
        <Campo rotulo="Mês analisado">
          <input id="diag-mes" type="month" className={cn(CONTROLE, "w-44")} value={mes} onChange={(e) => setMes(e.target.value)} />
        </Campo>
        {erro && <p className={ERRO_BOX}>{erro}</p>}
        {carregando && <Skeleton className="h-24 w-full" />}
        {!carregando && dados && (
          <>
            <section>
              <h3 className="mb-1 text-sm font-semibold text-foreground">Contas em mais de um indicador ({dados.emMaisDeUm.length})</h3>
              <p className="mb-2 text-xs text-muted">Entram duas vezes se os indicadores forem somados na mesma fórmula. Variantes de um indicador (só débito, só crédito) não contam.</p>
              {dados.emMaisDeUm.length === 0 ? (
                <p className="text-sm text-muted">Nenhuma.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-[13px]">
                  {dados.emMaisDeUm.map((d) => (
                    <li key={d.ctared}>
                      <span className="font-mono text-xs text-muted">{d.clacta}</span> {d.descta} <span className="text-xs text-muted">({d.ctared})</span> → <span className="font-mono text-xs">{d.indicadores.join("  e  ")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className="mb-1 text-sm font-semibold text-foreground">Contas com movimento sem nenhum indicador ({dados.semIndicador.length})</h3>
              <p className="mb-2 text-xs text-muted">Contas analíticas com lançamento no mês que nenhum indicador de soma pega. Ordenadas pelo valor.</p>
              {dados.semIndicador.length === 0 ? (
                <p className="text-sm text-muted">Nenhuma.</p>
              ) : (
                <div className="max-h-72 overflow-auto rounded-md border border-border">
                  <table className="w-full text-[13px]">
                    <tbody>
                      {dados.semIndicador.map((d) => (
                        <tr key={d.ctared} className="border-b border-border/50 last:border-b-0">
                          <td className="px-3 py-1.5">
                            <span className="font-mono text-xs text-muted">{d.clacta}</span> {d.descta} <span className="text-xs text-muted">({d.ctared})</span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{moeda.format(d.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
