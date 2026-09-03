// Mapa único de configuração visual por evento_tipo — adicionar um evento novo no
// futuro (Fase 4+) é só acrescentar uma entrada aqui, sem mexer no resto da tela.
import { ReactNode } from "react";

export interface EventoAuditoria {
  id: string;
  ocorridoEm: string;
  usuarioId: number | null;
  usuarioNome: string | null;
  usuarioFotoUrl: string | null;
  origem: "tela" | "api" | "job" | "integracao_senior";
  codemp: number | null;
  codpro: number | null;
  entidadeTipo: string;
  entidadeId: string;
  entidadeRotulo: string | null;
  eventoTipo: string;
  alteracoes: Record<string, { de: unknown; para: unknown; rotulo: string }> | null;
  metadata: Record<string, unknown> | null;
  correlationId: string;
}

export interface GrupoAuditoria {
  correlationId: string;
  ocorridoEm: string;
  origem: string;
  eventos: EventoAuditoria[];
}

export type ToneAuditoria = "success" | "warning" | "destructive" | "neutral" | "primary";

export const toneBadgeAuditoria: Record<ToneAuditoria, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  neutral: "bg-muted/15 text-muted",
  primary: "bg-primary/15 text-primary",
};

function IconeCriacao() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}
function IconeEdicao() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function IconeRemocao() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="6" y1="18" x2="18" y2="6" />
    </svg>
  );
}
function IconeStatus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12a8 8 0 0 1 14.5-4.5" />
      <polyline points="19 3 19 8 14 8" />
      <path d="M20 12a8 8 0 0 1-14.5 4.5" />
      <polyline points="5 21 5 16 10 16" />
    </svg>
  );
}
function IconeKanban() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </svg>
  );
}
function IconeExecucao() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}
// Ícone só dela — cadeado — pra dar "destaque especial" (pedido do Vitor) a
// PROPOSTA_BLOQUEIO_EXCEDENTE_ALTERADO: é uma mudança de regra de negócio (quem pode
// estourar o saldo do item na estrutura inteira), não um campo qualquer de cadastro, e por
// isso ganha um ícone e um tone (warning) próprios em vez de reaproveitar IconeEdicao/neutral.
function IconeBloqueio() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function IconeSenior() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4Z" />
    </svg>
  );
}

interface ConfigEvento {
  tone: ToneAuditoria;
  rotuloGrupo: string;
  icone: () => ReactNode;
  resumo: (evento: EventoAuditoria) => string;
}

function rotuloEntidade(evento: EventoAuditoria): string {
  return evento.entidadeRotulo ?? `${evento.entidadeTipo} ${evento.entidadeId}`;
}

function contarAlteracoes(evento: EventoAuditoria): number {
  return evento.alteracoes ? Object.keys(evento.alteracoes).length : 0;
}

export const CONFIG_EVENTO_AUDITORIA: Record<string, ConfigEvento> = {
  PROPOSTA_CRIADA: {
    tone: "success",
    rotuloGrupo: "Proposta",
    icone: IconeCriacao,
    resumo: (e) => `Proposta criada — ${rotuloEntidade(e)}`,
  },
  PROPOSTA_ALTERADA: {
    tone: "neutral",
    rotuloGrupo: "Proposta",
    icone: IconeEdicao,
    resumo: (e) => `Alterou ${contarAlteracoes(e)} campo(s) da ${rotuloEntidade(e)}`,
  },
  PROPOSTA_STATUS_ALTERADO: {
    tone: "primary",
    rotuloGrupo: "Proposta",
    icone: IconeStatus,
    resumo: (e) =>
      `Mudou a situação da ${rotuloEntidade(e)} de "${e.metadata?.status_de ?? "—"}" para "${e.metadata?.status_para ?? "—"}"`,
  },
  PROPOSTA_ITEM_CRIADO: {
    tone: "success",
    rotuloGrupo: "Item da Proposta",
    icone: IconeCriacao,
    resumo: (e) => `Item criado — ${rotuloEntidade(e)}`,
  },
  PROPOSTA_ITEM_ALTERADO: {
    tone: "neutral",
    rotuloGrupo: "Item da Proposta",
    icone: IconeEdicao,
    resumo: (e) => `Alterou ${contarAlteracoes(e)} campo(s) do ${rotuloEntidade(e)}`,
  },
  // Mudança de regra de negócio (trava de "salvar mesmo excedendo" no Cronograma) — tone
  // "warning" + ícone de cadeado próprio, de propósito: pra saltar aos olhos na linha do
  // tempo, diferente de PROPOSTA_ALTERADA (tone neutro, ícone de lápis).
  PROPOSTA_BLOQUEIO_EXCEDENTE_ALTERADO: {
    tone: "warning",
    rotuloGrupo: "Configuração de Alocação",
    icone: IconeBloqueio,
    resumo: (e) =>
      `${e.metadata?.bloqueio_para === "Ligado" ? "Ligou" : "Desligou"} a trava de horas acima do saldo do item na estrutura — ${rotuloEntidade(e)}`,
  },
  // Bloqueio de apontamento/excedente por PROPOSTA e por ALOCAÇÃO (gestor pode travar só uma
  // atividade de um consultor) — mesmo tone/ícone de destaque de PROPOSTA_BLOQUEIO_EXCEDENTE_ALTERADO
  // acima, mas conceito diferente: aquele é sobre EDITAR a duração da EAP; estes são sobre
  // apontar hora de verdade e sobre autorizar/solicitar horas excedentes já trabalhadas.
  PROPOSTA_BLOQUEIO_APONTAMENTO_ALTERADO: {
    tone: "warning",
    rotuloGrupo: "Configuração de Apontamento",
    icone: IconeBloqueio,
    resumo: (e) =>
      `${e.metadata?.bloqueio_para === "Ligado" ? "Ligou" : "Desligou"} o bloqueio de apontamento da proposta — ${rotuloEntidade(e)}`,
  },
  PROPOSTA_BLOQUEIO_HORAS_EXCEDENTES_ALTERADO: {
    tone: "warning",
    rotuloGrupo: "Configuração de Apontamento",
    icone: IconeBloqueio,
    resumo: (e) =>
      `${e.metadata?.bloqueio_para === "Ligado" ? "Ligou" : "Desligou"} o bloqueio de horas excedentes da proposta — ${rotuloEntidade(e)}`,
  },
  ALOCACAO_CRIADA: {
    tone: "success",
    rotuloGrupo: "Alocação",
    icone: IconeCriacao,
    resumo: (e) => `Criou alocação — ${rotuloEntidade(e)}`,
  },
  ALOCACAO_ALTERADA: {
    tone: "neutral",
    rotuloGrupo: "Alocação",
    icone: IconeEdicao,
    // O resumo era fixo em "as horas alocadas", e a mesma rota também grava mudança de
    // horas EXCEDENTES — o evento dizia a coisa errada metade das vezes. Agora sai do que
    // realmente veio em `alteracoes`.
    resumo: (e) => {
      const campos = Object.keys(e.alteracoes ?? {});
      const oQue =
        campos.length === 0
          ? "a alocação"
          : campos.length === 1 && campos[0] === "horasExcedentes"
            ? "as horas excedentes"
            : campos.length === 1 && campos[0] === "qtdhor"
              ? "as horas alocadas"
              : "as horas alocadas e as excedentes";
      return `Alterou ${oQue} — ${rotuloEntidade(e)}`;
    },
  },
  // Equivalente por alocação dos dois eventos de proposta acima — gestor bloqueia só esta
  // atividade de UM consultor, sem mexer na proposta inteira.
  ALOCACAO_BLOQUEIO_APONTAMENTO_ALTERADO: {
    tone: "warning",
    rotuloGrupo: "Configuração de Apontamento — Alocação",
    icone: IconeBloqueio,
    resumo: (e) =>
      `${e.metadata?.bloqueio_para === "Ligado" ? "Ligou" : "Desligou"} o bloqueio de apontamento desta atividade — ${rotuloEntidade(e)}`,
  },
  ALOCACAO_BLOQUEIO_HORAS_EXCEDENTES_ALTERADO: {
    tone: "warning",
    rotuloGrupo: "Configuração de Apontamento — Alocação",
    icone: IconeBloqueio,
    resumo: (e) =>
      `${e.metadata?.bloqueio_para === "Ligado" ? "Ligou" : "Desligou"} o bloqueio de horas excedentes desta atividade — ${rotuloEntidade(e)}`,
  },
  EXCEDENTE_SOLICITADO: {
    tone: "warning",
    rotuloGrupo: "Horas Excedentes",
    icone: IconeCriacao,
    resumo: (e) => `Solicitou horas excedentes — ${rotuloEntidade(e)}`,
  },
  EXCEDENTE_APROVADO: {
    tone: "success",
    rotuloGrupo: "Horas Excedentes",
    icone: IconeCriacao,
    resumo: (e) => `Aprovou horas excedentes — ${rotuloEntidade(e)}`,
  },
  EXCEDENTE_REPROVADO: {
    tone: "destructive",
    rotuloGrupo: "Horas Excedentes",
    icone: IconeRemocao,
    resumo: (e) => `Reprovou o pedido de horas excedentes — ${rotuloEntidade(e)}`,
  },
  APONTAMENTO_SOLICITADO: {
    tone: "warning",
    rotuloGrupo: "Apontamento",
    icone: IconeCriacao,
    resumo: (e) => `Solicitou apontamento avulso — ${rotuloEntidade(e)}`,
  },
  APONTAMENTO_APROVADO: {
    tone: "success",
    rotuloGrupo: "Apontamento",
    icone: IconeCriacao,
    resumo: (e) => `Aprovou apontamento avulso — ${rotuloEntidade(e)}`,
  },
  APONTAMENTO_REPROVADO: {
    tone: "destructive",
    rotuloGrupo: "Apontamento",
    icone: IconeRemocao,
    resumo: (e) => `Reprovou o apontamento avulso — ${rotuloEntidade(e)}`,
  },
  APONTAMENTO_EXCLUIDO: {
    tone: "destructive",
    rotuloGrupo: "Apontamento",
    icone: IconeRemocao,
    resumo: (e) => `Excluiu um apontamento — ${rotuloEntidade(e)}`,
  },
  AJUSTE_SOLICITADO: {
    tone: "warning",
    rotuloGrupo: "Ajuste de horário",
    icone: IconeEdicao,
    resumo: (e) => `Pediu ajuste de horário — ${rotuloEntidade(e)}`,
  },
  AJUSTE_APROVADO: {
    tone: "success",
    rotuloGrupo: "Ajuste de horário",
    icone: IconeEdicao,
    resumo: (e) => `Aprovou o ajuste de horário — ${rotuloEntidade(e)}`,
  },
  AJUSTE_REPROVADO: {
    tone: "destructive",
    rotuloGrupo: "Ajuste de horário",
    icone: IconeRemocao,
    resumo: (e) => `Reprovou o ajuste de horário — ${rotuloEntidade(e)}`,
  },
  // Pedido de mudança nas 3 flags de configuração da proposta (Cronograma) e a decisão de
  // quem tem alçada — mesmo tom das outras 3 famílias de solicitação (warning/success/
  // destructive). A mudança da flag em si (aprovada) ainda gera o evento PRÓPRIO dela
  // (PROPOSTA_BLOQUEIO_*_ALTERADO, ver acima) na mesma decisão — os dois aparecem juntos.
  PROPOSTA_CONFIG_SOLICITADA: {
    tone: "warning",
    rotuloGrupo: "Configuração da Proposta",
    icone: IconeCriacao,
    resumo: (e) => `Solicitou mudança de configuração — ${rotuloEntidade(e)}`,
  },
  PROPOSTA_CONFIG_APROVADA: {
    tone: "success",
    rotuloGrupo: "Configuração da Proposta",
    icone: IconeCriacao,
    resumo: (e) => `Aprovou mudança de configuração — ${rotuloEntidade(e)}`,
  },
  PROPOSTA_CONFIG_REPROVADA: {
    tone: "destructive",
    rotuloGrupo: "Configuração da Proposta",
    icone: IconeRemocao,
    resumo: (e) => `Reprovou mudança de configuração — ${rotuloEntidade(e)}`,
  },
  ALOCACAO_REMOVIDA: {
    tone: "destructive",
    rotuloGrupo: "Alocação",
    icone: IconeRemocao,
    resumo: (e) => `Removeu alocação — ${rotuloEntidade(e)}`,
  },
  DATA_INCLUIDA: {
    tone: "success",
    rotuloGrupo: "Datas",
    icone: IconeCriacao,
    resumo: (e) => `Incluiu ${e.metadata?.campo ?? "uma data"} em ${rotuloEntidade(e)}`,
  },
  DATA_ALTERADA: {
    tone: "neutral",
    rotuloGrupo: "Datas",
    icone: IconeEdicao,
    resumo: (e) => `Alterou ${e.metadata?.campo ?? "uma data"} de ${rotuloEntidade(e)}`,
  },
  KANBAN_RAIA_ALTERADA: {
    tone: "primary",
    rotuloGrupo: "Kanban",
    icone: IconeKanban,
    resumo: (e) => `Moveu ${rotuloEntidade(e)} de "${e.metadata?.raia_de ?? "—"}" para "${e.metadata?.raia_para ?? "—"}"`,
  },
  ATIVIDADE_INICIADA: {
    tone: "success",
    rotuloGrupo: "Execução",
    icone: IconeExecucao,
    resumo: (e) => `Iniciou execução — ${rotuloEntidade(e)}`,
  },
  ATIVIDADE_PARADA: {
    tone: "neutral",
    rotuloGrupo: "Execução",
    icone: IconeExecucao,
    resumo: (e) => `Parou execução — ${rotuloEntidade(e)}`,
  },
  ATIVIDADE_AJUSTADA: {
    tone: "neutral",
    rotuloGrupo: "Execução",
    icone: IconeEdicao,
    resumo: (e) => `Ajustou escopo — ${rotuloEntidade(e)}`,
  },
  ATIVIDADE_ENVIADA_SENIOR: {
    tone: "primary",
    rotuloGrupo: "Integração Senior",
    icone: IconeSenior,
    resumo: (e) => `Enviou ${rotuloEntidade(e)} ao Senior — ${e.metadata?.sucesso ? "sucesso" : "falha"}`,
  },
  RAT_ITEM_DESVINCULADO_SENIOR: {
    tone: "warning",
    rotuloGrupo: "Integração Senior",
    icone: IconeSenior,
    resumo: (e) => {
      const seqrats = Array.isArray(e.metadata?.seqratsDesvinculados) ? e.metadata.seqratsDesvinculados : [];
      const quantos = seqrats.length;
      return `${quantos} apontamento(s) apagado(s) no Senior — vínculo removido pra reintegrar (${rotuloEntidade(e)})`;
    },
  },
};

const CONFIG_PADRAO: ConfigEvento = {
  tone: "neutral",
  rotuloGrupo: "Outro",
  icone: IconeEdicao,
  resumo: (e) => `${e.eventoTipo} — ${rotuloEntidade(e)}`,
};

export function configEvento(eventoTipo: string): ConfigEvento {
  return CONFIG_EVENTO_AUDITORIA[eventoTipo] ?? CONFIG_PADRAO;
}

// Prioridade de "qual evento representa a ação inteira" quando um grupo (correlationId)
// tem mais de um evento — o mais específico/relevante pro usuário vem primeiro.
const PRIORIDADE_RESUMO_GRUPO = [
  "PROPOSTA_BLOQUEIO_EXCEDENTE_ALTERADO",
  "PROPOSTA_BLOQUEIO_APONTAMENTO_ALTERADO",
  "PROPOSTA_BLOQUEIO_HORAS_EXCEDENTES_ALTERADO",
  "ALOCACAO_BLOQUEIO_APONTAMENTO_ALTERADO",
  "ALOCACAO_BLOQUEIO_HORAS_EXCEDENTES_ALTERADO",
  "KANBAN_RAIA_ALTERADA",
  "PROPOSTA_STATUS_ALTERADO",
  "ATIVIDADE_ENVIADA_SENIOR",
  "ATIVIDADE_INICIADA",
  "ATIVIDADE_PARADA",
  "ALOCACAO_CRIADA",
  "ALOCACAO_REMOVIDA",
  "PROPOSTA_CRIADA",
  "PROPOSTA_ITEM_CRIADO",
];

export function resumoGrupo(grupo: GrupoAuditoria): string {
  if (grupo.eventos.length === 0) return "";
  if (grupo.eventos.length === 1) return configEvento(grupo.eventos[0].eventoTipo).resumo(grupo.eventos[0]);

  const principal =
    grupo.eventos.find((e) => PRIORIDADE_RESUMO_GRUPO.includes(e.eventoTipo)) ?? grupo.eventos[0];
  const resumoPrincipal = configEvento(principal.eventoTipo).resumo(principal);
  const restantes = grupo.eventos.length - 1;
  return `${resumoPrincipal} (+${restantes} alteração${restantes > 1 ? "ões" : ""})`;
}

// Tone "representativo" do grupo inteiro (usado no badge da linha do tempo) — mesmo
// critério de prioridade do resumo.
export function toneGrupo(grupo: GrupoAuditoria): ToneAuditoria {
  if (grupo.eventos.length === 0) return "neutral";
  const principal = grupo.eventos.find((e) => PRIORIDADE_RESUMO_GRUPO.includes(e.eventoTipo)) ?? grupo.eventos[0];
  return configEvento(principal.eventoTipo).tone;
}
