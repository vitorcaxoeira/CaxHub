import axios from "axios";
import { useEffect, useState } from "react";
import type { FiltroDashboard } from "./useDashboardConsultor";

// Espelha o retorno de GET /dashboard/meu-rdv (backend/src/domain/resumoConsultor.ts,
// rdvDoConsultor). Valores já chegam como number (Number() feito no backend).
export interface ItemRdvEmRat {
  id: number;
  numrat: number;
  sitrat: number | null;
  sitratLabel: string;
  datemiRat: string | null;
  datemi: string | null;
  desrdv: string | null;
  tipdesLabel: string;
  qtdrdv: number | null;
  vlrunt: number;
  vlrtot: number;
}

export interface ItemTituloRdv {
  codemp: number;
  codfil: number;
  numtit: string;
  datemi: string;
  vctpro: string;
  vlrori: number;
  vlrabe: number;
  obstcp: string | null;
}

export interface GrupoRdv<T> {
  total: number;
  itens: T[];
}

export interface RdvConsultor {
  rdvEmRat: GrupoRdv<ItemRdvEmRat>;
  titulos: {
    vencidos: GrupoRdv<ItemTituloRdv>;
    esteMes: GrupoRdv<ItemTituloRdv>;
    proximosMeses: GrupoRdv<ItemTituloRdv>;
  };
}

type RespostaRdv = RdvConsultor | { semConsultor: true };

// Chamada separada do /meu-resumo de propósito: uma falha aqui não derruba o painel inteiro,
// só o card de RDV.
export function useRdvConsultor(filtro: FiltroDashboard) {
  const [rdv, setRdv] = useState<RdvConsultor | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Incrementado por `recarregar` (ex.: depois do "Atualizar" do card) pra refazer a busca sem
  // mudar o filtro.
  const [versao, setVersao] = useState(0);

  const anosChave = filtro.anos.join(",");
  const mesesChave = filtro.meses.join(",");

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    axios
      .get<RespostaRdv>("/api/dashboard/meu-rdv", { params: { anos: anosChave, meses: mesesChave, codfor: filtro.codfor } })
      .then(({ data }) => {
        if (cancelado) return;
        setRdv("semConsultor" in data ? null : data);
        setErro(null);
      })
      .catch((err) => {
        if (!cancelado) setErro(err.response?.data?.error ?? "Não foi possível carregar os valores de RDV");
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [anosChave, mesesChave, filtro.codfor, versao]);

  return { rdv, loading, erro, recarregar: () => setVersao((v) => v + 1) };
}
