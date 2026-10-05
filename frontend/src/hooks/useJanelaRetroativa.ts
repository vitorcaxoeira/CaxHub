import axios from "axios";
import { useEffect, useState } from "react";

// Janela de retroatividade do consultor logado: até qual dia (AAAA-MM-DD) ele ainda pode pedir
// apontamento avulso ou ajuste de horário. Só serve pra travar o calendário e explicar o porquê —
// quem recusa de verdade é o backend (409, domain/janelaRetroativa.ts), então uma falha aqui
// (usuário sem consultor, rede) deixa `null` e a tela segue sem trava visual.
export interface JanelaRetroativa {
  diasRetroativos: number;
  primeiroDiaPermitido: string;
}

export function useJanelaRetroativa(): JanelaRetroativa | null {
  const [janela, setJanela] = useState<JanelaRetroativa | null>(null);

  useEffect(() => {
    let cancelado = false;
    axios
      .get<JanelaRetroativa>("/api/jornadas/minha-janela")
      .then(({ data }) => !cancelado && setJanela(data))
      .catch(() => !cancelado && setJanela(null));
    return () => {
      cancelado = true;
    };
  }, []);

  return janela;
}

// "2026-10-02" -> "02/10"
export function diaCurtoDaJanela(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

// Frase única pras duas telas (apontamento avulso e ajuste), pra não divergirem.
export function textoJanelaRetroativa(janela: JanelaRetroativa): string {
  const quando =
    janela.diasRetroativos === 0
      ? `só para hoje (${diaCurtoDaJanela(janela.primeiroDiaPermitido)})`
      : `a partir de ${diaCurtoDaJanela(janela.primeiroDiaPermitido)}`;
  return `Pedidos permitidos ${quando}. Para datas anteriores, peça ao seu líder para liberar dias retroativos.`;
}
