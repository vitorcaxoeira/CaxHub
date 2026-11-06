import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { TabelaLocal } from "../../../components/colunas/TabelaLocal";
import type { ColunaLocal } from "../../../components/colunas/aplicarLocal";
import type { DefColuna } from "../../../components/colunas/useColunasConfiguraveis";
import { classeBotaoPrimario, classeBotaoSecundario, classeCampo, classeRotulo } from "../../../components/gestao5s/campos";
import { Modal } from "../../../components/ui/Modal";
import { useToast } from "../../../components/ui/Toast";
import { classeFiltro, fmtMoeda, mensagemDe } from "./comum";

// Gestão de Descontos › Tipos de desconto (Uniforme, Adiantamento, Uniodonto...). Tipo com lançamento vinculado não se exclui: só se inativa.

interface Tipo {
  id: number;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  permiteParcelamento: boolean;
  maxParcelas: number | null;
  valorMinimo: number | null;
  valorMaximo: number | null;
  exigeObservacao: boolean;
  ordem: number;
  emUso: number;
}

interface Acoes {
  editar: (t: Tipo) => void;
  alternarAtivo: (t: Tipo) => void;
  excluir: (t: Tipo) => void;
}

const LOCAIS: ColunaLocal[] = [
  { nome: "nome", tipo: "texto", obrigatoria: true },
  { nome: "descricao", tipo: "texto" },
  { nome: "situacao", tipo: "texto", obrigatoria: true },
  { nome: "parcelamento", tipo: "texto" },
  { nome: "maxParcelas", tipo: "inteiro" },
  { nome: "valorMinimo", tipo: "decimal" },
  { nome: "valorMaximo", tipo: "decimal" },
  { nome: "observacao", tipo: "texto" },
  { nome: "ordem", tipo: "inteiro" },
  { nome: "emUso", tipo: "inteiro" },
];

const COLUNAS: DefColuna<Tipo, Acoes>[] = [
  { nome: "nome", titulo: "Nome", fixa: true, largura: 200, classe: "text-sm font-medium text-foreground", texto: (t) => t.nome, render: (t) => t.nome },
  { nome: "descricao", titulo: "Descrição", largura: 260, classe: "text-sm text-muted", texto: (t) => t.descricao, render: (t) => t.descricao ?? "—" },
  { nome: "situacao", titulo: "Situação", largura: 100, classe: "text-xs", render: (t) => <span className={t.ativo ? "text-success" : "text-muted"}>{t.ativo ? "Ativo" : "Inativo"}</span> },
  { nome: "parcelamento", titulo: "Parcelamento", largura: 120, classe: "text-sm text-muted", render: (t) => (t.permiteParcelamento ? "Permite" : "Não permite") },
  { nome: "maxParcelas", titulo: "Máx. parcelas", centro: true, largura: 110, classe: "font-mono text-sm text-muted", render: (t) => t.maxParcelas ?? "—" },
  { nome: "valorMinimo", titulo: "Valor mínimo", direita: true, largura: 120, classe: "font-mono text-sm tabular-nums text-muted", render: (t) => (t.valorMinimo == null ? "—" : fmtMoeda(t.valorMinimo)) },
  { nome: "valorMaximo", titulo: "Valor máximo", direita: true, largura: 120, classe: "font-mono text-sm tabular-nums text-muted", render: (t) => (t.valorMaximo == null ? "—" : fmtMoeda(t.valorMaximo)) },
  { nome: "observacao", titulo: "Observação", largura: 120, classe: "text-sm text-muted", render: (t) => (t.exigeObservacao ? "Obrigatória" : "Opcional") },
  { nome: "ordem", titulo: "Ordem", direita: true, largura: 80, classe: "font-mono text-sm tabular-nums text-muted", render: (t) => t.ordem },
  { nome: "emUso", titulo: "Lançamentos", direita: true, largura: 110, classe: "font-mono text-sm tabular-nums text-muted", render: (t) => t.emUso },
  {
    nome: "acoes",
    titulo: "Ações",
    semOrdenar: true,
    direita: true,
    largura: 200,
    render: (t, x) => (
      <span className="whitespace-nowrap text-xs">
        <button type="button" onClick={() => x.editar(t)} className="mr-3 text-primary hover:underline">
          Editar
        </button>
        <button type="button" onClick={() => x.alternarAtivo(t)} className="mr-3 text-muted hover:underline">
          {t.ativo ? "Inativar" : "Ativar"}
        </button>
        <button
          type="button"
          onClick={() => x.excluir(t)}
          disabled={t.emUso > 0}
          title={t.emUso > 0 ? "Já tem lançamentos vinculados: só é possível inativar" : undefined}
          className="text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
        >
          Excluir
        </button>
      </span>
    ),
  },
];

const leitura = (t: Tipo, nome: string): unknown => {
  switch (nome) {
    case "situacao":
      return t.ativo ? "Ativo" : "Inativo";
    case "parcelamento":
      return t.permiteParcelamento ? "Permite" : "Não permite";
    case "observacao":
      return t.exigeObservacao ? "Obrigatória" : "Opcional";
    default:
      return (t as unknown as Record<string, unknown>)[nome];
  }
};

export function DescontosTipos() {
  const { mostrar } = useToast();
  const [tipos, setTipos] = useState<Tipo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState("");
  const [editando, setEditando] = useState<Tipo | "novo" | null>(null);

  const carregar = useCallback(() => {
    axios
      .get<{ tipos: Tipo[] }>("/api/descontos/tipos", { params: { busca: busca.trim() || undefined, ativo: situacao || undefined } })
      .then(({ data }) => {
        setTipos(data.tipos);
        setErro(null);
      })
      .catch((e) => setErro(mensagemDe(e, "Falha ao carregar os tipos de desconto")));
  }, [busca, situacao]);

  useEffect(() => {
    const t = window.setTimeout(carregar, 250);
    return () => window.clearTimeout(t);
  }, [carregar]);

  async function alternarAtivo(t: Tipo) {
    try {
      await axios.put(`/api/descontos/tipos/${t.id}`, { ...t, ativo: !t.ativo });
      mostrar(t.ativo ? "Tipo inativado: não aparece mais em novos lançamentos" : "Tipo ativado", "success");
      carregar();
    } catch (e) {
      mostrar(mensagemDe(e, "Não foi possível alterar o tipo"), "destructive");
    }
  }

  async function excluir(t: Tipo) {
    if (!window.confirm(`Excluir o tipo "${t.nome}"?`)) return;
    try {
      await axios.delete(`/api/descontos/tipos/${t.id}`);
      mostrar("Tipo excluído", "success");
      carregar();
    } catch (e) {
      mostrar(mensagemDe(e, "Não foi possível excluir o tipo"), "destructive");
    }
  }

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão de Projetos · Gestão de Descontos</p>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Tipos de desconto</h1>
          <p className="mt-1 text-sm text-muted">Tipos inativos não aparecem em novos lançamentos. Tipo com lançamento vinculado só pode ser inativado.</p>
        </div>
        <button type="button" onClick={() => setEditando("novo")} className={`${classeBotaoPrimario} min-h-10`}>
          + Novo tipo
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input aria-label="Buscar por nome" className={`${classeFiltro} w-64`} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome…" />
        <select aria-label="Situação" className={classeFiltro} value={situacao} onChange={(e) => setSituacao(e.target.value)}>
          <option value="">Todas as situações</option>
          <option value="true">Ativos</option>
          <option value="false">Inativos</option>
        </select>
      </div>

      {erro && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{erro}</p>}

      <TabelaLocal<Tipo, Acoes>
        chave="projetos.descontos.tipos"
        defs={COLUNAS}
        colunas={LOCAIS}
        linhas={tipos ?? []}
        ler={leitura}
        ctx={{ editar: setEditando, alternarAtivo, excluir }}
        chaveLinha={(t) => String(t.id)}
        loading={!tipos}
        vazio="Nenhum tipo de desconto cadastrado."
      />

      {editando && (
        <FormTipo
          inicial={editando === "novo" ? null : editando}
          onFechar={(salvou) => {
            setEditando(null);
            if (salvou) carregar();
          }}
        />
      )}
    </div>
  );
}

function FormTipo({ inicial, onFechar }: { inicial: Tipo | null; onFechar: (salvou: boolean) => void }) {
  const { mostrar } = useToast();
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);
  const [permiteParcelamento, setPermiteParcelamento] = useState(inicial?.permiteParcelamento ?? true);
  const [maxParcelas, setMaxParcelas] = useState(inicial?.maxParcelas != null ? String(inicial.maxParcelas) : "");
  const [valorMinimo, setValorMinimo] = useState(inicial?.valorMinimo != null ? String(inicial.valorMinimo) : "");
  const [valorMaximo, setValorMaximo] = useState(inicial?.valorMaximo != null ? String(inicial.valorMaximo) : "");
  const [exigeObservacao, setExigeObservacao] = useState(inicial?.exigeObservacao ?? false);
  const [ordem, setOrdem] = useState(String(inicial?.ordem ?? 0));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    const corpo = {
      nome,
      descricao: descricao.trim() || null,
      ativo,
      permiteParcelamento,
      maxParcelas: permiteParcelamento && maxParcelas.trim() ? Number(maxParcelas) : null,
      valorMinimo: valorMinimo.trim() ? Number(valorMinimo.replace(",", ".")) : null,
      valorMaximo: valorMaximo.trim() ? Number(valorMaximo.replace(",", ".")) : null,
      exigeObservacao,
      ordem: Number(ordem) || 0,
    };
    try {
      if (inicial) await axios.put(`/api/descontos/tipos/${inicial.id}`, corpo);
      else await axios.post("/api/descontos/tipos", corpo);
      mostrar("Tipo de desconto salvo", "success");
      onFechar(true);
    } catch (e) {
      setErro(mensagemDe(e, "Não foi possível salvar o tipo"));
      setSalvando(false);
    }
  }

  const caixa = (rotulo: string, marcado: boolean, onChange: (v: boolean) => void) => (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <input type="checkbox" checked={marcado} onChange={(e) => onChange(e.target.checked)} />
      {rotulo}
    </label>
  );

  return (
    <Modal open onClose={() => onFechar(false)} title={inicial ? "Editar tipo de desconto" : "Novo tipo de desconto"} fecharPorFora={false} className="max-w-xl">
      <div className="space-y-3">
        <div>
          <label className={classeRotulo} htmlFor="t-nome">Nome</label>
          <input id="t-nome" className={classeCampo} value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Uniforme, Uniodonto, Adiantamento" />
        </div>
        <div>
          <label className={classeRotulo} htmlFor="t-desc">Descrição (opcional)</label>
          <input id="t-desc" className={classeCampo} value={descricao} maxLength={250} onChange={(e) => setDescricao(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={classeRotulo} htmlFor="t-max">Limite de parcelas</label>
            <input id="t-max" className={classeCampo} type="number" min={1} value={maxParcelas} onChange={(e) => setMaxParcelas(e.target.value)} disabled={!permiteParcelamento} placeholder="Sem limite" />
          </div>
          <div>
            <label className={classeRotulo} htmlFor="t-min">Valor mínimo (R$)</label>
            <input id="t-min" className={classeCampo} inputMode="decimal" value={valorMinimo} onChange={(e) => setValorMinimo(e.target.value)} placeholder="—" />
          </div>
          <div>
            <label className={classeRotulo} htmlFor="t-maxv">Valor máximo (R$)</label>
            <input id="t-maxv" className={classeCampo} inputMode="decimal" value={valorMaximo} onChange={(e) => setValorMaximo(e.target.value)} placeholder="—" />
          </div>
        </div>
        <div>
          <label className={classeRotulo} htmlFor="t-ordem">Ordem de exibição</label>
          <input id="t-ordem" className={`${classeCampo} max-w-28`} type="number" value={ordem} onChange={(e) => setOrdem(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          {caixa("Ativo (aparece em novos lançamentos)", ativo, setAtivo)}
          {caixa("Permite parcelamento", permiteParcelamento, setPermiteParcelamento)}
          {caixa("Exigir observação no lançamento", exigeObservacao, setExigeObservacao)}
        </div>
        {erro && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={() => onFechar(false)} disabled={salvando} className={classeBotaoSecundario}>
            Cancelar
          </button>
          <button type="button" onClick={salvar} disabled={salvando || !nome.trim()} className={classeBotaoPrimario}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
