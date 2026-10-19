import axios from "axios";
import { FormEvent, useEffect, useState } from "react";
import { Aviso, botaoPrimario, botaoSecundario, Cabecalho, Cartao, campo, mensagemDe } from "../../../components/metasComercial/comum";
import { Modal } from "../../../components/ui/Modal";
import { Skeleton } from "../../../components/ui/Skeleton";
import { useToast } from "../../../components/ui/Toast";
import { Acumulacao, Indicador, Unidade, rotuloOrigem } from "../../../lib/metasComercial";

const ROTULO_UNIDADE: Record<Unidade, string> = { BRL: "Reais (R$)", HORAS: "Horas", QTD: "Quantidade" };
const ROTULO_ACUMULACAO: Record<Acumulacao, string> = { SOMA: "Soma dos meses", SALDO: "Posição (vale o último mês)" };

// Comercial › Gestão de Metas › Indicadores: o cadastro do que se mede (Mensalidade, Licenças, Horas, Faturamento…). Indicador novo
// aparece nas outras telas sem deploy. Com uso, só renomeia ou desativa; unidade e acumulação travam para não mudar o sentido do histórico.
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted">
                  <th className="py-1.5 pr-3 font-medium">Indicador</th>
                  <th className="px-3 py-1.5 font-medium">Unidade</th>
                  <th className="px-3 py-1.5 font-medium">Como soma os meses</th>
                  <th className="px-3 py-1.5 font-medium">Origem do realizado</th>
                  <th className="py-1.5 pl-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((i) => (
                  <tr key={i.id} className={`border-b border-border/60 ${i.ativo ? "" : "opacity-60"}`}>
                    <td className="py-2 pr-3 text-foreground">
                      {i.nome}
                      {!i.ativo && <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-muted">inativo</span>}
                    </td>
                    <td className="px-3 py-2 text-muted">{ROTULO_UNIDADE[i.unidade]}</td>
                    <td className="px-3 py-2 text-muted">{ROTULO_ACUMULACAO[i.acumulacao]}</td>
                    <td className="px-3 py-2 text-muted">{rotuloOrigem(i.origem)}</td>
                    <td className="py-2 pl-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setModal({ indicador: i })} className={botaoSecundario}>
                          Editar
                        </button>
                        <button type="button" onClick={() => alternarAtivo(i)} className={botaoSecundario}>
                          {i.ativo ? "Desativar" : "Ativar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
