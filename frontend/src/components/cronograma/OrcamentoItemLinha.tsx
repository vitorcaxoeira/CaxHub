import { OrcamentoItem, descreverSaldoDistribuicao, estadoAlertaItem, formatHorasCompacto } from "../../lib/cronograma";
import { IndicadorProgresso } from "./IndicadorProgresso";

const COR_SALDO: Record<"success" | "muted" | "destructive", string> = {
  success: "text-success",
  muted: "text-muted",
  destructive: "text-destructive",
};

// Bloco de orçamento do item: números acima (realizado · distribuído / contratado + o
// saldo de distribuição à direita) e a barra de duas camadas embaixo (trilho = 100% do
// contratado; camada de trás = distribuído, camada da frente = realizado). É a única
// informação de horas que o item mostra — pasta/atividade têm seus próprios blocos.
//
// A cor de cada pedaço reage ao estado de alerta do item (ver estadoAlertaItem):
// - estouro_realizado: tudo (números e as duas camadas) vira destructive — pior cenário.
// - estouro_distribuicao: só o número/camada do distribuído vira destructive; o
//   realizado (ainda dentro do contratado) segue normal.
// - real_acima_previsto: número/camada do realizado vira warning, e a barra ganha um
//   traço divisor onde o distribuído termina, evidenciando o quanto o realizado passou
//   do planejado. O tratamento de linha (borda/fundo/chip) fica em LinhaNo — aqui só os
//   números e a barra.
export function OrcamentoItemLinha({
  orcamento,
  larguraHoras,
  className = "",
}: {
  orcamento: OrcamentoItem;
  larguraHoras: number;
  className?: string;
}) {
  const saldo = descreverSaldoDistribuicao(orcamento, larguraHoras);
  const estado = estadoAlertaItem(orcamento);

  let corRealizadoTexto = "text-primary";
  let corDistribuidoTexto = "text-muted";
  let corCamadaDistribuido = "bg-primary/25";
  let corCamadaRealizado = "bg-primary";
  let marcador: { percentual: number; cor: string } | undefined;

  if (estado === "estouro_realizado") {
    corRealizadoTexto = "text-destructive";
    corDistribuidoTexto = "text-destructive";
    corCamadaDistribuido = "bg-destructive/25";
    corCamadaRealizado = "bg-destructive";
  } else if (estado === "estouro_distribuicao") {
    corDistribuidoTexto = "text-destructive";
    corCamadaDistribuido = "bg-destructive/25";
  } else if (estado === "real_acima_previsto") {
    corRealizadoTexto = "text-warning";
    corCamadaRealizado = "bg-warning";
    marcador = { percentual: orcamento.consumoDistribuido, cor: "bg-warning" };
  }

  return (
    <div className={`min-w-0 ${className}`}>
      <div className="flex items-baseline gap-3">
        <p className="truncate font-mono text-[12px] tabular-nums text-muted">
          <span className={corRealizadoTexto}>{formatHorasCompacto(orcamento.horasRealizadas, larguraHoras)}</span>
          {" · "}
          <span className={corDistribuidoTexto}>{formatHorasCompacto(orcamento.horasDistribuidas, larguraHoras)}</span>
          {" / "}
          {formatHorasCompacto(orcamento.horasContratadas, larguraHoras)}
        </p>
        <p className={`hidden flex-none font-mono text-[11px] tabular-nums sm:block ${COR_SALDO[saldo.tom]}`}>{saldo.texto}</p>
      </div>
      <IndicadorProgresso
        camadas={[
          { percentual: orcamento.consumoDistribuido, cor: corCamadaDistribuido },
          { percentual: orcamento.consumoReal, cor: corCamadaRealizado },
        ]}
        marcador={marcador}
        alturaPx={5}
        className="mt-1"
      />
    </div>
  );
}
