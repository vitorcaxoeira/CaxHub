import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { agregarHoras, formatHorasCompacto, larguraHorasProposta, somarOrcamentos } from "../../lib/cronograma";
import { tomConsumo } from "../../lib/consumoHoras";
import { useCronograma } from "../../hooks/useCronograma";
import { ArvoreCronograma } from "../../components/cronograma/ArvoreCronograma";
import { IndicadorProgresso } from "../../components/cronograma/IndicadorProgresso";
import { KpisCronograma } from "../../components/cronograma/KpisCronograma";

const toneBadge: Record<string, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  neutral: "bg-muted/15 text-muted",
};

// Cronograma exclusivo da proposta — editor de EAP (WBS) em árvore. Todos os itens da
// proposta entram como âncora fixa da lista (vêm do Senior, nunca criados/excluídos
// aqui); pastas organizacionais e atividades-folha ficam por conta do Líder Técnico.
export function CronogramaProposta() {
  const { codemp, codpro } = useParams<{ codemp: string; codpro: string }>();
  const navigate = useNavigate();
  const {
    proposta,
    nos,
    loading,
    erro,
    recarregar,
    atualizarNo,
    criarNo,
    excluirNo,
    duplicarNo,
    moverItem,
    atualizarBloqueiaExcedenteEstrutura,
    sincronizarAlocacao,
    acompanharSincronizacaoAlocacao,
  } = useCronograma(codemp, codpro);
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [erroConfig, setErroConfig] = useState<string | null>(null);

  async function onMudarBloqueiaExcedente(bloqueia: boolean) {
    setSalvandoConfig(true);
    setErroConfig(null);
    try {
      await atualizarBloqueiaExcedenteEstrutura(bloqueia);
    } catch (err) {
      setErroConfig((err as Error).message);
    } finally {
      setSalvandoConfig(false);
    }
  }

  const orcamentoTotal = useMemo(() => somarOrcamentos(nos.filter((n) => n.tipo === "item"), agregarHoras(nos)), [nos]);

  // Avanço da proposta = Realizado sobre ORÇADO (o contratado), não sobre o Alocado.
  // Antes era sobre o alocado, o que respondia "quanto do planejado já foi feito" e podia
  // marcar 100% com metade do contrato ainda por distribuir. Sobre o orçado ele responde
  // "quanto do contrato já foi consumido", que é a leitura que os KPIs logo abaixo dão.
  //
  // `consumoReal` já vem de somarOrcamentos com guarda contra divisão por zero, e a cor
  // sai do mesmo tomConsumo do card do Quadro — azul, âmbar a partir de 80%, vermelho
  // acima de 100%.
  const tomAvanco = tomConsumo(orcamentoTotal.consumoReal);
  // Largura de dígitos de hora usada por TODA a tela (árvore, drawer, rodapé) — calculada
  // uma vez aqui a partir do total da proposta (ver larguraHorasProposta) e propagada por
  // prop, pra que os números de horas fiquem alinhados entre item/pasta/atividade
  // independente do nível ou do tamanho de cada valor individual.
  const larguraHoras = useMemo(() => larguraHorasProposta(orcamentoTotal), [orcamentoTotal]);

  return (
    <div>
      <button onClick={() => navigate(-1)} className="text-sm text-primary hover:underline">
        ← Voltar
      </button>

      {proposta && (
        <div className="mb-4 mt-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">
            Proposta {proposta.codpro} · Projeto {proposta.numprj}
          </p>
          <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex flex-wrap items-center gap-2 font-display text-2xl font-bold text-foreground">
                {proposta.cliente}
                <span className={`rounded-full px-2 py-0.5 font-mono text-xs font-medium ${toneBadge[proposta.sitproTone]}`}>
                  {proposta.sitproLabel}
                </span>
              </p>
            </div>
            <div className="flex-none text-right">
              <p className={`font-mono text-2xl font-semibold tabular-nums ${tomAvanco.texto || "text-foreground"}`}>
                {Math.round(orcamentoTotal.consumoReal * 100)}%
              </p>
              <p className="font-mono text-[12px] tabular-nums text-muted">
                {formatHorasCompacto(orcamentoTotal.horasRealizadas, larguraHoras)} /{" "}
                {formatHorasCompacto(orcamentoTotal.horasContratadas, larguraHoras)}
              </p>
            </div>
          </div>
          <IndicadorProgresso avanco={orcamentoTotal.consumoReal} cor={tomAvanco.barra} alturaPx={4} className="mt-3" />

          {/* Só quem gerencia a proposta decide essa regra — desliga o bypass "Salvar mesmo
              excedendo" da edição de duração (DrawerAtividade). horasExcedentes continua
              funcionando normal, é um canal à parte (autoriza estourar, não some daqui). */}
          {proposta.podeGerenciarProposta && (
            <div className="mt-3 flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={proposta.bloqueiaExcedenteEstrutura}
                  disabled={salvandoConfig}
                  onChange={(e) => onMudarBloqueiaExcedente(e.target.checked)}
                />
                Travar horas acima do saldo do item na estrutura (sem "salvar mesmo excedendo")
              </label>
              {erroConfig && <p className="text-[12px] text-destructive">{erroConfig}</p>}
            </div>
          )}
        </div>
      )}

      {/* Placar antes da árvore: é o resumo que responde "como está a proposta" e tem que
          estar visível na abertura, sem depender de rolar até o fim de uma EAP longa. */}
      {!loading && !erro && nos.some((n) => n.tipo === "item") && (
        <KpisCronograma totais={orcamentoTotal} larguraHoras={larguraHoras} />
      )}

      <ArvoreCronograma
        projetoId={`${codemp}-${codpro}`}
        codemp={codemp ?? ""}
        codpro={codpro ?? ""}
        nos={nos}
        loading={loading}
        erro={erro}
        onTentarNovamente={recarregar}
        atualizarNo={atualizarNo}
        criarNo={criarNo}
        excluirNo={excluirNo}
        duplicarNo={duplicarNo}
        moverItem={moverItem}
        podeGerenciarProposta={proposta?.podeGerenciarProposta ?? false}
        larguraHoras={larguraHoras}
        bloqueiaExcedenteEstrutura={proposta?.bloqueiaExcedenteEstrutura ?? false}
        sincronizarAlocacao={sincronizarAlocacao}
        acompanharSincronizacaoAlocacao={acompanharSincronizacaoAlocacao}
      />
    </div>
  );
}
