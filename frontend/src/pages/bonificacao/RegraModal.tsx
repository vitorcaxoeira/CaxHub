import axios from "axios";
import { useState } from "react";
import { classeBotaoPrimario, classeBotaoSecundario, classeCampo, classeRotulo } from "../../components/gestao5s/campos";
import { Modal } from "../../components/ui/Modal";
import { mensagemDe, type Faixa, type SentidoIndicador, type UnidadeIndicador } from "./comum";

// Cadastro de uma versão de regra de um indicador: vigência (meses fechados), valor base e a tabela de faixas (valor apurado → pontos).
// Menor-é-melhor: limites crescentes ("até X"); maior-é-melhor: decrescentes ("a partir de X"). A última faixa é sempre "demais casos".

export interface RegraDto {
  id: number;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  valorBase: number;
  idadeMeses: number | null;
  observacao: string | null;
  faixas: Faixa[];
}

interface IndicadorParaRegra {
  id: number;
  nome: string;
  fonte: string;
  unidade: UnidadeIndicador | string;
  sentido: SentidoIndicador | string;
}

interface FaixaForm {
  limite: string;
  pontos: string;
}

const paraTexto = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));
const ultimoDiaDoMes = (ym: string) => {
  const [a, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

export function RegraModal({ indicador, regra, sugestaoInicio, onFechar, onSalvo }: { indicador: IndicadorParaRegra; regra: RegraDto | null; sugestaoInicio: string; onFechar: () => void; onSalvo: () => void }) {
  const [inicio, setInicio] = useState((regra?.vigenciaInicio ?? sugestaoInicio).slice(0, 7));
  const [fim, setFim] = useState(regra?.vigenciaFim ? regra.vigenciaFim.slice(0, 7) : "");
  const [valorBase, setValorBase] = useState(paraTexto(regra?.valorBase ?? 400));
  const [idade, setIdade] = useState(paraTexto(regra?.idadeMeses ?? 3));
  const [obs, setObs] = useState(regra?.observacao ?? "");
  const [faixas, setFaixas] = useState<FaixaForm[]>(
    regra ? regra.faixas.map((f) => ({ limite: paraTexto(f.limite), pontos: paraTexto(f.pontos) })) : [{ limite: "", pontos: "1" }, { limite: "", pontos: "0" }]
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const menor = indicador.sentido === "menor_melhor";
  const sufixo = indicador.unidade === "percentual" ? "%" : indicador.unidade === "horas" ? "h" : "";

  const atualizar = (i: number, campo: keyof FaixaForm, v: string) => setFaixas((fs) => fs.map((f, k) => (k === i ? { ...f, [campo]: v } : f)));
  // A última faixa é o "demais casos": nova faixa entra antes dela.
  const adicionar = () => setFaixas((fs) => [...fs.slice(0, -1), { limite: "", pontos: "" }, fs[fs.length - 1]]);
  const remover = (i: number) => setFaixas((fs) => (fs.length > 2 ? fs.filter((_, k) => k !== i) : fs));

  async function salvar() {
    setSalvando(true);
    setErro(null);
    const corpo = {
      vigenciaInicio: `${inicio}-01`,
      vigenciaFim: fim ? ultimoDiaDoMes(fim) : null,
      valorBase,
      idadeMeses: indicador.fonte === "kyria_chamados_antigos" ? idade : null,
      observacao: obs || null,
      faixas: faixas.map((f, i) => ({ limite: i === faixas.length - 1 ? null : f.limite, pontos: f.pontos })),
    };
    try {
      if (regra) await axios.put(`/api/bonificacao/regras/${regra.id}`, corpo);
      else await axios.post(`/api/bonificacao/indicadores/${indicador.id}/regras`, corpo);
      onSalvo();
    } catch (e) {
      setErro(mensagemDe(e, "Não foi possível salvar a regra"));
      setSalvando(false);
    }
  }

  return (
    <Modal open onClose={onFechar} title={regra ? `Editar regra · ${indicador.nome}` : `Nova regra · ${indicador.nome}`} fecharPorFora={false}>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={classeRotulo} htmlFor="regra-inicio">
              Vigência — início (mês)
            </label>
            <input id="regra-inicio" type="month" className={classeCampo} value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </div>
          <div>
            <label className={classeRotulo} htmlFor="regra-fim">
              Vigência — fim (mês, opcional)
            </label>
            <input id="regra-fim" type="month" className={classeCampo} value={fim} min={inicio} onChange={(e) => setFim(e.target.value)} />
          </div>
          <div>
            <label className={classeRotulo} htmlFor="regra-base">
              Valor base (R$)
            </label>
            <input id="regra-base" className={classeCampo} inputMode="decimal" value={valorBase} onChange={(e) => setValorBase(e.target.value)} />
          </div>
          {indicador.fonte === "kyria_chamados_antigos" && (
            <div>
              <label className={classeRotulo} htmlFor="regra-idade">
                Chamado antigo = aberto há mais de (meses)
              </label>
              <input id="regra-idade" className={classeCampo} inputMode="numeric" value={idade} onChange={(e) => setIdade(e.target.value)} />
            </div>
          )}
        </div>

        <div>
          <p className={classeRotulo}>Faixas ({menor ? "até X: a primeira que couber vale" : "a partir de X: a primeira que couber vale"})</p>
          <div className="space-y-1.5">
            {faixas.map((f, i) => {
              const ultima = i === faixas.length - 1;
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-[12.5px] text-muted">{ultima ? "Demais casos" : menor ? "Até" : "A partir de"}</span>
                  {ultima ? (
                    <span className="w-32 shrink-0" />
                  ) : (
                    <div className="flex w-32 shrink-0 items-center gap-1">
                      <input aria-label={`Limite da faixa ${i + 1}`} className={classeCampo} inputMode="decimal" value={f.limite} onChange={(e) => atualizar(i, "limite", e.target.value)} />
                      {sufixo && <span className="text-xs text-muted">{sufixo}</span>}
                    </div>
                  )}
                  <span className="text-muted">→</span>
                  <input aria-label={`Pontos da faixa ${i + 1}`} className={`${classeCampo} w-24`} inputMode="decimal" value={f.pontos} onChange={(e) => atualizar(i, "pontos", e.target.value)} />
                  <span className="text-xs text-muted">pt</span>
                  {!ultima && faixas.length > 2 && (
                    <button type="button" onClick={() => remover(i)} className="text-xs text-destructive hover:underline" aria-label={`Remover faixa ${i + 1}`}>
                      Remover
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" onClick={adicionar} className="mt-2 text-xs text-primary hover:underline">
            + Adicionar faixa
          </button>
        </div>

        <div>
          <label className={classeRotulo} htmlFor="regra-obs">
            Observação
          </label>
          <input id="regra-obs" className={classeCampo} maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)} placeholder='Ex.: "2º semestre"' />
        </div>

        {erro && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">{erro}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onFechar} disabled={salvando} className={classeBotaoSecundario}>
            Cancelar
          </button>
          <button type="button" onClick={salvar} disabled={salvando || !inicio} className={classeBotaoPrimario}>
            {salvando ? "Salvando…" : "Salvar regra"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
