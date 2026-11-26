import axios from "axios";
import { useEffect, useState } from "react";

// Peças compartilhadas das telas da Gestão de Bonificação. Formatadores, selo e modal de justificativa são os mesmos da Gestão de Descontos.
export { classeFiltro, fmtCompetencia, fmtData, fmtDataHora, fmtMoeda, mensagemDe, ModalJustificativa, Selo } from "../projetos/descontos/comum";

export interface AcessoBonificacao {
  administra: boolean;
  gestao: boolean;
  visualiza: boolean;
  proprioCodfor: number | null;
}

/** Acesso da pessoa ao módulo (o backend decide; as telas só escondem o que ela não pode usar). */
export function useAcessoBonificacao(): AcessoBonificacao | null {
  const [acesso, setAcesso] = useState<AcessoBonificacao | null>(null);
  useEffect(() => {
    let cancelado = false;
    axios
      .get<AcessoBonificacao>("/api/bonificacao/meu-acesso")
      .then(({ data }) => !cancelado && setAcesso(data))
      .catch(() => !cancelado && setAcesso({ administra: false, gestao: false, visualiza: false, proprioCodfor: null }));
    return () => {
      cancelado = true;
    };
  }, []);
  return acesso;
}

export interface ProcessoResumo {
  id: number;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  compoeNota: boolean;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  indicadores: number;
  enquadramentos: number;
}

/** Processos cadastrados (para os seletores do topo das telas). */
export function useProcessos(recarga = 0) {
  const [processos, setProcessos] = useState<ProcessoResumo[]>([]);
  useEffect(() => {
    let cancelado = false;
    axios
      .get<{ processos: ProcessoResumo[] }>("/api/bonificacao/processos")
      .then(({ data }) => !cancelado && setProcessos(data.processos))
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [recarga]);
  return processos;
}

export interface OpcaoConsultor {
  codfor: number;
  nome: string;
}

export function useConsultores() {
  const [consultores, setConsultores] = useState<OpcaoConsultor[]>([]);
  useEffect(() => {
    let cancelado = false;
    axios
      .get<{ consultores: OpcaoConsultor[] }>("/api/bonificacao/consultores")
      .then(({ data }) => !cancelado && setConsultores(data.consultores))
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, []);
  return consultores;
}

export type UnidadeIndicador = "quantidade" | "percentual" | "horas";
export type SentidoIndicador = "menor_melhor" | "maior_melhor";

export interface Faixa {
  limite: number | null;
  pontos: number;
}

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });
export const fmtNumero = (v: number | null | undefined) => (v == null ? "—" : numero.format(v));
export const fmtPontos = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(v));

/** Valor de um indicador com a unidade ("12,25", "50,85%", "8 h"). */
export function fmtValorIndicador(v: number | null | undefined, unidade: UnidadeIndicador | string): string {
  if (v == null) return "—";
  if (unidade === "percentual") return `${fmtNumero(v)}%`;
  if (unidade === "horas") return `${fmtNumero(v)} h`;
  return fmtNumero(v);
}

/** "AAAA-MM" do mês anterior ao de hoje (o fechamento normal é do mês que acabou). */
export function competenciaPadrao(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Texto da regra para a pessoa conferir como o valor foi calculado ("até 10 → 1 pt · até 13 → 0,6 pt · demais → 0 pt"). */
export function descreverFaixas(faixas: Faixa[], sentido: SentidoIndicador | string, unidade: UnidadeIndicador | string): string {
  const prefixo = sentido === "menor_melhor" ? "até" : "a partir de";
  return faixas.map((f) => (f.limite == null ? `demais → ${fmtPontos(f.pontos)} pt` : `${prefixo} ${fmtValorIndicador(f.limite, unidade)} → ${fmtPontos(f.pontos)} pt`)).join(" · ");
}

/** Minutos → "144:58" (horas:minutos, como o relatório Horas Disponíveis x Trabalhadas). */
export function fmtHorasMinutos(minutos: number | null | undefined): string {
  if (minutos == null) return "—";
  const total = Math.round(minutos);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
