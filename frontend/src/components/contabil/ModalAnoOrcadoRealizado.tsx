import { useMemo, useState } from "react";
import { Modal } from "../ui/Modal";
import { MatrizContabil, type SubcolunaMatriz, type ValorClicado } from "./MatrizContabil";
import { ModalDetalheLancamentos } from "./ModalDetalheLancamentos";
import { ModalDetalheOrcamento } from "./ModalDetalheOrcamento";
import { recortarAno } from "../../lib/orcadoRealizado";
import type { RespostaOrcadoRealizado, ValoresOrcadoRealizado } from "./OrcadoRealizadoTab";

interface ModalAnoOrcadoRealizadoProps {
  /** Ano do cabeçalho clicado ("AAAA"). */
  ano: string;
  /** A resposta mensal que a tela já tem: o modal recorta o ano daqui, sem consulta nova. */
  resultado: RespostaOrcadoRealizado;
  /** As mesmas subcolunas da aba (Orçado | Realizado | Variação, em R$ ou %). */
  colunas: SubcolunaMatriz<ValoresOrcadoRealizado>[];
  codccu: string[];
  onClose: () => void;
}

// Visão Ano (24/11/2026): clicar no ano abre a matriz mês a mês daquele ano, com os filtros da tela e sem mexer em nada nela (mesmo desenho
// do Acompanhamento de Compra no CaxHub_Dash). O detalhe de origem abre por cima, como o da aba.
export function ModalAnoOrcadoRealizado({ ano, resultado, colunas, codccu, onClose }: ModalAnoOrcadoRealizadoProps) {
  const [detalhe, setDetalhe] = useState<ValorClicado | null>(null);
  const recorte = useMemo(() => recortarAno(ano, resultado.meses, resultado.linhas, resultado.totalGeral), [ano, resultado]);

  return (
    <Modal open onClose={onClose} title={`Orçado x Realizado · ${ano}`} subtitulo="Mês a mês, com os filtros da tela" className="max-w-[96vw]" corpoFixo fecharPorFora={false}>
      <MatrizContabil<ValoresOrcadoRealizado>
        meses={recorte.meses}
        linhas={recorte.linhas}
        totalGeral={recorte.totalGeral}
        loading={false}
        subcolunas={colunas}
        onClickValor={setDetalhe}
      />
      {detalhe?.subcoluna === "realizado" && <ModalDetalheLancamentos {...detalhe} codccu={codccu} onClose={() => setDetalhe(null)} />}
      {detalhe?.subcoluna === "orcado" && <ModalDetalheOrcamento {...detalhe} codccu={codccu} onClose={() => setDetalhe(null)} />}
    </Modal>
  );
}
