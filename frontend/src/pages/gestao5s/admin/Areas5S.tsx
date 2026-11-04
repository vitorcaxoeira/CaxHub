import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { classeBotaoPrimario, classeBotaoSecundario, classeCampo, classeRotulo } from "../../../components/gestao5s/campos";
import { Modal } from "../../../components/ui/Modal";
import { TabelaLocal } from "../../../components/colunas/TabelaLocal";
import type { ColunaLocal } from "../../../components/colunas/aplicarLocal";
import type { DefColuna } from "../../../components/colunas/useColunasConfiguraveis";
import { Skeleton } from "../../../components/ui/Skeleton";
import { useToast } from "../../../components/ui/Toast";
import { mensagemDeErro } from "../../../utils/gestao5s";
import { TIPO_AREA_ROTULO, TipoArea } from "../../../utils/gestao5s";

interface Area {
  id: number;
  nome: string;
  tipo: TipoArea;
  setorVinculadoId: number | null;
  setorVinculadoNome: string | null;
  ativo: boolean;
  ordem: number;
  ehAgrupadora: boolean;
  vinculados: { id: number; nome: string }[];
}

// Cadastro de setores/áreas e ambientes comuns que entram nas auditorias. Um ambiente comum pode
// ficar vinculado a um setor (o líder desse setor passa a ver o ambiente); sem vínculo, é
// compartilhado e todos os líderes o enxergam.

// Cadastro de áreas com filtro e ordem por coluna e colunas configuráveis (TabelaLocal, 03/11/2026). As ações da linha vêm por ctx.
interface AcoesArea {
  editar: (a: Area) => void;
  alternarAtivo: (a: Area) => void;
  excluir: (a: Area) => void;
}
const LOCAIS_AREAS: ColunaLocal[] = [
  { nome: "nome", tipo: "texto", obrigatoria: true },
  { nome: "tipoRotulo", tipo: "texto", obrigatoria: true },
  { nome: "setorVinculadoNome", tipo: "texto" },
  { nome: "situacao", tipo: "texto", obrigatoria: true },
  { nome: "ordem", tipo: "inteiro", obrigatoria: true },
];
const COLUNAS_AREAS: DefColuna<Area, AcoesArea>[] = [
  { nome: "nome", titulo: "Nome", fixa: true, largura: 240, classe: "text-sm font-medium text-foreground", texto: (a) => a.nome, render: (a) => a.nome },
  {
    nome: "tipoRotulo",
    titulo: "Tipo",
    largura: 220,
    classe: "text-sm text-muted",
    render: (a) => (
      <>
        {TIPO_AREA_ROTULO[a.tipo]}
        {a.ehAgrupadora && <span className="ml-2 text-[11px] text-primary">agrupa {a.vinculados.length} ambiente(s)</span>}
      </>
    ),
  },
  { nome: "setorVinculadoNome", titulo: "Vinculado a", largura: 180, classe: "text-sm text-muted", render: (a) => a.setorVinculadoNome ?? "—" },
  { nome: "situacao", titulo: "Situação", largura: 100, classe: "text-xs", render: (a) => <span className={a.ativo ? "text-success" : "text-muted"}>{a.ativo ? "Ativa" : "Inativa"}</span> },
  { nome: "ordem", titulo: "Ordem", direita: true, largura: 70, classe: "text-sm tabular-nums text-muted", render: (a) => a.ordem },
  {
    nome: "acoes",
    titulo: "Ações",
    semOrdenar: true,
    direita: true,
    largura: 200,
    render: (a, x) => (
      <span className="whitespace-nowrap text-xs">
        <button type="button" onClick={() => x.editar(a)} className="mr-3 text-primary hover:underline">
          Editar
        </button>
        <button type="button" onClick={() => x.alternarAtivo(a)} className="mr-3 text-muted hover:underline">
          {a.ativo ? "Desativar" : "Ativar"}
        </button>
        <button type="button" onClick={() => x.excluir(a)} className="text-destructive hover:underline">
          Excluir
        </button>
      </span>
    ),
  },
];
export function Areas5S() {
  const { mostrar } = useToast();
  const [areas, setAreas] = useState<Area[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Area | "nova" | null>(null);

  const carregar = useCallback(() => {
    axios
      .get<Area[]>("/api/5s/areas", { params: { incluirInativas: true } })
      .then(({ data }) => {
        setAreas(data);
        setErro(null);
      })
      .catch((err) => setErro(mensagemDeErro(err, "Falha ao carregar as áreas")));
  }, []);

  useEffect(carregar, [carregar]);

  async function alternarAtivo(a: Area) {
    try {
      await axios.put(`/api/5s/areas/${a.id}`, { nome: a.nome, tipo: a.tipo, setorVinculadoId: a.setorVinculadoId, ordem: a.ordem, ativo: !a.ativo });
      carregar();
    } catch (err) {
      mostrar(mensagemDeErro(err, "Não foi possível alterar"), "destructive");
    }
  }

  async function excluir(a: Area) {
    if (!window.confirm(`Excluir "${a.nome}"?`)) return;
    try {
      await axios.delete(`/api/5s/areas/${a.id}`);
      mostrar("Área excluída", "success");
      carregar();
    } catch (err) {
      mostrar(mensagemDeErro(err, "Não foi possível excluir"), "destructive");
    }
  }

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão 5S · Cadastros</p>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-foreground">Áreas e ambientes</h1>
        <button type="button" onClick={() => setEditando("nova")} className={`${classeBotaoPrimario} min-h-10`}>
          + Nova área
        </button>
      </div>

      {erro && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{erro}</p>}

      <TabelaLocal<Area, AcoesArea>
        chave="gestao5s.areas"
        defs={COLUNAS_AREAS}
        colunas={LOCAIS_AREAS}
        linhas={areas ?? []}
        ler={(a, nome) => (nome === "tipoRotulo" ? TIPO_AREA_ROTULO[a.tipo] : nome === "situacao" ? (a.ativo ? "Ativa" : "Inativa") : (a as unknown as Record<string, unknown>)[nome])}
        ctx={{ editar: setEditando, alternarAtivo, excluir }}
        chaveLinha={(a) => String(a.id)}
        loading={!areas}
        vazio="Nenhuma área cadastrada."
        alturaMax="max-h-[70vh]"
      />

      {editando && (
        <FormArea
          inicial={editando === "nova" ? null : editando}
          setores={(areas ?? []).filter((a) => a.tipo === "setor")}
          onFechar={(salvou) => {
            setEditando(null);
            if (salvou) carregar();
          }}
        />
      )}
    </div>
  );
}

function FormArea({ inicial, setores, onFechar }: { inicial: Area | null; setores: Area[]; onFechar: (salvou: boolean) => void }) {
  const { mostrar } = useToast();
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [tipo, setTipo] = useState<TipoArea>(inicial?.tipo ?? "setor");
  const [vinculo, setVinculo] = useState(inicial?.setorVinculadoId ? String(inicial.setorVinculadoId) : "");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      const corpo = { nome, tipo, setorVinculadoId: tipo === "comum" && vinculo ? Number(vinculo) : null, ordem: inicial?.ordem ?? 0, ativo: inicial?.ativo ?? true };
      if (inicial) await axios.put(`/api/5s/areas/${inicial.id}`, corpo);
      else await axios.post("/api/5s/areas", corpo);
      mostrar("Área salva", "success");
      onFechar(true);
    } catch (err) {
      mostrar(mensagemDeErro(err, "Não foi possível salvar"), "destructive");
      setSalvando(false);
    }
  }

  return (
    <Modal open onClose={() => onFechar(false)} title={inicial ? "Editar área" : "Nova área"} fecharPorFora={false}>
      <div className="space-y-3">
        <div>
          <label className={classeRotulo}>Nome</label>
          <input className={classeCampo} value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Administrativo, Copa e cozinha" />
        </div>
        <div>
          <label className={classeRotulo}>Tipo</label>
          <select className={classeCampo} value={tipo} onChange={(e) => setTipo(e.target.value as TipoArea)}>
            <option value="setor">Setor</option>
            <option value="comum">Ambiente comum</option>
          </select>
        </div>
        {tipo === "comum" && (
          <div>
            <label className={classeRotulo}>Vincular a um setor (opcional)</label>
            <p className="mb-1.5 text-[11px] text-muted">
              O resultado do ambiente acumula no setor escolhido. Esse setor passa a ser um agrupador: não tem perguntas próprias e avaliá-lo abre uma avaliação por ambiente.
            </p>
            <select className={classeCampo} value={vinculo} onChange={(e) => setVinculo(e.target.value)}>
              <option value="">Compartilhado (todos os líderes veem)</option>
              {setores
                .filter((s) => s.id !== inicial?.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
            </select>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => onFechar(false)} className={classeBotaoSecundario}>
            Cancelar
          </button>
          <button type="button" disabled={salvando || !nome.trim()} onClick={salvar} className={classeBotaoPrimario}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
