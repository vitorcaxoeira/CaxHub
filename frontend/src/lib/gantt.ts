// Escala do Gantt do relatório impresso do Cronograma — funções puras (datas "AAAA-MM-DD", sempre em
// UTC pra não escorregar um dia por fuso). A escala vai da primeira à última data do cronograma,
// alinhada à semana (segunda a domingo) ou ao mês cheio, e cada marca ocupa uma fatia em % da
// largura — o relatório posiciona barras e linhas com esses percentuais, sem depender de pixel.

export type EscalaGantt = "semana" | "mes";
export type EscalaPedida = "auto" | EscalaGantt;

const DIA_MS = 86_400_000;
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// Até este tamanho (em dias) o "auto" usa semanas; acima disso as semanas ficariam ilegíveis.
export const LIMITE_AUTO_SEMANAS_DIAS = 120;

function paraMs(iso: string): number {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(a, m - 1, d);
}

function deMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function diasEntre(de: string, ate: string): number {
  return Math.round((paraMs(ate) - paraMs(de)) / DIA_MS);
}

export function somarDias(iso: string, dias: number): string {
  return deMs(paraMs(iso) + dias * DIA_MS);
}

function segundaDaSemana(iso: string): string {
  const diaSemana = new Date(paraMs(iso)).getUTCDay(); // 0 = domingo
  return somarDias(iso, -((diaSemana + 6) % 7));
}

function primeiroDoMes(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function primeiroDoMesSeguinte(iso: string): string {
  const [a, m] = iso.split("-").map(Number);
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
}

export interface MarcaGantt {
  // Primeiro dia da marca (segunda-feira, ou dia 1 do mês).
  inicio: string;
  rotulo: string;
  // Posição e largura em % da escala inteira.
  esquerda: number;
  largura: number;
}

export interface EscalaMontada {
  escala: EscalaGantt;
  inicio: string;
  fim: string;
  totalDias: number;
  marcas: MarcaGantt[];
  // % da posição de uma data (sem limitar ao intervalo — quem usa decide).
  posicao: (iso: string) => number;
  // Esquerda e largura (%) de uma barra do dia `inicio` ao dia `fim`, ambos inclusive, com largura
  // mínima pra um dia só continuar visível.
  barra: (inicio: string, fim: string) => { esquerda: number; largura: number };
}

// Devolve null quando não há datas pra desenhar. `de`/`ate` são o menor início e o maior fim.
export function montarEscalaGantt(de: string | null, ate: string | null, pedida: EscalaPedida = "auto"): EscalaMontada | null {
  if (!de || !ate) return null;
  const menor = de <= ate ? de : ate;
  const maior = de <= ate ? ate : de;
  const dias = diasEntre(menor, maior) + 1;
  const escala: EscalaGantt = pedida === "auto" ? (dias <= LIMITE_AUTO_SEMANAS_DIAS ? "semana" : "mes") : pedida;

  const inicio = escala === "semana" ? segundaDaSemana(menor) : primeiroDoMes(menor);
  const fim = escala === "semana" ? somarDias(segundaDaSemana(maior), 6) : somarDias(primeiroDoMesSeguinte(maior), -1);
  const totalDias = diasEntre(inicio, fim) + 1;

  const marcas: MarcaGantt[] = [];
  let atual = inicio;
  while (atual <= fim) {
    const proxima = escala === "semana" ? somarDias(atual, 7) : primeiroDoMesSeguinte(atual);
    const [a, m, d] = atual.split("-");
    marcas.push({
      inicio: atual,
      rotulo: escala === "semana" ? `${d}/${m}` : `${MESES[Number(m) - 1]}/${a.slice(2)}`,
      esquerda: (diasEntre(inicio, atual) / totalDias) * 100,
      largura: (diasEntre(atual, proxima) / totalDias) * 100,
    });
    atual = proxima;
  }

  const posicao = (iso: string) => (diasEntre(inicio, iso.slice(0, 10)) / totalDias) * 100;
  const barra = (ini: string, f: string) => {
    const a = ini.slice(0, 10);
    const b = f.slice(0, 10);
    const [de2, ate2] = a <= b ? [a, b] : [b, a];
    return { esquerda: posicao(de2), largura: Math.max(((diasEntre(de2, ate2) + 1) / totalDias) * 100, 0.5) };
  };
  return { escala, inicio, fim, totalDias, marcas, posicao, barra };
}
