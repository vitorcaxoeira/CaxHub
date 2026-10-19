import axios from "axios";
import { FormEvent, useEffect, useState } from "react";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { Indicador, Participante, Representante } from "../../lib/metasComercial";
import { Aviso, botaoPrimario, botaoSecundario, campo, mensagemDe } from "./comum";

export interface Elegivel {
  codfor: number;
  nome: string;
}

interface Props {
  aberto: boolean;
  onClose: () => void;
  ano: number;
  indicadores: Indicador[];
  /** Pessoas do time que ainda não estão neste ano (só na inclusão). */
  elegiveis: Elegivel[];
  /** Representantes do Senior com proposta (para levar as horas vendidas à pessoa). */
  representantes: Representante[];
  /** Presente = edição; ausente = inclusão. */
  participante?: Participante;
  onSalvo: () => void;
}

// Inclui ou edita uma pessoa nas metas do ano: função e quais indicadores ela acompanha (com o rótulo que a planilha dela usa).
export function PessoaForm({ aberto, onClose, ano, indicadores, elegiveis, representantes, participante, onSalvo }: Props) {
  const { mostrar } = useToast();
  const [codfor, setCodfor] = useState<number | "">("");
  const [funcao, setFuncao] = useState("");
  const [codrep, setCodrep] = useState<number | "">("");
  const [ativo, setAtivo] = useState(true);
  const [marcados, setMarcados] = useState<Record<number, string>>({});
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setCodfor("");
    setFuncao(participante?.funcao ?? "");
    setCodrep(participante?.codrep ?? "");
    setAtivo(participante?.ativo ?? true);
    setMarcados(Object.fromEntries((participante?.indicadores ?? []).map((i) => [i.indicadorId, i.rotulo ?? ""])));
  }, [aberto, participante]);

  // Indicador inativo só aparece se a pessoa já o usa (não some de repente).
  const lista = indicadores.filter((i) => i.ativo || marcados[i.id] !== undefined);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!participante && codfor === "") {
      setErro("Escolha a pessoa do time.");
      return;
    }
    const corpoIndicadores = lista
      .filter((i) => marcados[i.id] !== undefined)
      .map((i) => ({ indicadorId: i.id, rotulo: marcados[i.id].trim() === "" || marcados[i.id].trim() === i.nome ? null : marcados[i.id].trim() }));
    setGravando(true);
    try {
      if (participante) {
        await axios.put(`/api/metas-comercial/anos/${ano}/participantes/${participante.id}`, { funcao: funcao.trim() === "" ? null : funcao.trim(), codrep: codrep === "" ? null : codrep, ativo, indicadores: corpoIndicadores });
        mostrar("Pessoa atualizada.", "success");
      } else {
        await axios.post(`/api/metas-comercial/anos/${ano}/participantes`, { codfor, codrep: codrep === "" ? null : codrep, funcao: funcao.trim() === "" ? null : funcao.trim(), indicadores: corpoIndicadores });
        mostrar("Pessoa incluída nas metas.", "success");
      }
      onSalvo();
      onClose();
    } catch (err) {
      setErro(mensagemDe(err, "Não foi possível salvar."));
    } finally {
      setGravando(false);
    }
  }

  return (
    <Modal open={aberto} onClose={onClose} title={participante ? `Editar ${participante.nome}` : "Incluir pessoa nas metas"} subtitulo={`Metas de ${ano}`} className="max-w-xl">
      <form onSubmit={salvar} className="space-y-4 p-4">
        {!participante && (
          <div>
            <label htmlFor="pf-pessoa" className="mb-1 block text-[13px] font-medium text-foreground">Pessoa do time Comercial</label>
            <select id="pf-pessoa" value={codfor} onChange={(e) => setCodfor(e.target.value === "" ? "" : Number(e.target.value))} className={campo} required autoFocus>
              <option value="">Escolha…</option>
              {elegiveis.map((p) => (
                <option key={p.codfor} value={p.codfor}>
                  {p.nome}
                </option>
              ))}
            </select>
            {elegiveis.length === 0 && <p className="mt-1 text-[12px] text-muted">Todo o time do Comercial já está neste ano.</p>}
          </div>
        )}
        {!participante?.naoAtribuido && (
          <div>
            <label htmlFor="pf-rep" className="mb-1 block text-[13px] font-medium text-foreground">Representante do Senior</label>
            <select id="pf-rep" value={codrep} onChange={(e) => setCodrep(e.target.value === "" ? "" : Number(e.target.value))} className={campo}>
              <option value="">Nenhum</option>
              {representantes.map((r) => (
                <option key={r.codrep} value={r.codrep}>
                  {r.nome} ({r.codrep}){r.ativo ? "" : " · inativo"}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[12px] text-muted">As horas das propostas aprovadas deste representante viram o realizado de Horas de Serviços da pessoa.</p>
          </div>
        )}
        <div>
          <label htmlFor="pf-funcao" className="mb-1 block text-[13px] font-medium text-foreground">Função</label>
          <input id="pf-funcao" value={funcao} onChange={(e) => setFuncao(e.target.value)} maxLength={60} placeholder="ex.: Vendas, Pré-vendas" className={campo} />
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-foreground">Indicadores que ela acompanha</legend>
          <p className="mb-2 text-[12px] text-muted">O rótulo é o nome que aparece para ela (ex.: a Taíza chama de "Mensalidade" o que a empresa soma como "Incremento Mensal"). Em branco usa o nome do indicador.</p>
          <ul className="space-y-1.5">
            {lista.map((i) => {
              const marcado = marcados[i.id] !== undefined;
              return (
                <li key={i.id} className="flex items-center gap-3">
                  <label className="flex w-52 shrink-0 items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={(e) =>
                        setMarcados((atual) => {
                          const n = { ...atual };
                          if (e.target.checked) n[i.id] = "";
                          else delete n[i.id];
                          return n;
                        })
                      }
                    />
                    <span className="truncate" title={i.nome}>{i.nome}</span>
                  </label>
                  <input
                    aria-label={`Rótulo de ${i.nome}`}
                    value={marcados[i.id] ?? ""}
                    onChange={(e) => setMarcados((atual) => ({ ...atual, [i.id]: e.target.value }))}
                    disabled={!marcado}
                    maxLength={80}
                    placeholder={i.nome}
                    className={campo}
                  />
                </li>
              );
            })}
          </ul>
        </fieldset>
        {participante && !participante.naoAtribuido && (
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            Ativa nas metas (desmarque para tirar do painel e dos lançamentos sem perder o histórico)
          </label>
        )}
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
