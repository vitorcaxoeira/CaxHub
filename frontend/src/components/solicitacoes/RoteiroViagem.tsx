import { montarRoteiro, type TipoItem } from "../../utils/solicitacoesViagem";

interface RoteiroViagemProps {
  viajantes: { chave: number; nome: string }[];
  itens: {
    tipo: TipoItem;
    viajantes: number[];
    cidade?: string | null;
    origem?: string | null;
    destino?: string | null;
    dataInicio?: string | null;
    dataFim?: string | null;
    localRetirada?: string | null;
    localDevolucao?: string | null;
  }[];
}

// Junta passagem + hospedagem + carro da mesma pessoa, em ordem de data — é o que permite ver
// se a viagem "fecha" (quem dorme onde, quem pega o carro em qual cidade).
export function RoteiroViagem({ viajantes, itens }: RoteiroViagemProps) {
  const roteiro = montarRoteiro(viajantes, itens);
  if (roteiro.length === 0) {
    return <p className="text-[12.5px] text-muted">O roteiro aparece aqui conforme você preenche as datas de cada serviço.</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {roteiro.map((r) => (
        <div key={r.nome} className="rounded-md border border-border bg-surface px-3 py-2.5">
          <p className="text-sm font-medium text-foreground">{r.nome}</p>
          <ul className="mt-1 space-y-0.5">
            {r.linhas.map((l, ix) => (
              <li key={ix} className="font-mono text-[12px] text-muted">
                {l}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
