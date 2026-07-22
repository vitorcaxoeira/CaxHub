import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { agregarHoras, formatHorasCompacto, larguraHorasProposta, somarOrcamentos } from "../../lib/cronograma";
import { useCronograma } from "../../hooks/useCronograma";
import { ArvoreCronograma } from "../../components/cronograma/ArvoreCronograma";
import { IndicadorProgresso } from "../../components/cronograma/IndicadorProgresso";
import { RodapeOrcamento } from "../../components/cronograma/RodapeOrcamento";

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
  const { proposta, nos, loading, erro, recarregar, atualizarNo, criarNo, excluirNo, duplicarNo, moverItem } = useCronograma(codemp, codpro);

  const avancoGeral = useMemo(() => {
    const agregados = agregarHoras(nos);
    const raizes = nos.filter((n) => n.tipo === "item");
    let horasPrevistas = 0;
    let horasRealizadas = 0;
    for (const raiz of raizes) {
      const agregado = agregados.get(raiz.id);
      if (!agregado) continue;
      horasPrevistas += agregado.horasPrevistas;
      horasRealizadas += agregado.horasRealizadas;
    }
    const avanco = horasPrevistas > 0 ? horasRealizadas / horasPrevistas : 0;
    return { horasPrevistas, horasRealizadas, avanco };
  }, [nos]);

  const orcamentoTotal = useMemo(() => somarOrcamentos(nos.filter((n) => n.tipo === "item"), agregarHoras(nos)), [nos]);
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
              <p className="font-mono text-2xl font-semibold tabular-nums text-foreground">{Math.round(avancoGeral.avanco * 100)}%</p>
              <p className="font-mono text-[12px] tabular-nums text-muted">
                {formatHorasCompacto(avancoGeral.horasRealizadas, larguraHoras)} / {formatHorasCompacto(avancoGeral.horasPrevistas, larguraHoras)}
              </p>
            </div>
          </div>
          <IndicadorProgresso avanco={avancoGeral.avanco} alturaPx={4} className="mt-3" />
        </div>
      )}

      <ArvoreCronograma
        projetoId={`${codemp}-${codpro}`}
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
      />

      {!loading && !erro && nos.some((n) => n.tipo === "item") && (
        <RodapeOrcamento totais={orcamentoTotal} larguraHoras={larguraHoras} />
      )}
    </div>
  );
}
