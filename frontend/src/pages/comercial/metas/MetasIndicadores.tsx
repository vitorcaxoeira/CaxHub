import axios from "axios";
import { FormEvent, useEffect, useState } from "react";
import { Aviso, botaoPrimario, botaoSecundario, Cabecalho, Cartao, campo, mensagemDe } from "../../../components/metasComercial/comum";
import { Modal } from "../../../components/ui/Modal";
import { TabelaLocal } from "../../../components/colunas/TabelaLocal";
import type { ColunaLocal } from "../../../components/colunas/aplicarLocal";
import type { DefColuna } from "../../../components/colunas/useColunasConfiguraveis";
import { Skeleton } from "../../../components/ui/Skeleton";
import { useToast } from "../../../components/ui/Toast";
import { Acumulacao, Indicador, Unidade, rotuloOrigem } from "../../../lib/metasComercial";

const ROTULO_UNIDADE: Record<Unidade, string> = { BRL: "Reais (R$)", HORAS: "Horas", QTD: "Quantidade" };
const ROTULO_ACUMULACAO: Record<Acumulacao, string> = { SOMA: "Soma dos meses", SALDO: "Posição (vale o último mês)" };

// Comercial › Gestão de Metas › Indicadores: o cadastro do que se mede (Mensalidade, Licenças, Horas, Faturamento…). Indicador novo
// aparece nas outras telas sem deploy. Com uso, só renomeia ou desativa; unidade e acumulação travam para não mudar o sentido do histórico.

// Indicadores com filtro e ordem por coluna e colunas configuráveis (TabelaLocal, 03/11/2026). As ações da linha vêm por ctx.
interface AcoesIndicador {
  editar: (i: Indicador) => void;
  alternarAtivo: (i: Indicador) => void;
}
const LOCAIS_INDICADORES: ColunaLocal[] = [
  { nome: "nome", tipo: "texto", obrigatoria: true },
  { nome: "unidadeRotulo", tipo: "texto", obrigatoria: true },
  { nome: "acumulacaoRotulo", tipo: "texto", obrigatoria: true },
  { nome: "origemRotulo", tipo: "texto", obrigatoria: true },
  { nome: "ativo", tipo: "booleano", obrigatoria: true },
  { nome: "ordem", tipo: "inteiro", obrigatoria: true },
];
const lerIndicador = (i: Indicador, nome: string): unknown =>
  nome === "unidadeRotulo"
    ? ROTULO_UNIDADE[i.unidade]
    : nome === "acumulacaoRotulo"
      ? ROTULO_ACUMULACAO[i.acumulacao]
      : nome === "origemRotulo"
        ? rotuloOrigem(i.origem)
        : (i as unknown as Record<string, unknown>)[nome];
const COLUNAS_INDICADORES: DefColuna<Indicador, AcoesIndicador>[] = [
  {
    nome: "nome",
    titulo: "Indicador",
    fixa: true,
    largura: 240,
    classe: "text-foreground",
    texto: (i) => i.nome,
    render: (i) => (
      <>
        {i.nome}
        {!i.ativo && <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-muted">inativo</span>}
      </>
    ),
  },
  { nome: "unidadeRotulo", titulo: "Unidade", largura: 120, classe: "text-muted", render: (i) => ROTULO_UNIDADE[i.unidade] },
  { nome: "acumulacaoRotulo", titulo: "Como soma os meses", largura: 170, classe: "text-muted", render: (i) => ROTULO_ACUMULACAO[i.acumulacao] },
  { nome: "origemRotulo", titulo: "Origem do realizado", largura: 180, classe: "text-muted", render: (i) => rotuloOrigem(i.origem) },
  // "Ativo" e "Ordem" não existiam na tabela antes do kit de colunas (o inativo já aparece como etiqueta ao lado do nome): nascem ocultas.
  { nome: "ativo", titulo: "Ativo", ocultaPorPadrao: true, largura: 70, classe: "text-muted", render: (i) => (i.ativo ? "sim" : "não") },
  { nome: "ordem", titulo: "Ordem", ocultaPorPadrao: true, direita: true, largura: 70, classe: "tabular-nums text-muted", render: (i) => i.ordem },
  {
    nome: "acoes",
    titulo: "Ações",
    semOrdenar: true,
    direita: true,
    largura: 190,
    render: (i, a) => (
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => a.editar(i)} className={botaoSecundario}>
          Editar
        </button>
        <button type="button" onClick={() => a.alternarAtivo(i)} className={botaoSecundario}>
          {i.ativo ? "Desativar" : "Ativar"}
        </button>
      </div>
    ),
  },
];
export function MetasIndicadores() {
  const { mostrar } = useToast();
  const [lista, setLista] = useState<Indicador[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [modal, setModal] = useState<{ indicador?: Indicador } | null>(null);

  useEffect(() => {
    let cancelado = false;
    axios
      .get<{ indicadores: Indicador[] }>("/api/metas-comercial/indicadores")
      .then(({ data }) => !cancelado && setLista(data.indicadores))
      .catch((e) => !cancelado && setErro(mensagemDe(e, "Não foi possível carregar os indicadores.")));
    return () => {
      cancelado = true;
    };
  }, [recarga]);

  async function alternarAtivo(i: Indicador) {
    try {
      await axios.put(`/api/metas-comercial/indicadores/${i.id}`, { ativo: !i.ativo });
      mostrar(i.ativo ? `${i.nome} desativado.` : `${i.nome} ativado.`, "success");
      setRecarga((n) => n + 1);
    } catch (e) {
      mostrar(mensagemDe(e, "Não foi possível alterar o indicador."), "destructive");
    }
  }

  return (
    <div>
      <Cabecalho titulo="Indicadores" descricao="O que a equipe comercial mede. Cada indicador tem uma unidade e um jeito de somar os meses; o faturamento vem do Senior.">
        <button type="button" onClick={() => setModal({})} className={botaoPrimario}>
          Novo indicador
        </button>
      </Cabecalho>
      {erro && <Aviso>{erro}</Aviso>}
      {!lista && !erro && <Skeleton className="h-64 w-full" />}
      {lista && (
        <Cartao>
          <TabelaLocal<Indicador, AcoesIndicador>
            chave="comercial.metas.indicadores"
            defs={COLUNAS_INDICADORES}
            colunas={LOCAIS_INDICADORES}
            linhas={lista}
            ler={lerIndicador}
            ctx={{ editar: (i) => setModal({ indicador: i }), alternarAtivo }}
            chaveLinha={(i) => String(i.id)}
            classeLinha={(i) => (i.ativo ? undefined : "opacity-60")}
            vazio="Nenhum indicador cadastrado."
          />
        </Cartao>
      )}
      {modal && <FormIndicador indicador={modal.indicador} onClose={() => setModal(null)} onSalvo={() => setRecarga((n) => n + 1)} />}
    </div>
  );
}

function FormIndicador({ indicador, onClose, onSalvo }: { indicador?: Indicador; onClose: () => void; onSalvo: () => void }) {
  const { mostrar } = useToast();
  const [nome, setNome] = useState(indicador?.nome ?? "");
  const [unidade, setUnidade] = useState<Unidade>(indicador?.unidade ?? "QTD");
  const [acumulacao, setAcumulacao] = useState<Acumulacao>(indicador?.acumulacao ?? "SOMA");
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Indicador usado (ou do Senior) mantém unidade e acumulação.
  const travado = indicador != null && (indicador.emUso || indicador.origem !== "MANUAL");

  useEffect(() => setErro(null), [nome, unidade, acumulacao]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setGravando(true);
    try {
      if (indicador) await axios.put(`/api/metas-comercial/indicadores/${indicador.id}`, { nome, ...(travado ? {} : { unidade, acumulacao }) });
      else await axios.post("/api/metas-comercial/indicadores", { nome, unidade, acumulacao });
      mostrar(indicador ? "Indicador atualizado." : "Indicador criado.", "success");
      onSalvo();
      onClose();
    } catch (err) {
      setErro(mensagemDe(err, "Não foi possível salvar."));
    } finally {
      setGravando(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={indicador ? `Editar ${indicador.nome}` : "Novo indicador"}>
      <form onSubmit={salvar} className="space-y-3 p-4">
        <div>
          <label htmlFor="ind-nome" className="mb-1 block text-[13px] font-medium text-foreground">Nome</label>
          <input id="ind-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} className={campo} required autoFocus />
        </div>
        <div>
          <label htmlFor="ind-unidade" className="mb-1 block text-[13px] font-medium text-foreground">Unidade</label>
          <select id="ind-unidade" value={unidade} onChange={(e) => setUnidade(e.target.value as Unidade)} disabled={travado} className={campo}>
            {(Object.keys(ROTULO_UNIDADE) as Unidade[]).map((u) => (
              <option key={u} value={u}>{ROTULO_UNIDADE[u]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ind-acum" className="mb-1 block text-[13px] font-medium text-foreground">Como soma os meses</label>
          <select id="ind-acum" value={acumulacao} onChange={(e) => setAcumulacao(e.target.value as Acumulacao)} disabled={travado} className={campo}>
            {(Object.keys(ROTULO_ACUMULACAO) as Acumulacao[]).map((a) => (
              <option key={a} value={a}>{ROTULO_ACUMULACAO[a]}</option>
            ))}
          </select>
          <p className="mt-1 text-[12px] text-muted">
            {travado ? "Este indicador já tem metas ou lançamentos: unidade e forma de somar não mudam." : "Posição serve para saldos, como a carteira de mensalidades: vale o último mês lançado em vez da soma."}
          </p>
        </div>
        {erro && <Aviso>{erro}</Aviso>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={botaoSecundario}>
            Cancelar
          </button>
          <button type="submit" disabled={gravando} className={botaoPrimario}>
            {gravando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
