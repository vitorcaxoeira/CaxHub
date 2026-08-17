import axios from "axios";
import { useCallback, useEffect, useState } from "react";

export interface PontoPorDia {
  data: string; // YYYY-MM-DD
  minutos: number;
}

export interface PontoPorProjeto {
  chave: string;
  nome: string;
  valor: number;
}

export interface ResumoConsultor {
  periodo: { de: string; ate: string };
  totalMinutos: number;
  porDia: PontoPorDia[];
  porProjeto: PontoPorProjeto[];
  metaDiariaMinutos: number | null;
  metaTotalMinutos: number;
  // null = nenhum dia do período tem jornada cadastrada (sem meta pra falar de saldo).
  saldoMinutos: number | null;
  valorHora: number | null;
  ganhoAteAgora: number | null;
  projecaoGanho: number | null;
  sessoesPendentes: number;
  ratsPendentes: number;
  notificacoesNaoLidas: number;
}

// `semConsultor: true` é o mesmo shape de /dashboard/meu-perfil pra usuário sem registro de
// Consultor — a Home decide não montar o dashboard nesse caso (ver DashboardConsultor.tsx).
type RespostaResumo = ResumoConsultor | { semConsultor: true };

export function useDashboardConsultor(periodo?: { de: string; ate: string }) {
  const [resumo, setResumo] = useState<ResumoConsultor | null>(null);
  const [semConsultor, setSemConsultor] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    setLoading(true);
    const params = periodo ? { de: periodo.de, ate: periodo.ate } : undefined;
    axios
      .get<RespostaResumo>("/api/dashboard/meu-resumo", { params })
      .then(({ data }) => {
        if ("semConsultor" in data) {
          setSemConsultor(true);
          setResumo(null);
        } else {
          setSemConsultor(false);
          setResumo(data);
        }
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Não foi possível carregar o resumo"))
      .finally(() => setLoading(false));
  }, [periodo?.de, periodo?.ate]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return { resumo, semConsultor, loading, erro, recarregar: carregar };
}
