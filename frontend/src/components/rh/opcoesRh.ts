import axios from "axios";

// Opções dos filtros do RH (GET /api/rh/filtros), uma busca por sessão da página.

export interface Opcao<V> {
  valor: V;
  rotulo: string;
  empresa?: number;
}

export interface OpcoesRh {
  empresas: Opcao<number>[];
  filiais: Opcao<number>[];
  centrosDeCusto: Opcao<string>[];
  locais: Opcao<number>[];
  cargos: Opcao<string>[];
  tiposDeColaborador: Opcao<number>[];
  dados: {
    primeiraAdmissao: string | null;
    ultimaApuracaoDePonto: string | null;
    ultimaCompetenciaDeFolha: string | null;
    ultimaSincronizacao: string | null;
  };
}

// As opções mudam só quando a base muda (sincronização): uma busca por sessão da página basta.
let promessaOpcoes: Promise<OpcoesRh> | null = null;
export function buscarOpcoes(): Promise<OpcoesRh> {
  if (!promessaOpcoes) {
    promessaOpcoes = axios.get<OpcoesRh>("/api/rh/filtros").then((r) => r.data);
    promessaOpcoes.catch(() => {
      promessaOpcoes = null;
    });
  }
  return promessaOpcoes;
}
