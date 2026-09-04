import { useOutletContext } from "react-router-dom";
import type { PainelShellContext } from "../../layout/PainelShell";
import { useRotacaoPainel } from "../../hooks/useRotacaoPainel";
import { componentePara } from "../../paineis/registry";

// A tela /painel em si — só liga o contexto vindo do PainelShell (a lista de itens da
// rotação) ao motor de rotação, e renderiza o componente do painel da vez. Toda a
// lógica de girar/pré-buscar mora em useRotacaoPainel; toda a lógica de qual componente
// mora no registry — este arquivo não sabe nada além de "ligar os dois".
export function PainelRotacao() {
  const { itens } = useOutletContext<PainelShellContext>();
  const { atual, dados } = useRotacaoPainel(itens);

  if (!atual) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background">
        <p className="font-mono text-3xl text-muted">Nenhum painel configurado pra esta TV.</p>
      </div>
    );
  }

  const Componente = componentePara(atual.painelId);
  return <Componente dados={dados} />;
}
