import axios from "axios";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatHoras } from "../../utils/horas";
import { paraInputData, paraInputHora } from "../../utils/inputsDataHora";
import { Skeleton } from "../../components/ui/Skeleton";
import { Spinner } from "../../components/ui/Spinner";
import { DropdownMenu } from "../../components/ui/DropdownMenu";
import { MultiSelectDropdown } from "../../components/ui/MultiSelectDropdown";
import { SelectBuscavel } from "../../components/ui/SelectBuscavel";
import { ModalEditarDescricao } from "../../components/projetos/ModalEditarDescricao";
import { ModalManutencaoSessao, type DadosManutencaoSessao } from "../../components/projetos/ModalManutencaoSessao";
import { DespesasRatPainel } from "../../components/projetos/DespesasRatPainel";
import { Tabs } from "../../components/ui/Tabs";
import { Modal } from "../../components/ui/Modal";
import { AtividadeDetalhe } from "../../components/projetos/AtividadeDetalhe";
import { toneBadge, type Tone } from "../../components/ui/badges";
import { IconeIntegracaoErp } from "../../components/ui/IconeIntegracaoErp";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { diaCurtoDaJanela, textoJanelaRetroativa, useJanelaRetroativa } from "../../hooks/useJanelaRetroativa";
import { useToast } from "../../components/ui/Toast";
import { regras } from "../../components/ui/padroesFiltros/regras";
import { usePadroesTela } from "../../components/ui/padroesFiltros/usePadroesTela";
import { ListaServidor } from "../../components/colunas/ListaServidor";
import { TabelaLocal } from "../../components/colunas/TabelaLocal";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";
import { formatHoraDoDia, LOCAIS_ATIVIDADES, lerAtividade, rotuloItem } from "./atividadesRat";

// Pedido de correcao de horario aguardando o gestor. Enquanto existe, o envio do
// apontamento ao Senior fica retido no servidor.
interface AjustePendente {
  id: number;
  inicioSolicitado: string;
  fimSolicitado: string;
  motivo: string;
  criadoEm: string;
}

interface SessaoPendente {
  id: number;
  atividadeId: number;
  // Junto de codfor, é a chave EXATA que o servidor usa pra encapsular na RAT
  // (buscarOuCriarRatRascunho: codemp+codfor+codpro) — usada no agrupamento do resumo do
  // "Confirmar Todos", pra nunca divergir do agrupamento real.
  codemp: number;
  codpro: number;
  numprj: number | null;
  cliente: string | null;
  codcli: number | null;
  itemDescricao: string | null;
  seqite: number | null;
  colunaNome: string;
  inicio: string;
  fim: string;
  duracaoMinutos: number;
  origem: string;
  observacao: string | null;
  codfor: number;
  // Preenchido só quando `mostrarConsultor` (admin, ou gestor vendo o time) — o consultor
  // comum só vê as próprias sessões, então mostrar o nome dele em toda linha seria ruído.
  consultorNome: string | null;
  // Editar descrição, pedir ajuste e excluir são "só o dono" nos respectivos endpoints —
  // controla quais ações do menu "⋯" a tela oferece (Confirmar não depende disto).
  souDono: boolean;
  // Exclusão também libera pro admin sobre sessão de qualquer consultor — diferente de
  // editar descrição/pedir ajuste, que continuam "só o dono" (ver souDono acima).
  podeExcluir: boolean;
  ajustePendente: AjustePendente | null;
  // Previsão de "vai dar erro ao confirmar" (ver GET /sessoes-pendentes) — as duas causas
  // que hoje só o clique em "Confirmar" descobre: status de sincronização da alocação por
  // trás da sessão (mesmo indicador do Cronograma) e duração que trunca pra zero minuto no
  // relógio do Senior. O backend sempre calcula os dois primeiros (nunca vêm null).
  integracaoErpLabel: string;
  integracaoErpTone: Tone;
  integracaoErpErro: string | null;
  duracaoInvalida: boolean;
  // Mesma previsão acima, agora pro bloqueio de apontamento (ver
  // domain/bloqueioApontamento.ts, backend) — confirmar essa sessão vai recusar 409.
  bloqueadoApontamentoEfetivo: boolean;
}

// RAT Digitada candidata a receber a sessão confirmada (ver GET /sessoes-pendentes,
// `ratsDestino`). A descrição dos itens recentes é o que deixa reconhecer qual RAT é qual —
// ex.: uma RAT por filial do cliente, e a filial só aparece no texto do item.
interface RatDestinoOpcao {
  id: number;
  numrat: number | null;
  datemi: string | null;
  qtdItens: number;
  minutos: number;
  recentes: { datati: string | null; desati: string | null }[];
}

// Valor do seletor: id da RAT (como texto) ou "nova".
const DESTINO_NOVA = "nova";

function chaveGrupoRat(s: { codemp: number; codfor: number; codpro: number }): string {
  return `${s.codemp}-${s.codfor}-${s.codpro}`;
}

function ratDestinoDoValor(valor: string | null | undefined): { ratId: number } | { nova: true } | undefined {
  if (!valor) return undefined;
  if (valor === DESTINO_NOVA) return { nova: true };
  const ratId = Number(valor);
  return Number.isInteger(ratId) && ratId > 0 ? { ratId } : undefined;
}

function rotuloRatDestino(r: RatDestinoOpcao): string {
  return `RAT ${r.numrat ?? `local ${r.id}`}${r.datemi ? ` · ${dateFormatter.format(new Date(r.datemi))}` : ""}`;
}

interface AtividadeResumo {
  id: number;
  codpro: number;
  seqite: number | null;
  itemDescricao: string | null;
  // Usado no cabeçalho do grupo do seletor — número de proposta sozinho não identifica o
  // projeto pra quem lança pelo time.
  cliente: string | null;
}

// Espelha backend/src/domain/ratDominio.ts (IntegracaoErpStatus) — status agregado de
// integração da RAT com o Senior, pior caso entre os itens dela.
type IntegracaoErpStatus = "sincronizado" | "enviando" | "falha" | "pendente";

// Opções do filtro — enum fixo de 4 valores, sem endpoint de opções dedicado (mesma ideia de
// MESES_OPCOES em lib/periodos.ts).
const OPCOES_INTEGRACAO: { value: IntegracaoErpStatus; label: string }[] = [
  { value: "falha", label: "Falha no envio" },
  { value: "enviando", label: "Enviando" },
  { value: "pendente", label: "Pendente" },
  { value: "sincronizado", label: "Sincronizado" },
];

interface RatRow {
  id: number;
  numrat: number | null;
  datemi: string | null;
  codemp: number;
  codpro: number | null;
  numprj: number | null;
  cliente: string | null;
  codfor: number;
  consultorNome: string;
  sitrat: number | null;
  sitratLabel: string;
  sitratTone: Tone;
  totalItens: number;
  totalMinutos: number;
  // Status agregado de integração com o Senior (28/08/2026) — pior caso entre os itens da RAT
  // (ver calcularIntegracaoErp em backend/src/domain/ratDominio.ts). Não é o mesmo domínio de
  // sitrat: sitrat é a situação da RAT no ERP (Digitado/Aprovado/...), integracao é se os
  // apontamentos dela já chegaram lá.
  integracao: IntegracaoErpStatus;
  integracaoLabel: string;
  integracaoTone: Tone;
  // Elegível pra fechamento (13/09/2026): sitrat=9 + mesma permissão de aprovar (gestor do
  // depexe ou admin) — ver GET /rats em backend/src/routes/rats.ts. Campo próprio de
  // podeAprovar (mesma condição hoje, mas ações distintas).
  podeFechar: boolean;
}

// RAT elegível pro resumo de "Fechar Todos" — vem de GET /rats/elegiveis-fechamento, SEM
// paginação (a tabela principal só tem a página atual em `rats`, ver carregarRats).
interface RatElegivelFechamento {
  id: number;
  numrat: number | null;
  codpro: number | null;
  cliente: string | null;
  consultorNome: string;
  totalMinutos: number;
}

interface RatItemRow {
  id: number;
  sessaoId: number | null;
  atividadeId: number | null;
  codser: string | null;
  itemDescricao: string | null;
  // Sequência do item na proposta — vira prefixo da descrição na coluna Item.
  seqite: number | null;
  datati: string | null;
  horini: number | null;
  horfim: number | null;
  duracaoMinutos: number | null;
  desati: string | null;
  confirmadoNoSenior: boolean;
  // Preenchido quando o item foi excluído no Senior (origemCaxHub=false, nunca teve sessão
  // local — ver desvincularItensAusentesNoSenior no backend). numrat/seqrat continuam
  // preenchidos como histórico, então não dá pra distinguir isso só por confirmadoNoSenior.
  removidoEmSenior: string | null;
  editavel: boolean;
  // Motivo da última recusa do Senior. Preenchido = a integração falhou e há o que reenviar.
  envioErro: string | null;
  // Identidade no Senior — preenchida quando o apontamento foi registrado no ERP. É o
  // que trava editar/excluir, então a tela precisa mostrar por quê.
  numrat: number | null;
  seqrat: number | null;
  // Estado do envio ao ERP: pendente | enviando | enviado | bloqueado | null.
  envioStatus: string | null;
  // Alteração da sessão pelo admin ainda não equalizada no Senior (tipEve A): "enviando" | "falha" | null (em dia).
  edicaoStatus: "enviando" | "falha" | null;
  edicaoErro: string | null;
  // Manutenção da sessão (só admin, RAT Digitada) — decidido pelo servidor, a tela só reflete.
  podeManterSessao: boolean;
  motivoBloqueioManutencao: string | null;
}

interface ConsultorFiltro {
  codfor: number;
  nome: string;
}

// Opções do filtro de situação da RAT (USU_LSITRAT) — vêm do backend (GET
// /rats/opcoes-filtro), que reaproveita o mesmo domínio de backend/src/domain/ratDominio.ts
// já usado no rótulo/tom de cada linha (sitratLabel/sitratTone). Sem lista fixa aqui: uma
// única fonte pro rótulo/ordem.
interface SituacaoRatOpcao {
  sitrat: number;
  label: string;
}

// Cabeçalho da atividade devolvido por GET /atividades/:id/detalhe — o mesmo conjunto que
// a tela de Atividades passa por prop pro AtividadeDetalhe. Só os campos consumidos aqui.
interface AtividadeDetalheDados {
  id: number;
  codemp: number;
  codpro: number;
  numprj: number | null;
  dataPrevistaInicio: string | null;
  dataPrevistaFim: string | null;
  itemDescricao: string | null;
  itemQtdhor: number | null;
  itemAlocado: number;
  itemRealizado: number;
  estruturaNome: string | null;
  estruturaPercentual: number | null;
  estruturaAtividadeId: number | null;
  depexeLabel: string;
  podeVerCronograma: boolean;
  // Opcionais porque esta tela monta o objeto a partir de outra rota, que pode não trazer
  // os dois — o painel trata a ausência como "sem excedente".
  qtdhorPrevisto?: number | null;
  horasExcedentes?: number;
  horasRealizadas: number;
}

const dataCurtaFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const horaCurtaFormatter = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

function formatHorario(inicioIso: string, fimIso: string): string {
  return `${horaCurtaFormatter.format(new Date(inicioIso))}–${horaCurtaFormatter.format(new Date(fimIso))}`;
}

function formatMinutos(minutos: number): string {
  return formatHoras(minutos / 60);
}

// Quando a observação de um item pode ser alterada: as mesmas condições que o backend
// valida em PATCH /apontamentos/:id (dono, RAT ainda Digitada, item não registrado no
// Senior) mais a guarda de envio em voo — nesse instante o job já leu o registro pra
// montar o payload, então a edição não chegaria ao ERP.
function podeEditarObservacao(item: RatItemRow): boolean {
  return item.editavel && item.sessaoId != null && item.envioStatus !== "enviando";
}

// Tabela de RATs com filtro e ordem por coluna, colunas configuráveis, resumo no rodapé e colunas calculadas (04/11/2026): ListaServidor
// sobre GET /rats/lista (backend/src/domain/ratsListaSql.ts, tudo resolvido no banco). Os filtros do topo continuam os mesmos e com a
// estrela de padrão; a linha abre o acordeão de Atividades/RDVs (várias abertas ao mesmo tempo, como antes).
const PAGE_SIZE_RATS = 30;
const OPCOES_POR_PAGINA_RATS = [10, 25, 30, 50, 100];

interface AcoesRats {
  navegar: (rota: string) => void;
  sincronizar: (rat: RatRow) => void;
  fechar: (rat: RatRow) => void;
  sincronizando: number | null;
  fechando: number | null;
  avisoSinc: Record<number, string>;
  expandidas: ReadonlySet<number>;
}

const COLUNAS_RATS: DefColuna<RatRow, AcoesRats>[] = [
  {
    nome: "id",
    titulo: "ID",
    fixa: true,
    largura: 90,
    resumos: ["contagem"],
    render: (rat, a) => (
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="text-muted">{a.expandidas.has(rat.id) ? "▾" : "▸"}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            a.navegar(`/projetos/rat/${rat.id}`);
          }}
          title="Ver detalhes e auditoria desta RAT"
          className="text-primary hover:underline"
        >
          {rat.id}
        </button>
      </p>
    ),
  },
  {
    nome: "numrat",
    titulo: "RAT",
    largura: 80,
    resumos: ["contagem", "distintos", "vazios"],
    classe: "whitespace-nowrap font-mono text-sm text-muted",
    render: (rat) => rat.numrat ?? "—",
  },
  {
    nome: "codpro",
    titulo: "Proposta",
    largura: 90,
    resumos: ["contagem", "distintos"],
    classe: "text-sm text-foreground",
    render: (rat, a) =>
      rat.codpro != null ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            a.navegar(`/projetos/proposta/${rat.codemp}/${rat.codpro}`);
          }}
          className="text-primary hover:underline"
        >
          {rat.codpro}
        </button>
      ) : (
        "—"
      ),
  },
  { nome: "cliente", titulo: "Cliente", largura: 220, classe: "text-sm text-muted", texto: (rat) => rat.cliente, render: (rat) => rat.cliente ?? "—" },
  { nome: "consultorNome", titulo: "Consultor", largura: 150, classe: "text-sm text-muted", texto: (rat) => rat.consultorNome, render: (rat) => rat.consultorNome },
  {
    nome: "datemi",
    titulo: "Emissão",
    largura: 100,
    classe: "whitespace-nowrap font-mono text-sm text-muted",
    render: (rat) => (rat.datemi ? dateFormatter.format(new Date(rat.datemi)) : "—"),
  },
  {
    nome: "sitratLabel",
    titulo: "Situação",
    largura: 120,
    render: (rat, _a, cortar) => (
      <span className={`inline-block rounded-full px-2.5 py-1 font-mono text-[10.5px] font-medium ${toneBadge[rat.sitratTone]} ${cortar ? "max-w-full truncate" : ""}`}>
        {rat.sitratLabel}
      </span>
    ),
  },
  {
    nome: "integracaoLabel",
    titulo: "Sinc. ERP",
    largura: 130,
    // Resultado do último "Sinc. ERP" (itens desvinculados, reenviados etc.) vira tooltip aqui em vez de banner no topo da tela — um
    // banner fixo continuava mostrando a última RAT sincronizada mesmo depois de sincronizar outra.
    render: (rat, a, cortar) => (
      <span
        className={`inline-block rounded-full px-2.5 py-1 font-mono text-[10.5px] font-medium ${toneBadge[rat.integracaoTone]} ${
          a.avisoSinc[rat.id] ? "cursor-help underline decoration-dotted" : ""
        } ${cortar ? "max-w-full truncate" : ""}`}
        title={a.avisoSinc[rat.id]}
      >
        {rat.integracaoLabel}
      </span>
    ),
  },
  { nome: "totalItens", titulo: "Itens", direita: true, largura: 70, classe: "font-mono text-sm tabular-nums text-muted", render: (rat) => rat.totalItens },
  {
    nome: "totalMinutos",
    titulo: "Total",
    direita: true,
    largura: 90,
    classe: "whitespace-nowrap font-mono text-sm tabular-nums text-foreground",
    formatarResumo: formatMinutos,
    render: (rat) => formatMinutos(rat.totalMinutos),
  },
  {
    nome: "acoes",
    titulo: "Ações",
    semOrdenar: true,
    direita: true,
    largura: 60,
    render: (rat, a) => (
      <span onClick={(e) => e.stopPropagation()}>
        <DropdownMenu placement="bottom-end">
          <DropdownMenu.Trigger>
            <button
              className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Ações"
            >
              ⋯
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.Item
              onSelect={() => a.sincronizar(rat)}
              disabled={a.sincronizando === rat.id}
              title="Busca o que mudou no ERP (itens e despesas) e reenvia o que ainda está pendente/com erro daqui pra lá"
            >
              {a.sincronizando === rat.id ? "Sincronizando..." : "Sinc. ERP"}
            </DropdownMenu.Item>
            {rat.podeFechar && (
              <DropdownMenu.Item
                onSelect={() => a.fechar(rat)}
                disabled={a.fechando === rat.id}
                title="Reenvia itens/despesas pendentes ou com erro (se houver) e, se tudo sincronizar, fecha a RAT no Senior"
              >
                {a.fechando === rat.id ? "Fechando..." : "Fechar RAT"}
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu>
      </span>
    ),
  },
];

// Estado da integração daquele apontamento com o Senior, na própria coluna de ação.
// A ordem vai do mais definitivo pro mais transitório:
//   registrado -> mostra a RAT (e não há mais o que fazer, nem excluir nem editar);
//   falhou     -> mostra o erro do ERP e oferece reenviar;
//   em voo     -> spinner, e o "Excluir" NÃO aparece (o backend recusaria de todo jeito,
//                 porque só libera desfazer enquanto a pendência está "pendente");
//   nada disso -> "Excluir", que é o estado normal de um apontamento ainda não enviado.
function AcaoIntegracao({
  item,
  reenviando,
  onReenviar,
  onExcluir,
  onVerErro,
}: {
  item: RatItemRow;
  reenviando: boolean;
  onReenviar: () => void;
  onExcluir: () => void;
  onVerErro: () => void;
}) {
  // Excluído no Senior (ver desvincularItensAusentesNoSenior no backend) — item nascido lá,
  // nunca teve sessão local: não existe ação possível (nem Enviar, nem Excluir, nem Reenviar).
  // Checado ANTES de confirmadoNoSenior de propósito: numrat/seqrat continuam preenchidos como
  // histórico, então sem essa ordem o item cairia no ramo de baixo como se estivesse tudo bem.
  if (item.removidoEmSenior) {
    return (
      <span
        className="font-mono text-[11px] text-destructive"
        title={`Este apontamento não existe mais no Senior — foi excluído lá em ${new Date(item.removidoEmSenior).toLocaleDateString("pt-BR")}. Preservado como histórico, sem nenhuma ação possível.`}
      >
        Excluído no Senior
      </span>
    );
  }

  // Alteração da sessão (tipEve A) a caminho ou recusada: o item está registrado, mas o Senior ainda não tem os valores novos.
  if (item.confirmadoNoSenior && (reenviando || item.edicaoStatus === "enviando")) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted" title="Enviando a alteração da sessão ao Senior">
        <Spinner className="h-3 w-3" />
        alterando no Senior...
      </span>
    );
  }
  if (item.confirmadoNoSenior && item.edicaoStatus === "falha") {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          onClick={onVerErro}
          className="text-[11px] text-destructive underline decoration-dotted hover:decoration-solid"
          title="A alteração não chegou ao Senior. Clique para ver o erro completo"
        >
          falha ao alterar
        </button>
        <button onClick={onReenviar} className="text-[11px] text-primary hover:underline">
          Reenviar
        </button>
      </span>
    );
  }

  if (item.confirmadoNoSenior) {
    return (
      <span
        className="font-mono text-[11px] text-success"
        title={`Registrado no Senior — RAT ${item.numrat}, sequência ${item.seqrat}. Não é mais possível editar nem excluir.`}
      >
        RAT {item.numrat}/{item.seqrat}
      </span>
    );
  }

  const emVoo = reenviando || item.envioStatus === "enviando" || (item.envioStatus === "pendente" && !item.envioErro);
  if (emVoo) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
        <Spinner className="h-3 w-3" />
        integrando...
      </span>
    );
  }

  // "pendente" com erro = falhou e vai tentar de novo sozinho no cron; "bloqueado" =
  // esgotou as tentativas. Nos dois casos o consultor consegue forçar agora.
  if (item.envioErro) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          onClick={onVerErro}
          className="text-[11px] text-destructive underline decoration-dotted hover:decoration-solid"
          title="Clique para ver o erro completo"
        >
          falha no envio
        </button>
        <button onClick={onReenviar} className="text-[11px] text-primary hover:underline">
          Reenviar
        </button>
      </span>
    );
  }

  // Não registrado e sem envio em curso: ou nunca foi enviado, ou foi desvinculado porque
  // apagaram o apontamento no Senior (ver desvincularItensAusentesNoSenior no backend).
  // Nos dois casos o envio é manual — nada é reintegrado sem o consultor pedir, porque a
  // exclusão do outro lado pode ter sido intencional.
  const podeEnviar = item.envioStatus == null || item.envioStatus === "enviado";
  return (
    <span className="inline-flex items-center gap-2">
      {podeEnviar && (
        <button
          onClick={onReenviar}
          className="text-[11px] text-primary hover:underline"
          title="Registrar este apontamento no Senior"
        >
          Enviar
        </button>
      )}
      {/* Sem "Pedir ajuste" aqui de propósito: o ajuste só existe ANTES de confirmar (ver
          confirmarSessao no backend). Depois de confirmado o apontamento já está na RAT e,
          em segundos, no Senior. */}
      {item.editavel && item.sessaoId != null && (
        <button onClick={onExcluir} className="text-[11px] text-destructive hover:underline">
          Excluir
        </button>
      )}
      {!podeEnviar && !item.editavel && <span className="text-[11px] text-muted">—</span>}
    </span>
  );
}

// Tabela "Atividades" da RAT expandida, com filtro e ordem por coluna, colunas configuráveis, resumo no rodapé e colunas calculadas (TabelaLocal,
// mesmo kit das despesas da RAT). `COLUNAS_ATIVIDADES` e `LOCAIS_ATIVIDADES` (atividadesRat.ts) são constantes do módulo: o kit exige estabilidade,
// então o que depende da RAT aberta (e das ações) entra pelo `ctx`.
interface AcoesAtividades {
  rat: RatRow;
  reenviando: Set<number>;
  abrirAtividade: (atividadeId: number) => void;
  abrirManutencao: (item: RatItemRow, rat: RatRow) => void;
  editarObservacao: (item: RatItemRow, ratId: number) => void;
  reenviar: (ratItemId: number, ratId: number) => void;
  excluir: (sessaoId: number, ratId: number) => void;
  verErro: (item: RatItemRow) => void;
}

const COLUNAS_ATIVIDADES: DefColuna<RatItemRow, AcoesAtividades>[] = [
  {
    nome: "atividadeId",
    titulo: "Atividade",
    fixa: true,
    direita: true,
    largura: 90,
    classe: "font-mono text-[12.5px] tabular-nums",
    resumos: ["contagem", "distintos"],
    render: (item, a) =>
      item.atividadeId != null ? (
        <button onClick={() => a.abrirAtividade(item.atividadeId!)} className="text-primary hover:underline" title="Abrir a atividade (somente visualização)">
          {item.atividadeId}
        </button>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  {
    nome: "sessaoId",
    titulo: "Sessão",
    direita: true,
    largura: 100,
    classe: "font-mono text-[12.5px] tabular-nums",
    resumos: ["contagem", "distintos"],
    render: (item, a) =>
      item.sessaoId != null ? (
        <button
          onClick={() => a.abrirManutencao(item, a.rat)}
          className="text-primary hover:underline"
          title={item.podeManterSessao ? "Manter os dados da sessão" : "Ver os dados da sessão (somente leitura)"}
        >
          {item.sessaoId}
        </button>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  { nome: "codser", titulo: "Serviço", largura: 90, classe: "font-mono text-[12.5px] text-muted", render: (item) => item.codser ?? "—" },
  {
    nome: "item",
    titulo: "Item",
    largura: 260,
    classe: "text-[12.5px] text-muted",
    texto: (item) => rotuloItem(item),
    render: (item) => <span className="block truncate">{rotuloItem(item)}</span>,
  },
  {
    nome: "datati",
    titulo: "Data",
    largura: 95,
    classe: "whitespace-nowrap font-mono text-[12.5px] tabular-nums text-muted",
    render: (item) => (item.datati ? dateFormatter.format(new Date(item.datati)) : "—"),
  },
  {
    nome: "horario",
    titulo: "Horário",
    largura: 120,
    classe: "whitespace-nowrap font-mono text-[12.5px] tabular-nums text-muted",
    render: (item) =>
      item.horini != null && item.horfim != null ? `${formatHoraDoDia(item.horini)}–${formatHoraDoDia(item.horfim)}` : "—",
  },
  {
    nome: "duracaoMinutos",
    titulo: "Duração",
    direita: true,
    largura: 90,
    classe: "whitespace-nowrap font-mono text-[12.5px] tabular-nums text-foreground",
    formatarValor: (v) => (typeof v === "number" ? formatMinutos(v) : String(v ?? "")),
    formatarResumo: formatMinutos,
    render: (item) => (item.duracaoMinutos != null ? formatMinutos(item.duracaoMinutos) : "—"),
  },
  {
    // Observação é o que trava a aprovação da RAT (todo item precisa ter) e vai no desAti do Senior — por isso ela mesma é o clique, em vez
    // de mais uma ação na coluna da direita. Editável abre pra editar; já registrado no ERP abre a MESMA janela em leitura, que é onde se lê o
    // texto completo sem depender do tooltip.
    nome: "desati",
    titulo: "Observação",
    largura: 320,
    texto: (item) => item.desati,
    render: (item, a) => (
      <button
        onClick={() => a.editarObservacao(item, a.rat.id)}
        title={item.desati?.trim() || "Sem observação"}
        className={`block w-full truncate text-left text-[12.5px] hover:underline ${item.desati?.trim() ? "text-foreground" : "font-medium text-warning"}`}
      >
        {item.desati?.trim() || (podeEditarObservacao(item) ? "Sem observação — clique para preencher" : "Sem observação")}
      </button>
    ),
  },
  {
    nome: "integracao",
    titulo: "Integração",
    direita: true,
    largura: 190,
    render: (item, a) => (
      <AcaoIntegracao
        item={item}
        reenviando={a.reenviando.has(item.id)}
        onReenviar={() => a.reenviar(item.id, a.rat.id)}
        onExcluir={() => a.excluir(item.sessaoId!, a.rat.id)}
        onVerErro={() => a.verErro(item)}
      />
    ),
  },
];

const selectClass =
  "rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Tela do consultor: revisa as sessões que o sistema já rastreou automaticamente (ao
// mover o card pra uma coluna "em execução", ver PATCH /atividades/:id/mover) e
// confirma — só nesse momento vira um apontamento de verdade (RatItem) e entra na fila
// pro Senior. O botão "+ Apontamento manual" cobre o caso de não ter passado pelo Kanban
// (trabalho fora do CaxHub, ou esqueceu de mover o card) e é restrito a gestor de
// departamento e admin — inclusive no servidor, ver podeLancarManual em
// backend/src/routes/apontamentos.ts. Gestor pode lançar por qualquer consultor do time.
//
// Apontamentos confirmados aparecem agrupados por RAT (Rat/RatItem, ver backend/src/
// routes/rats.ts) — uma RAT por consultor+proposta, aberta enquanto "Digitada",
// recebendo apontamentos de qualquer dia até o gestor do departamento (ou admin) a
// aprovar. Consultor comum só vê as próprias RATs; gestor/admin ganham um seletor pra
// ver as de quem eles gerenciam.
// Acompanhamento do envio ao ERP depois de confirmar: ~20s no total. O envio costuma
// levar poucos segundos; passando disso, o cron de 15 min assume e a tela avisa que
// segue em andamento em vez de mentir um desfecho.
const ENVIO_INTERVALO_MS = 1500;
const ENVIO_MAX_TENTATIVAS = 13;

// Aviso ao excluir um apontamento com pedido de ajuste de horário aguardando o gestor: o pedido é excluído junto (04/11/2026).
const AVISO_EXCLUIR_COM_AJUSTE =
  "Este apontamento tem uma solicitação de ajuste de horário aguardando o gestor.\n\n" +
  "Ao excluir o apontamento, a solicitação também será excluída. Continuar?";

// Lista de RATs de destino como cartões de opção (radio), usada na confirmação individual e
// no resumo do lote. Não é <select> de propósito: a lista nativa do navegador abre com a
// largura do texto mais longo e vaza pra fora do modal, e a descrição dos itens (que é o que
// distingue as RATs, ex.: a filial) é longa.
function OpcoesRatDestino({
  nome,
  opcoes,
  valor,
  desabilitado = false,
  onChange,
  className = "",
}: {
  nome: string;
  opcoes: RatDestinoOpcao[];
  valor: string;
  desabilitado?: boolean;
  onChange: (valor: string) => void;
  className?: string;
}) {
  const itens: { valor: string; rat: RatDestinoOpcao | null }[] = [
    ...opcoes.map((r) => ({ valor: String(r.id), rat: r })),
    { valor: DESTINO_NOVA, rat: null },
  ];
  return (
    <div role="radiogroup" className={`space-y-2 ${className}`}>
      {itens.map(({ valor: v, rat }) => {
        const marcado = valor === v;
        return (
          <label
            key={v}
            className={`flex gap-3 rounded-md border p-3 text-sm transition-colors ${
              desabilitado ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            } ${marcado ? "border-primary bg-primary/10" : desabilitado ? "border-border" : "border-border hover:bg-surface-2"}`}
          >
            <input
              type="radio"
              name={nome}
              value={v}
              checked={marcado}
              disabled={desabilitado}
              onChange={() => onChange(v)}
              className="mt-0.5 accent-primary"
            />
            {rat ? (
              <span className="min-w-0 flex-1 space-y-1">
                <span className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{rotuloRatDestino(rat)}</span>
                  <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted">
                    {rat.qtdItens} {rat.qtdItens === 1 ? "item" : "itens"} · {formatMinutos(rat.minutos)}
                  </span>
                </span>
                {rat.recentes.map((i, idx) => (
                  <span key={idx} className="block truncate text-[12px] text-muted" title={i.desati ?? undefined}>
                    {i.datati ? `${dateFormatter.format(new Date(i.datati))} · ` : ""}
                    {i.desati || "(sem descrição)"}
                  </span>
                ))}
              </span>
            ) : (
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-foreground">Gerar RAT nova</span>
                <span className="block text-[12px] text-muted">Abre um documento novo no Senior.</span>
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}

export function MeusApontamentos() {
  const navigate = useNavigate();
  const toast = useToast();
  const [sessoes, setSessoes] = useState<SessaoPendente[]>([]);
  // Admin vê as sessões pendentes de todos os consultores; gestor vê as próprias + as do
  // time que gerencia (ver GET /sessoes-pendentes) — é o que liga a coluna Consultor e a
  // barra de filtros abaixo.
  const [mostrarConsultor, setMostrarConsultor] = useState(false);
  // Escolha da RAT de destino na confirmação (25/09/2026). O servidor só manda opções pros
  // grupos consultor+proposta com 2 ou mais RATs Digitadas, e só quando o contrato do Senior
  // já aceita RAT de destino — sem opções, Confirmar segue direto como sempre.
  const [ratsDestino, setRatsDestino] = useState<Record<string, RatDestinoOpcao[]>>({});
  const [escolhaRat, setEscolhaRat] = useState<{ sessaoId: number; titulo: string; opcoes: RatDestinoOpcao[]; valor: string } | null>(
    null
  );
  const [buscaSessoesInput, setBuscaSessoesInput] = useState("");
  const buscaSessoesDebounced = useDebouncedValue(buscaSessoesInput, 350);
  const [codforsFiltroSessoes, setCodforsFiltroSessoes] = useState<number[]>([]);
  // Filtro de período (AtividadeSessaoExecucao.inicio) — sem debounce, é <input type="date">,
  // seleção discreta, não busca-enquanto-digita.
  const [dataInicioFiltro, setDataInicioFiltro] = useState("");
  const [dataFimFiltro, setDataFimFiltro] = useState("");
  const [atividades, setAtividades] = useState<AtividadeResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const [excluindoSessao, setExcluindoSessao] = useState<number | null>(null);
  // Acordeon de "Sessões pendentes" por consultor (só aparece quando mostrarConsultor) —
  // chave é o codfor, igual ao agrupamento de abrirResumoLote logo abaixo.
  const [consultoresExpandidos, setConsultoresExpandidos] = useState<Set<number>>(new Set());

  // Pedido de correção de horário. Enquanto pendente, o envio do apontamento ao Senior fica
  // retido no servidor — é o que permite corrigir sem alterar nada do lado do ERP.
  // `pendente` preenchido = já existe pedido aguardando o gestor; o formulário abre em
  // leitura. Deixar editar seria oferecer uma ação que o servidor recusa: o índice único
  // parcial só admite um pendente por apontamento.
  const [pedidoAjuste, setPedidoAjuste] = useState<{
    sessaoId: number;
    titulo: string;
    pendente: AjustePendente | null;
  } | null>(null);
  const [ajusteData, setAjusteData] = useState("");
  // Só o dia corrente, salvo exceção do líder (ver domain/janelaRetroativa.ts no backend).
  const janela = useJanelaRetroativa();
  const [ajusteInicio, setAjusteInicio] = useState("");
  const [ajusteFim, setAjusteFim] = useState("");
  const [ajusteMotivo, setAjusteMotivo] = useState("");
  const [enviandoAjuste, setEnviandoAjuste] = useState(false);
  const [erroAjuste, setErroAjuste] = useState<string | null>(null);
  const [descricoes, setDescricoes] = useState<Record<number, string>>({});
  const [editandoDescricaoId, setEditandoDescricaoId] = useState<number | null>(null);

  // Lista de RATs (ListaServidor, 04/11/2026): a tela só guarda o que muda a consulta (recarga e os filtros de coluna, que o "Fechar Todos"
  // também respeita) e os ajustes de linha feitos sem recarregar (número da RAT confirmado pelo Senior, situação depois de fechar).
  const [recargaRats, setRecargaRats] = useState(0);
  const [consultaColunasRats, setConsultaColunasRats] = useState<{ filtros?: string; calculadas?: string }>({});
  const [ajustesRat, setAjustesRat] = useState<Record<number, Partial<RatRow>>>({});
  const [opcoesFiltro, setOpcoesFiltro] = useState<ConsultorFiltro[]>([]);
  const [codforsFiltro, setCodforsFiltro] = useState<number[]>([]);
  const [situacoesRat, setSituacoesRat] = useState<SituacaoRatOpcao[]>([]);
  const [sitratFiltro, setSitratFiltro] = useState<number[]>([]);
  const [integracaoFiltro, setIntegracaoFiltro] = useState<IntegracaoErpStatus[]>([]);
  const [opcoesRatsProntas, setOpcoesRatsProntas] = useState(false);
  const [opcoesRatsFalharam, setOpcoesRatsFalharam] = useState(false);
  const [buscaInput, setBuscaInput] = useState("");
  const buscaDebounced = useDebouncedValue(buscaInput, 350);
  const [buscaItemInput, setBuscaItemInput] = useState("");
  const buscaItemDebounced = useDebouncedValue(buscaItemInput, 350);
  const [ratsExpandidas, setRatsExpandidas] = useState<Set<number>>(new Set());
  const [itensPorRat, setItensPorRat] = useState<Record<number, RatItemRow[] | "carregando" | "erro">>({});
  const [sincronizando, setSincronizando] = useState<number | null>(null);
  // Fechamento de RAT (13/09/2026) — mesma ideologia de Confirmar/Confirmar Todos: individual
  // por linha (fechando) e em lote com resumo antes de disparar (resumoFechamentoLote).
  const [fechando, setFechando] = useState<number | null>(null);
  const [resumoFechamentoLote, setResumoFechamentoLote] = useState<RatElegivelFechamento[] | null>(null);
  const [carregandoResumoFechamentoLote, setCarregandoResumoFechamentoLote] = useState(false);
  const [fechandoLote, setFechandoLote] = useState(false);
  const [resultadoFechamentoLote, setResultadoFechamentoLote] = useState<{
    // Só "solicitados" (enfileirados no outbox), não "fechados" de verdade — o fechamento em
    // si só acontece depois, quando o Senior confirmar (ver acompanharFechamento). Nome
    // escolhido pra não sugerir uma conclusão que ainda não aconteceu.
    solicitados: number;
    falhas: { ratId: number; erro: string }[];
  } | null>(null);
  // Contador pro botão "Fechar Todos" (pedido do Vitor, 13/09/2026) — quantidade de RATs
  // elegíveis SEM depender da página/filtro atual da tabela (mesma fonte do modal de resumo:
  // GET /rats/elegiveis-fechamento). `null` = ainda não carregado.
  const [totalElegiveisFechamento, setTotalElegiveisFechamento] = useState<number | null>(null);
  // Aba ativa do acordeão por RAT — "atividades" quando ausente. `rdvJaAberto` mantém o
  // DespesasRatPainel montado (só oculto via CSS, não desmontado) depois da 1ª visita à aba
  // RDVs daquela RAT, pra não refazer o GET /despesas a cada troca de aba — mesmo espírito de
  // `itensPorRat` já cachear por RAT em vez de buscar de novo a cada expand/collapse.
  const [abaExpandidaPorRat, setAbaExpandidaPorRat] = useState<Record<number, "atividades" | "rdvs">>({});
  const [rdvJaAberto, setRdvJaAberto] = useState<Set<number>>(new Set());

  const [modalManual, setModalManual] = useState(false);
  // Por quem o apontamento pode ser lançado: o próprio usuário e, se for gestor, o time
  // dos departamentos que ele gerencia. Separado de `opcoesFiltro` (filtro das RATs), que
  // vem das RATs existentes e não serve aqui — consultor sem RAT não apareceria.
  const [consultoresManual, setConsultoresManual] = useState<ConsultorFiltro[]>([]);
  // Quem decide é o servidor (é ele que também recusa o POST) — a tela só obedece.
  const [podeLancarManual, setPodeLancarManual] = useState(false);
  const [manualCodfor, setManualCodfor] = useState("");
  const [carregandoAtividadesManual, setCarregandoAtividadesManual] = useState(false);
  const [manualAtividadeId, setManualAtividadeId] = useState("");
  const [manualData, setManualData] = useState("");
  const [manualInicio, setManualInicio] = useState("");
  const [manualFim, setManualFim] = useState("");
  const [manualDescricao, setManualDescricao] = useState("");
  const [salvandoManual, setSalvandoManual] = useState(false);
  const [erroManual, setErroManual] = useState<string | null>(null);

  function carregar() {
    setLoading(true);
    // As atividades do consultor (`minhas-atividades`) NÃO carregam aqui: só alimentam o seletor do modal de
    // apontamento manual, que existe só para gestor/admin. Carregam ao abrir o modal (abrirModalManual) —
    // antes todo consultor pagava a chamada (até 75 KB) em toda abertura e recarga da tela sem usá-la.
    axios
      .get("/api/apontamentos/sessoes-pendentes")
      .then((sessoesRes) => {
        setSessoes(sessoesRes.data.sessoes);
        setMostrarConsultor(Boolean(sessoesRes.data.mostrarConsultor));
        setRatsDestino(sessoesRes.data.ratsDestino ?? {});
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar apontamentos"))
      .finally(() => setLoading(false));
  }

  // Atividades de quem vai receber o apontamento. Sem codfor, o backend usa o próprio
  // usuário — é o caminho do consultor comum, idêntico ao de antes.
  function carregarAtividadesManual(codfor: string) {
    setCarregandoAtividadesManual(true);
    axios
      .get("/api/apontamentos/minhas-atividades", { params: { codfor: codfor || undefined } })
      .then(({ data }) => setAtividades(data.atividades))
      .catch((err) => setErroManual(err.response?.data?.error ?? "Falha ao carregar as atividades do consultor"))
      .finally(() => setCarregandoAtividadesManual(false));
  }

  function abrirModalManual() {
    setModalManual(true);
    // Lista fresca a cada abertura (a alocação de atividades muda ao longo do dia); o consultor escolhido
    // antes continua valendo se o modal foi fechado sem limpar o formulário.
    carregarAtividadesManual(manualCodfor);
  }

  function onMudarConsultorManual(codfor: string) {
    setManualCodfor(codfor);
    // Limpa a atividade: a que estava escolhida é de outro consultor e o POST recusaria.
    setManualAtividadeId("");
    setErroManual(null);
    carregarAtividadesManual(codfor);
  }

  // Filtros da tabela de RATs, no formato de query param — usado tanto por GET /rats quanto
  // por GET /rats/elegiveis-fechamento (14/09/2026: "Fechar Todos" passou a respeitar os MESMOS
  // filtros aplicados na tela, não só a regra fixa de elegibilidade — sem isso, filtrar por um
  // consultor mostrava 2 RATs na tabela mas o botão continuava contando/fechando todo mundo).
  // Sem `page`/`pageSize`: elegiveis-fechamento nunca pagina, de propósito (ver comentário lá).
  function filtrosRatsParaQuery() {
    return {
      codfor: codforsFiltro.length > 0 ? codforsFiltro.join(",") : undefined,
      sitrat: sitratFiltro.length > 0 ? sitratFiltro.join(",") : undefined,
      busca: buscaDebounced || undefined,
      buscaItem: buscaItemDebounced || undefined,
      integracao: integracaoFiltro.length > 0 ? integracaoFiltro.join(",") : undefined,
    };
  }

  // Recarrega a lista de RATs (ListaServidor) e, junto, o contador do "Fechar Todos" (efeito mais abaixo).
  function carregarRats() {
    setRecargaRats((n) => n + 1);
  }

  useEffect(() => {
    carregar();
    axios
      .get("/api/rats/opcoes-filtro")
      .then(({ data }) => {
        setOpcoesFiltro(data.consultores);
        setSituacoesRat(data.situacoesRat ?? []);
        setOpcoesRatsProntas(true);
      })
      .catch(() => setOpcoesRatsFalharam(true));
    axios
      .get("/api/apontamentos/consultores")
      .then(({ data }) => {
        setConsultoresManual(data.consultores);
        setPodeLancarManual(Boolean(data.podeLancarManual));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Padrão de cada filtro da aba de RATs (estrela, 03/11/2026): aplicado uma vez ao abrir, antes da 1ª consulta das RATs.
  const padroesRats = usePadroesTela({
    tela: "projetos.apontamentos.rats",
    opcoesProntas: opcoesRatsProntas,
    opcoesFalharam: opcoesRatsFalharam,
    campos: {
      sitrat: { rotulo: "Situação", atual: sitratFiltro, aplicar: setSitratFiltro, validar: regras.lista("number", situacoesRat.map((o) => o.sitrat)) },
      integracao: {
        rotulo: "Sincronização",
        atual: integracaoFiltro,
        aplicar: setIntegracaoFiltro,
        validar: regras.lista("string", OPCOES_INTEGRACAO.map((o) => o.value)),
        semOpcoes: true,
      },
      codfor: { rotulo: "Consultor", atual: codforsFiltro, aplicar: setCodforsFiltro, validar: regras.lista("number", opcoesFiltro.map((o) => o.codfor)) },
    },
  });

  // Contador do botão "Fechar Todos": endpoint LEVE (só o número, 14/09/2026, achado real de lentidão) com os MESMOS filtros da tabela,
  // do topo e de coluna (04/11/2026). Recalcula a cada troca de filtro e depois de qualquer ação que recarrega a lista. Silencioso em erro:
  // é só um contador auxiliar. O resumo completo (cliente/consultor/minutos) só é buscado quando o modal abre (abrirResumoFechamentoLote).
  useEffect(() => {
    if (!padroesRats.pronto) return;
    let cancelado = false;
    axios
      .get("/api/rats/elegiveis-fechamento/contagem", { params: { ...filtrosRatsParaQuery(), ...consultaColunasRats } })
      .then(({ data }) => !cancelado && setTotalElegiveisFechamento(data.total ?? 0))
      .catch(() => {});
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [padroesRats.pronto, codforsFiltro, sitratFiltro, integracaoFiltro, buscaDebounced, buscaItemDebounced, consultaColunasRats, recargaRats]);

  function onMudarFiltroConsultor(codfors: number[]) {
    // A ListaServidor volta sozinha para a página 1 quando um filtro do topo muda.
    setCodforsFiltro(codfors);
  }

  function onMudarFiltroSitrat(valores: number[]) {
    setSitratFiltro(valores);
  }

  function onMudarFiltroIntegracao(valores: IntegracaoErpStatus[]) {
    setIntegracaoFiltro(valores);
  }

  // Apontamentos com reenvio disparado agora — mantém o spinner na linha entre o clique e
  // a primeira resposta do acompanhamento.
  const [reenviando, setReenviando] = useState<Set<number>>(new Set());
  // Resultado informativo do "Sinc. ERP" (ex.: itens desvinculados), por RAT. Separado de
  // `erro` porque não é falha — é o sync tendo encontrado divergência e resolvido. Vira
  // tooltip no badge de integração da RAT (não banner no topo da tela) pra não competir com
  // outras RATs sincronizadas na sequência.
  const [avisoSincPorRat, setAvisoSincPorRat] = useState<Record<number, string>>({});
  // Atividade aberta no painel de detalhe (o mesmo do card do quadro), em modo leitura.
  const [detalheAtividade, setDetalheAtividade] = useState<AtividadeDetalheDados | null>(null);
  // Item da RAT com a observação em edição. Guarda o ratId junto porque depois de salvar é
  // preciso recarregar os itens daquela RAT.
  const [editandoObservacao, setEditandoObservacao] = useState<{
    item: RatItemRow;
    ratId: number;
    somenteLeitura: boolean;
  } | null>(null);
  // Sessão aberta na manutenção (admin edita, os demais leem). Guarda a RAT junto: o contexto do cabeçalho e o recarregamento vêm dela.
  const [mantendoSessao, setMantendoSessao] = useState<{ item: RatItemRow; rat: RatRow } | null>(null);
  const [salvandoSessao, setSalvandoSessao] = useState(false);
  const [erroSessao, setErroSessao] = useState<string | null>(null);
  // Item com "falha no envio" cujo erro completo está sendo visualizado — mesmo modal (só
  // leitura) usado pra ler a observação inteira de um item já confirmado.
  const [erroEnvioItem, setErroEnvioItem] = useState<RatItemRow | null>(null);

  // Timers do acompanhamento, cancelados ao sair da tela pra não bater em endpoint depois
  // que o componente já saiu.
  const timersEnvioRef = useRef<number[]>([]);
  useEffect(() => {
    const timers = timersEnvioRef;
    return () => timers.current.forEach((t) => window.clearTimeout(t));
  }, []);

  // Escreve o estado do envio direto no item já carregado, em vez de recarregar a RAT
  // inteira: é o que faz a célula de ação mudar sozinha (spinner -> RAT n/seq, ou -> erro)
  // sem piscar a tabela.
  function atualizarEnvioDoItem(
    ratId: number,
    ratItemId: number,
    dados: { status: string; numrat: number | null; seqrat: number | null; erro: string | null }
  ) {
    setItensPorRat((atual) => {
      const itens = atual[ratId];
      if (!Array.isArray(itens)) return atual;
      return {
        ...atual,
        [ratId]: itens.map((i) =>
          i.id !== ratItemId
            ? i
            : {
                ...i,
                envioStatus: dados.status,
                envioErro: dados.erro,
                numrat: dados.numrat,
                seqrat: dados.seqrat,
                confirmadoNoSenior: dados.status === "registrado",
                // Registrado no Senior deixa de ser editável na hora — o backend recusa
                // tanto editar quanto excluir a partir daí.
                editavel: dados.status === "registrado" ? false : i.editavel,
              }
        ),
      };
    });

    // A coluna "RAT" da linha-cabeçalho (tabela de fora) mostra `rat.numrat`, que fica
    // parado no que veio do último `carregarRats()` — sem isto, o número só aparece depois
    // de um F5. Atualiza sempre que o Senior confirmar um número, mesmo que a RAT já
    // tivesse um antes e o novo venha diferente (ex.: a RAT foi desvinculada — ver
    // desvincularRatAusenteNoSenior no backend — e o reenvio criou uma RAT NOVA lá).
    if (dados.status === "registrado" && dados.numrat != null) {
      setAjustesRat((a) => ({ ...a, [ratId]: { ...a[ratId], numrat: dados.numrat } }));
    }
  }

  // O apontamento é enviado ao Senior em segundo plano, então a releitura que acontece
  // logo após confirmar sempre pega o item ainda na fila. Isto aqui é o que fecha o ciclo:
  // pergunta de tempos em tempos como foi e reflete na linha, até haver desfecho.
  function acompanharEnvio(ratItemId: number, ratId: number, tentativa = 0) {
    const timer = window.setTimeout(async () => {
      let concluido = false;
      try {
        const { data } = await axios.get(`/api/apontamentos/envio/${ratItemId}`);
        atualizarEnvioDoItem(ratId, ratItemId, data);
        // Registrado é definitivo; bloqueado e "falhou mas vai retentar" já têm erro pra
        // mostrar, então em ambos vale parar de perguntar e deixar o Reenviar na mão do
        // consultor.
        concluido = data.status === "registrado" || data.status === "bloqueado" || Boolean(data.erro);
      } catch {
        // Falha de rede no acompanhamento é transitória — tenta de novo no próximo tick.
      }

      if (concluido) return;
      if (tentativa + 1 < ENVIO_MAX_TENTATIVAS) {
        acompanharEnvio(ratItemId, ratId, tentativa + 1);
      }
      // Estourou o tempo sem desfecho: a linha fica no spinner e o cron de 15 min assume.
      // Recarregar a RAT depois mostra o resultado.
    }, ENVIO_INTERVALO_MS);
    timersEnvioRef.current.push(timer);
  }

  async function reenviarAoSenior(ratItemId: number, ratId: number) {
    setReenviando((atual) => new Set(atual).add(ratItemId));
    try {
      await axios.post(`/api/apontamentos/envio/${ratItemId}/reenviar`);
      acompanharEnvio(ratItemId, ratId);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao reenviar o apontamento ao ERP");
    } finally {
      setReenviando((atual) => {
        const proximo = new Set(atual);
        proximo.delete(ratItemId);
        return proximo;
      });
    }
  }

  // Clique em Confirmar: se o consultor tem 2+ RATs Digitadas nessa proposta, pergunta
  // antes em qual delas a sessão entra (ou se gera uma nova); senão confirma direto.
  function confirmar(sessaoId: number) {
    const sessao = sessoes.find((s) => s.id === sessaoId);
    const opcoes = sessao ? ratsDestino[chaveGrupoRat(sessao)] : undefined;
    if (sessao && opcoes && opcoes.length > 0) {
      setEscolhaRat({
        sessaoId,
        titulo: `Proposta ${sessao.codpro} · ${dataCurtaFormatter.format(new Date(sessao.inicio))} ${formatHorario(sessao.inicio, sessao.fim)}`,
        opcoes,
        // Primeira = a que a regra automática escolheria (ordem do servidor).
        valor: String(opcoes[0].id),
      });
      return;
    }
    void enviarConfirmacao(sessaoId);
  }

  async function enviarConfirmacao(sessaoId: number, ratDestino?: { ratId: number } | { nova: true }) {
    setConfirmando(sessaoId);
    // Cai pra observacao (pré-preenchida ao sair de "Em Andamento", ver Atividades.tsx)
    // quando o usuário não editou o campo — senão o texto pré-preenchido só aparecia na
    // tela e nunca era enviado de fato.
    const sessao = sessoes.find((s) => s.id === sessaoId);
    const descricao = descricoes[sessaoId] ?? sessao?.observacao ?? "";
    try {
      const { data } = await axios.post("/api/apontamentos/confirmar", {
        sessaoId,
        descricao: descricao || undefined,
        ...(ratDestino ? { ratDestino } : {}),
      });
      carregar();
      carregarRats();
      if (data?.ratId != null) expandirEAtualizarRat(data.ratId);
      // O envio ao ERP roda em segundo plano; a linha do apontamento mostra o andamento.
      if (data?.ratItemId != null && data?.ratId != null) acompanharEnvio(data.ratItemId, data.ratId);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao confirmar apontamento");
    } finally {
      setConfirmando(null);
    }
  }

  // "Confirmar Todos" — resumo ANTES de disparar, agrupado pela MESMA chave que
  // buscarOuCriarRatRascunho usa no servidor (codemp+codfor+codpro) pra encapsular o
  // apontamento na RAT. É o que deixa visível, antes do clique, que a confirmação em lote
  // não vai misturar proposta nenhuma — cada grupo aqui vira exatamente uma RAT (nova ou
  // já existente) lá no servidor.
  interface GrupoResumoLote {
    chave: string;
    codpro: number;
    consultorNome: string | null;
    sessaoIds: number[];
    minutos: number;
    // RAT de destino do grupo inteiro — null quando o grupo não tem escolha (regra automática).
    destino: string | null;
  }
  const [resumoLote, setResumoLote] = useState<GrupoResumoLote[] | null>(null);
  const [confirmandoLote, setConfirmandoLote] = useState(false);
  const [resultadoLote, setResultadoLote] = useState<{ confirmados: number; falhas: { sessaoId: number; erro: string }[] } | null>(
    null
  );

  function abrirResumoLote() {
    const porGrupo = new Map<string, GrupoResumoLote>();
    for (const s of sessoesFiltradas) {
      const chave = `${s.codemp}-${s.codfor}-${s.codpro}`;
      let grupo = porGrupo.get(chave);
      if (!grupo) {
        const opcoes = ratsDestino[chave];
        grupo = {
          chave,
          codpro: s.codpro,
          consultorNome: s.consultorNome,
          sessaoIds: [],
          minutos: 0,
          destino: opcoes && opcoes.length > 0 ? String(opcoes[0].id) : null,
        };
        porGrupo.set(chave, grupo);
      }
      grupo.sessaoIds.push(s.id);
      grupo.minutos += s.duracaoMinutos;
    }
    setResultadoLote(null);
    setResumoLote([...porGrupo.values()].sort((a, b) => b.codpro - a.codpro));
  }

  async function confirmarTodos() {
    if (!resumoLote) return;
    setConfirmandoLote(true);
    const itens = resumoLote.flatMap((g) => {
      const ratDestino = ratDestinoDoValor(g.destino);
      return g.sessaoIds.map((sessaoId) => {
        const sessao = sessoes.find((s) => s.id === sessaoId);
        const descricao = descricoes[sessaoId] ?? sessao?.observacao ?? "";
        return {
          sessaoId,
          descricao: descricao || undefined,
          // "grupo" faz o servidor mandar todas as sessões do grupo pra MESMA RAT nova.
          ...(ratDestino ? { ratDestino: "nova" in ratDestino ? { nova: true, grupo: g.chave } : ratDestino } : {}),
        };
      });
    });
    try {
      const { data } = await axios.post("/api/apontamentos/confirmar-lote", { itens });
      setResultadoLote({ confirmados: data.confirmados?.length ?? 0, falhas: data.falhas ?? [] });
      carregar();
      carregarRats();
      // Falha parcial fica visível no próprio diálogo (ver render abaixo) — só fecha
      // sozinho quando tudo deu certo, senão o consultor perderia de vista o que travou.
      if (!data.falhas || data.falhas.length === 0) setResumoLote(null);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao confirmar em lote");
      setResumoLote(null);
    } finally {
      setConfirmandoLote(false);
    }
  }

  function limparFormularioManual() {
    // Volta pro próprio usuário e recarrega as atividades dele: sem isso, o gestor que
    // lançou por alguém do time reabriria o modal com a lista do outro consultor.
    if (manualCodfor) {
      setManualCodfor("");
      carregarAtividadesManual("");
    }
    setManualAtividadeId("");
    setManualData("");
    setManualInicio("");
    setManualFim("");
    setManualDescricao("");
    setErroManual(null);
  }

  async function salvarManual() {
    if (!manualAtividadeId || !manualData || !manualInicio || !manualFim) {
      setErroManual("Preencha atividade, data e os dois horários");
      return;
    }
    setSalvandoManual(true);
    setErroManual(null);
    try {
      const { data } = await axios.post("/api/apontamentos/manual", {
        atividadeId: Number(manualAtividadeId),
        inicio: `${manualData}T${manualInicio}:00`,
        fim: `${manualData}T${manualFim}:00`,
        descricao: manualDescricao || undefined,
      });
      setModalManual(false);
      limparFormularioManual();
      carregar();
      carregarRats();
      if (data?.ratId != null) expandirEAtualizarRat(data.ratId);
      // Mesmo caminho da confirmação de sessão (a rota /manual reusa confirmarSessao),
      // então o envio ao ERP também roda em segundo plano e precisa ser acompanhado.
      if (data?.ratItemId != null && data?.ratId != null) acompanharEnvio(data.ratItemId, data.ratId);
    } catch (err: any) {
      setErroManual(err.response?.data?.error ?? "Falha ao lançar apontamento");
    } finally {
      setSalvandoManual(false);
    }
  }

  function toggleExpandirRat(rat: RatRow) {
    setRatsExpandidas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(rat.id)) {
        proximo.delete(rat.id);
      } else {
        proximo.add(rat.id);
        if (!itensPorRat[rat.id]) {
          setItensPorRat((i) => ({ ...i, [rat.id]: "carregando" }));
          axios
            .get(`/api/rats/${rat.id}/itens`)
            .then(({ data }) => setItensPorRat((i) => ({ ...i, [rat.id]: data.itens })))
            .catch(() => setItensPorRat((i) => ({ ...i, [rat.id]: "erro" })));
        }
      }
      return proximo;
    });
  }

  // Conteúdo da linha aberta de uma RAT (ListaServidor `detalhe`): abas Atividades (itens, carregados ao abrir) e RDVs.
  function renderDetalheRat(rat: RatRow) {
    const itens = itensPorRat[rat.id];
    const abaRat = abaExpandidaPorRat[rat.id] ?? "atividades";
    return (
      <>
          <Tabs
            tabs={[
              { key: "atividades", label: "Atividades" },
              { key: "rdvs", label: "RDVs" },
            ]}
            activeKey={abaRat}
            onChange={(key) => selecionarAbaRat(rat.id, key as "atividades" | "rdvs")}
          />
          <div className={abaRat === "atividades" ? "" : "hidden"}>
          {itens === "carregando" && <p className="py-2 text-sm text-muted">Carregando itens...</p>}
          {itens === "erro" && <p className="py-2 text-sm text-destructive">Falha ao carregar os itens desta RAT.</p>}
          {Array.isArray(itens) && (
            <TabelaLocal<RatItemRow, AcoesAtividades>
              chave="projetos.rat.atividades"
              defs={COLUNAS_ATIVIDADES}
              colunas={LOCAIS_ATIVIDADES}
              linhas={itens}
              ler={lerAtividade}
              chaveLinha={(item) => String(item.id)}
              vazio="Nenhum item nesta RAT."
              ctx={{
                rat,
                reenviando,
                abrirAtividade: abrirDetalheAtividade,
                abrirManutencao: abrirManutencaoSessao,
                editarObservacao: (item, ratId) => setEditandoObservacao({ item, ratId, somenteLeitura: !podeEditarObservacao(item) }),
                reenviar: reenviarAoSenior,
                excluir: excluirApontamento,
                verErro: setErroEnvioItem,
              }}
            />
          )}
          </div>
          {rdvJaAberto.has(rat.id) && (
            <div className={abaRat === "rdvs" ? "" : "hidden"}>
              <DespesasRatPainel ratId={rat.id} />
            </div>
          )}
      </>
    );
  }

  const abertasRats = useMemo(() => new Set([...ratsExpandidas].map(String)), [ratsExpandidas]);

  // Só guarda quando muda de fato (a ListaServidor avisa ao montar, com tudo vazio), para não refazer a contagem do "Fechar Todos" à toa.
  function mudarConsultaColunasRats(consulta: { filtros?: string; calculadas?: string }) {
    setConsultaColunasRats((atual) => (atual.filtros === consulta.filtros && atual.calculadas === consulta.calculadas ? atual : consulta));
  }

  // Troca a aba (Atividades/RDVs) da linha expandida de uma RAT. `rdvJaAberto` só cresce — a
  // 1ª vez que a aba RDVs é aberta pra uma RAT, `DespesasRatPainel` monta e faz seu próprio
  // fetch; nas trocas seguintes ele continua montado (só oculto), sem novo fetch.
  function selecionarAbaRat(ratId: number, aba: "atividades" | "rdvs") {
    setAbaExpandidaPorRat((atual) => ({ ...atual, [ratId]: aba }));
    if (aba === "rdvs") setRdvJaAberto((atual) => new Set(atual).add(ratId));
  }

  // Após confirmar um apontamento, abre a RAT que recebeu o item (se ainda não estava
  // expandida) e força a releitura dos itens — senão o item recém-inserido só aparece
  // depois de recolher/reexpandir manualmente.
  function expandirEAtualizarRat(ratId: number) {
    setRatsExpandidas((atual) => new Set(atual).add(ratId));
    setItensPorRat((i) => ({ ...i, [ratId]: "carregando" }));
    axios
      .get(`/api/rats/${ratId}/itens`)
      .then(({ data }) => setItensPorRat((i) => ({ ...i, [ratId]: data.itens })))
      .catch(() => setItensPorRat((i) => ({ ...i, [ratId]: "erro" })));
  }

  // Abre o MESMO painel de detalhe do card do quadro, só que em leitura. Os dados de
  // cabeçalho vêm de GET /atividades/:id/detalhe, que reaproveita a derivação da listagem
  // de Atividades (item, alocado, realizado, estrutura) — aqui só se tem o atividadeId.
  async function abrirDetalheAtividade(atividadeId: number) {
    try {
      const { data } = await axios.get(`/api/atividades/${atividadeId}/detalhe`);
      setDetalheAtividade(data.atividade);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao abrir a atividade");
    }
  }

  // Descrição de uma sessão AINDA NÃO confirmada (sem RatItem) — o mesmo PATCH usado abaixo
  // para item já confirmado, mas o backend detecta a ausência de RatItem e grava direto em
  // AtividadeSessaoExecucao.observacao. Sem isso, o texto só existia no estado local
  // (`descricoes`) e um F5 antes de clicar Confirmar perdia a edição.
  async function salvarDescricaoSessaoPendente(sessaoId: number, texto: string) {
    try {
      await axios.patch(`/api/apontamentos/${sessaoId}`, { desati: texto });
      setDescricoes((atual) => ({ ...atual, [sessaoId]: texto }));
      setEditandoDescricaoId(null);
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao salvar a descrição");
    }
  }

  // Observação (RatItem.desati) de um item já confirmado. É o campo que a aprovação da RAT
  // exige em todos os itens e que vai no desAti do Senior, então precisa ser preenchível
  // depois do fato — o backend só permite enquanto o item não foi registrado no ERP.
  async function salvarObservacaoItem(sessaoId: number, ratId: number, texto: string) {
    try {
      await axios.patch(`/api/apontamentos/${sessaoId}`, { desati: texto });
      setEditandoObservacao(null);
      const { data } = await axios.get(`/api/rats/${ratId}/itens`);
      setItensPorRat((i) => ({ ...i, [ratId]: data.itens }));
      // A RAT só pode ser aprovada (em /api/rats/:id/aprovar) quando todo item tem
      // observação preenchida — recarregar a lista mantém o totalItens/status em dia.
      carregarRats();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao salvar a observação");
    }
  }

  // Depois de salvar uma manutenção que vai ao Senior, acompanha os itens da RAT até a alteração sair (ou o tempo acabar).
  function acompanharEdicao(ratId: number, tentativa = 0) {
    const timer = window.setTimeout(async () => {
      let concluido = false;
      try {
        const { data } = await axios.get(`/api/rats/${ratId}/itens`);
        setItensPorRat((i) => ({ ...i, [ratId]: data.itens }));
        concluido = !data.itens.some((it: RatItemRow) => it.edicaoStatus === "enviando");
        if (concluido) carregarRats();
      } catch {
        // Falha de rede no acompanhamento é transitória — tenta de novo no próximo tick.
      }
      if (concluido) return;
      if (tentativa + 1 < ENVIO_MAX_TENTATIVAS) acompanharEdicao(ratId, tentativa + 1);
    }, ENVIO_INTERVALO_MS);
    timersEnvioRef.current.push(timer);
  }

  function abrirManutencaoSessao(item: RatItemRow, rat: RatRow) {
    setErroSessao(null);
    setMantendoSessao({ item, rat });
  }

  async function salvarManutencaoSessao(dados: DadosManutencaoSessao) {
    if (!mantendoSessao) return;
    const { item, rat } = mantendoSessao;
    setSalvandoSessao(true);
    setErroSessao(null);
    try {
      // Mesma convenção do pedido de ajuste: data + hora local do navegador viram o instante ISO.
      const { data } = await axios.patch(`/api/apontamentos/${item.sessaoId}/sessao`, {
        inicio: new Date(`${dados.data}T${dados.inicio}`).toISOString(),
        fim: new Date(`${dados.data}T${dados.fim}`).toISOString(),
        descricao: dados.descricao,
      });
      setMantendoSessao(null);
      const { data: itensData } = await axios.get(`/api/rats/${rat.id}/itens`);
      setItensPorRat((i) => ({ ...i, [rat.id]: itensData.itens }));
      // Totais (minutos) e "Sinc. ERP" da RAT mudam com a alteração.
      carregarRats();
      if (data?.equalizacao === "enfileirada") acompanharEdicao(rat.id);
    } catch (err: any) {
      setErroSessao(err.response?.data?.error ?? "Falha ao salvar a sessão");
    } finally {
      setSalvandoSessao(false);
    }
  }

  async function sincronizarErp(rat: RatRow) {
    setSincronizando(rat.id);
    setAvisoSincPorRat((a) => {
      const { [rat.id]: _remove, ...resto } = a;
      return resto;
    });
    try {
      const { data } = await axios.post(`/api/rats/${rat.id}/sincronizar`);
      carregarRats();
      if (itensPorRat[rat.id]) {
        const { data: itensData } = await axios.get(`/api/rats/${rat.id}/itens`);
        setItensPorRat((i) => ({ ...i, [rat.id]: itensData.itens }));
      }
      // Cada situação vira uma linha própria do aviso — as três podem acontecer na mesma
      // chamada agora (busca + reenvio na mesma ação), em ordem de gravidade: RAT inteira
      // desvinculada primeiro, depois itens desvinculados, depois o resultado do reenvio.
      const avisos: string[] = [];
      if (data?.ratDesvinculada) {
        avisos.push(
          "Esta RAT não existe mais no Senior — o vínculo com o número do ERP foi removido. " +
            "Os apontamentos dela podem ser enviados de novo, e vão gerar uma RAT nova por lá."
        );
      }
      if (data?.desvinculados > 0) {
        // Apontamento apagado no Senior perde o vínculo aqui e volta a poder ser enviado —
        // isso precisa ser dito, senão o item muda de estado sem explicação nenhuma.
        const seqrats = (data.seqratsDesvinculados ?? []).join(", ");
        avisos.push(
          `${data.desvinculados} apontamento(s) não existem mais no Senior (sequência ${seqrats}) — ` +
            `o vínculo foi removido e eles podem ser enviados de novo pela ação "Enviar".`
        );
      }
      if (data?.excluidos > 0) {
        // Item de origem ERP (nunca teve sessão local) que a origem excluiu — diferente do
        // aviso acima, não há ação de volta nenhuma ("Enviar" não reaparece), é só informativo.
        const seqrats = (data.seqratsExcluidos ?? []).join(", ");
        avisos.push(
          `${data.excluidos} item(ns) desta RAT não existem mais no Senior (sequência ${seqrats}) — ` +
            `foram marcados como excluídos. Não há nada a fazer: nunca tiveram apontamento local.`
        );
      }
      if (data?.itensReenviados > 0) {
        // `integracao` já vem recalculada pós-tentativa — dá pra dizer se resolveu sem
        // precisar de outra chamada.
        avisos.push(
          data.integracao === "sincronizado"
            ? `${data.itensReenviados} apontamento(s) pendente(s)/com erro foram reenviados e confirmados no Senior.`
            : `${data.itensReenviados} apontamento(s) pendente(s)/com erro foram reenviados, mas ainda há falha — ` +
                `veja o detalhe na lista de itens.`
        );
      }
      if (data?.despesasReenviadas > 0) {
        avisos.push(`${data.despesasReenviadas} despesa(s) pendente(s)/com erro foram reenviadas ao Senior.`);
      }
      if (avisos.length > 0) {
        setAvisoSincPorRat((a) => ({ ...a, [rat.id]: avisos.join(" ") }));
      }
    } catch (err: any) {
      // Mesmo padrão do toast de erro de "Fechar" (acompanharFechamento acima) — não mais o
      // banner de erro no topo da página, que ficava distante da linha que o usuário estava
      // olhando e sem dizer de qual RAT era o erro quando mais de uma é sincronizada em
      // sequência.
      toast.mostrar(`Falha ao sincronizar a RAT ${rat.id}: ${err.response?.data?.error ?? "Falha ao sincronizar com o ERP"}`, "destructive");
    } finally {
      setSincronizando(null);
    }
  }

  // Patch direto na linha da RAT, sem esperar reload da página (14/09/2026, pedido do Vitor)
  // — mesmo espírito de atualizarEnvioDoItem pro RatItem, agora pro cabeçalho da RAT. De
  // propósito NÃO dispara um `carregarRats()` completo depois: se o filtro de Situação
  // estiver em "Digitado", um reload faria a RAT recém-fechada sumir da tabela sem o usuário
  // entender por quê — o patch garante que a badge de Situação atualiza na hora, e a RAT só
  // sai da lista no próximo reload natural (troca de filtro, página, outra ação).
  function atualizarSituacaoDaRat(
    ratId: number,
    dados: { sitrat: number | null; sitratLabel: string; sitratTone: Tone; podeFechar: boolean }
  ) {
    setAjustesRat((a) => ({ ...a, [ratId]: { ...a[ratId], ...dados } }));
  }

  // Fechamento de RAT roda em segundo plano (outbox), igual o envio de apontamento — este é o
  // acompanhamento por polling, clone de acompanharEnvio contra GET /rats/:id/fechamento.
  // Erro vai pro toast (mesmo padrão já usado em "Sync. ERP" de Alocacao.tsx, 14/09/2026) —
  // não mais o banner de erro no topo da página, que ficava distante da linha que o usuário
  // estava olhando. Sucesso patcheia a linha direto (ver atualizarSituacaoDaRat acima).
  function acompanharFechamento(ratId: number, tentativa = 0) {
    const timer = window.setTimeout(async () => {
      let concluido = false;
      try {
        const { data } = await axios.get(`/api/rats/${ratId}/fechamento`);
        concluido = data.status === "enviado" || data.status === "bloqueado" || Boolean(data.erro);
        if (concluido) {
          if (data.erro) {
            toast.mostrar(`Falha ao fechar a RAT ${ratId}: ${data.erro}`, "destructive");
          } else {
            atualizarSituacaoDaRat(ratId, {
              sitrat: data.sitrat,
              sitratLabel: data.sitratLabel,
              sitratTone: data.sitratTone,
              podeFechar: data.podeFechar,
            });
          }
        }
      } catch {
        // Falha de rede no acompanhamento é transitória — tenta de novo no próximo tick.
      }

      if (concluido) return;
      if (tentativa + 1 < ENVIO_MAX_TENTATIVAS) {
        acompanharFechamento(ratId, tentativa + 1);
      }
      // Estourou o tempo sem desfecho: o cron de 15 min assume; "Sinc. ERP" ou F5 mostra o resultado.
    }, ENVIO_INTERVALO_MS);
    timersEnvioRef.current.push(timer);
  }

  async function fecharRat(rat: RatRow) {
    setFechando(rat.id);
    try {
      await axios.post(`/api/rats/${rat.id}/fechar`);
      acompanharFechamento(rat.id);
    } catch (err: any) {
      toast.mostrar(err.response?.data?.error ?? "Falha ao fechar a RAT", "destructive");
    } finally {
      setFechando(null);
    }
  }

  // "Fechar Todos" — resumo ANTES de disparar, igual "Confirmar Todos". Busca a lista completa
  // (sem paginação) de GET /rats/elegiveis-fechamento em vez de usar `rats` do estado, que é só
  // a página atual da tabela (ver carregarRats) — mas com os MESMOS filtros da tela
  // (filtrosRatsParaQuery), senão o resumo incluiria RAT de fora do que está sendo mostrado.
  async function abrirResumoFechamentoLote() {
    setCarregandoResumoFechamentoLote(true);
    setResultadoFechamentoLote(null);
    try {
      const { data } = await axios.get("/api/rats/elegiveis-fechamento", { params: { ...filtrosRatsParaQuery(), ...consultaColunasRats } });
      setResumoFechamentoLote(data.rats ?? []);
    } catch (err: any) {
      toast.mostrar(err.response?.data?.error ?? "Falha ao carregar as RATs elegíveis para fechamento", "destructive");
    } finally {
      setCarregandoResumoFechamentoLote(false);
    }
  }

  async function fecharTodos() {
    if (!resumoFechamentoLote) return;
    setFechandoLote(true);
    try {
      const ratIds = resumoFechamentoLote.map((r) => r.id);
      const { data } = await axios.post("/api/rats/fechar-lote", { ratIds });
      setResultadoFechamentoLote({ solicitados: data.enfileirados?.length ?? 0, falhas: data.falhas ?? [] });
      // Cada RAT enfileirada patcheia a própria linha ao terminar (acompanharFechamento) — não
      // precisa de um carregarRats() aqui pra "refletir o resultado", só pras que falharam já
      // de cara em prepararFechamentoRat (nunca chegaram a enfileirar, então nunca vão ter
      // acompanhamento nenhum rodando).
      if (data.falhas?.length > 0) carregarRats();
      for (const ratId of data.enfileirados ?? []) {
        acompanharFechamento(ratId);
      }
      // Mesmo critério de confirmarTodos: só fecha o modal sozinho quando não há falha
      // parcial, senão o gestor perderia de vista o que travou.
      if (!data.falhas || data.falhas.length === 0) setResumoFechamentoLote(null);
    } catch (err: any) {
      toast.mostrar(err.response?.data?.error ?? "Falha ao fechar RATs em lote", "destructive");
      setResumoFechamentoLote(null);
    } finally {
      setFechandoLote(false);
    }
  }

  async function excluirApontamento(id: number, ratId: number) {
    try {
      await axios.delete(`/api/apontamentos/${id}`);
      const { data } = await axios.get(`/api/rats/${ratId}/itens`);
      setItensPorRat((i) => ({ ...i, [ratId]: data.itens }));
      carregar();
      carregarRats();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao excluir apontamento");
    }
  }

  // Exclusão de sessão ainda NÃO confirmada. Mesma rota do apontamento confirmado — ela
  // marca a sessão como excluída dos dois jeitos; a diferença é que aqui não há RatItem
  // nem RAT pra recarregar.
  //
  // Com pedido de ajuste de horário aguardando o gestor (04/11/2026), o aviso diz que o pedido vai junto e a exclusão manda
  // `excluirAjuste=1`. Se a tela estiver desatualizada (pedido feito depois de a lista carregar), o servidor responde 409
  // "ajuste_pendente" sem excluir nada, e o mesmo aviso aparece antes de tentar de novo (ver backend/src/domain/exclusaoApontamento.ts).
  async function excluirSessao(sessao: SessaoPendente) {
    const temAjuste = sessao.ajustePendente != null;
    if (!confirm(temAjuste ? AVISO_EXCLUIR_COM_AJUSTE : "Excluir este apontamento? Ele sai da lista e deixa de contar nas horas da atividade.")) return;
    setExcluindoSessao(sessao.id);
    try {
      try {
        await axios.delete(`/api/apontamentos/${sessao.id}`, { params: temAjuste ? { excluirAjuste: 1 } : undefined });
      } catch (err: any) {
        if (err.response?.status !== 409 || err.response?.data?.codigo !== "ajuste_pendente") throw err;
        if (!confirm(AVISO_EXCLUIR_COM_AJUSTE)) {
          carregar(); // traz o destaque do pedido que a tela ainda não mostrava
          return;
        }
        await axios.delete(`/api/apontamentos/${sessao.id}`, { params: { excluirAjuste: 1 } });
      }
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao excluir o apontamento");
    } finally {
      setExcluindoSessao(null);
    }
  }

  // Um ponto só pra abrir o formulário, das duas tabelas. Com pedido pendente, os campos
  // nascem com o que FOI PEDIDO (não com o horário atual) — é o que a pessoa quer conferir.
  function abrirPedidoAjuste(
    sessaoId: number,
    titulo: string,
    inicioAtual: string,
    fimAtual: string | null,
    pendente: AjustePendente | null
  ) {
    setPedidoAjuste({ sessaoId, titulo, pendente });
    const inicio = pendente?.inicioSolicitado ?? inicioAtual;
    const fim = pendente?.fimSolicitado ?? fimAtual;
    setAjusteData(paraInputData(inicio));
    setAjusteInicio(paraInputHora(inicio));
    setAjusteFim(fim ? paraInputHora(fim) : "");
    setAjusteMotivo(pendente?.motivo ?? "");
    setErroAjuste(null);
  }

  async function enviarPedidoAjuste() {
    if (!pedidoAjuste) return;
    if (!ajusteData || !ajusteInicio || !ajusteFim) {
      setErroAjuste("Informe a data, a hora inicial e a hora final.");
      return;
    }
    if (ajusteFim <= ajusteInicio) {
      setErroAjuste("A hora final precisa ser depois da inicial.");
      return;
    }
    // `min` do input não impede digitar uma data antiga à mão; o backend recusaria com o mesmo texto.
    if (janela && ajusteData < janela.primeiroDiaPermitido) {
      setErroAjuste(textoJanelaRetroativa(janela));
      return;
    }
    if (ajusteMotivo.trim() === "") {
      setErroAjuste("Informe o motivo da correção.");
      return;
    }
    setEnviandoAjuste(true);
    setErroAjuste(null);
    try {
      await axios.post("/api/solicitacoes-ajuste", {
        sessaoId: pedidoAjuste.sessaoId,
        inicio: new Date(`${ajusteData}T${ajusteInicio}`).toISOString(),
        fim: new Date(`${ajusteData}T${ajusteFim}`).toISOString(),
        motivo: ajusteMotivo.trim(),
      });
      setPedidoAjuste(null);
      carregar();
      carregarRats();
    } catch (err: any) {
      setErroAjuste(err.response?.data?.error ?? "Falha ao enviar o pedido");
    } finally {
      setEnviandoAjuste(false);
    }
  }

  // Opções do multi-select de consultor — só quem TEM sessão pendente na lista carregada,
  // não a base inteira de consultores (mesmo critério da barra de RATs logo abaixo).
  const opcoesFiltroSessoes = useMemo(() => {
    const porCodfor = new Map<number, string>();
    for (const s of sessoes) {
      if (s.consultorNome && !porCodfor.has(s.codfor)) porCodfor.set(s.codfor, s.consultorNome);
    }
    return [...porCodfor.entries()]
      .map(([codfor, nome]) => ({ codfor, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [sessoes]);

  // Filtro em memória: a lista inteira já vem carregada (volume baixo, dezenas de linhas
  // no pior caso — não vale um round-trip ao servidor pra isso, ver plano). Busca casa
  // contra cliente, nº da proposta e a descrição do item (mesmos campos da busca de RATs).
  const sessoesFiltradas = useMemo(() => {
    const busca = buscaSessoesDebounced.trim().toLowerCase();
    // Início/fim do dia local do navegador — mesma convenção do resto da tela (paraInputData/
    // paraInputHora já fazem a mesma leitura de hora local pros formulários de ajuste).
    const inicioFiltro = dataInicioFiltro ? new Date(`${dataInicioFiltro}T00:00:00`).getTime() : null;
    const fimFiltro = dataFimFiltro ? new Date(`${dataFimFiltro}T23:59:59.999`).getTime() : null;
    return sessoes.filter((s) => {
      if (codforsFiltroSessoes.length > 0 && !codforsFiltroSessoes.includes(s.codfor)) return false;
      const inicioSessao = new Date(s.inicio).getTime();
      if (inicioFiltro != null && inicioSessao < inicioFiltro) return false;
      if (fimFiltro != null && inicioSessao > fimFiltro) return false;
      if (!busca) return true;
      const alvo = `${s.cliente ?? ""} ${s.codpro} ${rotuloItem(s)}`.toLowerCase();
      return alvo.includes(busca);
    });
  }, [sessoes, codforsFiltroSessoes, buscaSessoesDebounced, dataInicioFiltro, dataFimFiltro]);

  // Mesma chave de agrupamento de abrirResumoLote (codfor), só que aqui vira acordeon visual
  // em vez de resumo de confirmação em lote — só faz sentido junto de mostrarConsultor, senão
  // é sempre 1 grupo só (o próprio usuário).
  const gruposPorConsultor = useMemo(() => {
    const porConsultor = new Map<number, { codfor: number; consultorNome: string; sessoes: SessaoPendente[]; totalMinutos: number }>();
    for (const s of sessoesFiltradas) {
      let grupo = porConsultor.get(s.codfor);
      if (!grupo) {
        grupo = { codfor: s.codfor, consultorNome: s.consultorNome ?? "—", sessoes: [], totalMinutos: 0 };
        porConsultor.set(s.codfor, grupo);
      }
      grupo.sessoes.push(s);
      grupo.totalMinutos += s.duracaoMinutos;
    }
    return [...porConsultor.values()].sort((a, b) => a.consultorNome.localeCompare(b.consultorNome, "pt-BR"));
  }, [sessoesFiltradas]);

  // Abre sozinho quando só sobra 1 consultor na lista filtrada (ex.: gestor buscou/filtrou até
  // um só) — dependência é o codfor em si, não o array inteiro, pra não reabrir a cada
  // recarregamento se o usuário tiver fechado de propósito.
  const unicoConsultorVisivel = gruposPorConsultor.length === 1 ? gruposPorConsultor[0].codfor : null;
  useEffect(() => {
    if (unicoConsultorVisivel == null) return;
    setConsultoresExpandidos((atual) => (atual.has(unicoConsultorVisivel) ? atual : new Set(atual).add(unicoConsultorVisivel)));
  }, [unicoConsultorVisivel]);

  function toggleExpandirConsultor(codfor: number) {
    setConsultoresExpandidos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(codfor)) proximo.delete(codfor);
      else proximo.add(codfor);
      return proximo;
    });
  }

  // Previsão de "vai dar erro ao confirmar" — mesmo ícone/tom do Cronograma
  // (IconeIntegracaoErp), com duração inválida entrando ANTES do status de sincronização da
  // alocação: é o aviso mais acionável (400 garantido, sem depender de nada do Senior), e o
  // texto é o MESMO que confirmarSessao devolve hoje ao recusar (routes/apontamentos.ts).
  function toneSincSessao(s: SessaoPendente): Tone {
    return s.duracaoInvalida ? "destructive" : s.integracaoErpTone;
  }
  function tituloSincSessao(s: SessaoPendente): string {
    if (s.duracaoInvalida) {
      return "Vai falhar ao confirmar: sessão dura menos de 1 minuto — o Senior só registra por minuto cheio. Ajuste o horário antes de confirmar.";
    }
    if (s.integracaoErpErro) return `Falha no envio da alocação ao Senior: ${s.integracaoErpErro}`;
    if (s.integracaoErpTone === "success") return "Alocação já confirmada pelo Senior.";
    return `Integração da alocação com o Senior: ${s.integracaoErpLabel}`;
  }

  // Motivo de "Pedir ajuste" estar desabilitado por bloqueio de apontamento (ver
  // domain/bloqueioApontamento.ts, backend) — texto único pra não divergir entre a linha
  // plana e a agrupada. "Confirmar" NÃO usa mais isto (03/09/2026): confirmar uma sessão
  // preexistente segue liberado mesmo com o bloqueio ligado, só "pedir ajuste" (que abre uma
  // solicitação NOVA) continua recusado.
  const MOTIVO_BLOQUEIO_APONTAMENTO = "Apontamento bloqueado nesta atividade/proposta pelo gestor.";

  // Por que "Pedir ajuste" está indisponível pra uma sessão, ou undefined se está liberado — texto
  // único pras duas linhas (plana e agrupada). Além do bloqueio, o ajuste confere o dia da sessão
  // ORIGINAL contra a janela de retroatividade (o backend confere também o dia novo pedido): sessão
  // antiga demais não se ajusta nem trazendo pra hoje. Pedido já pendente continua abrindo pra ver.
  function motivoAjusteIndisponivel(s: SessaoPendente): string | undefined {
    if (s.ajustePendente) return undefined;
    if (s.bloqueadoApontamentoEfetivo) return MOTIVO_BLOQUEIO_APONTAMENTO;
    if (janela && paraInputData(s.inicio) < janela.primeiroDiaPermitido) {
      return `Este apontamento é anterior a ${diaCurtoDaJanela(janela.primeiroDiaPermitido)}, fora da janela de retroatividade.`;
    }
    return undefined;
  }

  // Linha de uma sessão pendente na lista plana (consultor comum, sem acordeon) — mesmas
  // colunas responsivas do <thead> de fora.
  function renderLinhaSessao(s: SessaoPendente) {
    return (
      // Faixa âmbar à esquerda quando há ajuste aguardando o gestor: a linha está congelada
      // até a decisão, e sem marca isso não se vê.
      <tr
        key={s.id}
        className={`border-t border-border/60 ${s.ajustePendente ? "border-l-2 border-l-warning bg-warning/5" : ""}`}
      >
        <td className="hidden px-2.5 py-3.5 font-mono text-sm text-muted sm:table-cell">{s.id}</td>
        <td className="px-2.5 py-3.5 text-sm font-semibold text-foreground">{s.codpro}</td>
        {/* O próprio id abre a atividade — mesmo padrão da tabela de itens de RAT logo abaixo. */}
        <td className="hidden px-2.5 py-3.5 font-mono text-sm text-muted sm:table-cell">
          <button
            onClick={() => abrirDetalheAtividade(s.atividadeId)}
            className="text-primary hover:underline"
            title="Abrir a atividade (somente visualização)"
          >
            {s.atividadeId}
          </button>
        </td>
        <td className="hidden max-w-[220px] truncate px-2.5 py-3.5 text-sm text-muted lg:table-cell" title={rotuloItem(s)}>
          {rotuloItem(s)}
        </td>
        <td className="hidden max-w-[200px] truncate px-2.5 py-3.5 text-sm text-muted md:table-cell" title={s.cliente ?? undefined}>
          {s.cliente ?? "—"}
          {s.codcli != null && ` (${s.codcli})`}
        </td>
        <td className="whitespace-nowrap px-2.5 py-3.5 font-mono text-sm text-muted">{dataCurtaFormatter.format(new Date(s.inicio))}</td>
        <td className="hidden whitespace-nowrap px-2.5 py-3.5 font-mono text-sm text-muted sm:table-cell">
          {formatHorario(s.inicio, s.fim)}
        </td>
        <td className="whitespace-nowrap px-2.5 py-3.5 text-right font-mono text-sm tabular-nums text-foreground">
          {formatMinutos(s.duracaoMinutos)}
        </td>
        <td className="hidden px-2.5 py-3.5 lg:table-cell">
          {/* Editar é "só o dono" no servidor (PATCH /:id) — em sessão de outro consultor o
              clique abre a MESMA janela em leitura, só pra ler o texto completo sem
              depender do tooltip truncado (mesmo padrão da observação de item de RAT logo
              abaixo, ModalEditarDescricao com somenteLeitura). */}
          {s.souDono ? (
            <button
              onClick={() => setEditandoDescricaoId(s.id)}
              className={`w-full max-w-[220px] truncate rounded-md border px-2.5 py-1.5 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                descricoes[s.id] ?? s.observacao
                  ? "border-border text-foreground hover:bg-surface-2"
                  : "border-dashed border-border text-muted hover:bg-surface-2"
              }`}
            >
              {descricoes[s.id] ?? s.observacao ?? "+ Adicionar descrição"}
            </button>
          ) : (
            <button
              onClick={() => setEditandoDescricaoId(s.id)}
              title={s.observacao ?? undefined}
              className="block w-full max-w-[220px] truncate text-left text-sm text-muted hover:underline"
            >
              {s.observacao ?? "—"}
            </button>
          )}
        </td>
        {/* Previsão de "vai dar erro ao confirmar" — mesmo indicador visual do Cronograma
            (IconeIntegracaoErp/toneBadge), aplicado à alocação por trás da sessão + duração
            que vai truncar pra zero (ver toneSincSessao/tituloSincSessao acima). */}
        <td className="hidden px-2.5 py-3.5 text-center sm:table-cell">
          <span
            className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${toneBadge[toneSincSessao(s)]}`}
            title={tituloSincSessao(s)}
          >
            <IconeIntegracaoErp tone={toneSincSessao(s)} />
          </span>
        </td>
        {/* Mesmo agrupador "⋯" das linhas de RAT logo abaixo — duas ações soltas na coluna
            empurravam a tabela e competiam por atenção. */}
        <td className="whitespace-nowrap px-2.5 py-3.5 text-right">
          <DropdownMenu placement="bottom-end">
            <DropdownMenu.Trigger>
              <button
                className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Ações do apontamento"
              >
                ⋯
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              {/* Bloqueio de apontamento não trava Confirmar: a sessão já foi trabalhada
                  ANTES do bloqueio ligar (mover card, Start/Stop, ou solicitação avulsa já
                  aprovada) — o backend só recusa por bloqueio quando a sessão nasce agora
                  (lançamento manual do gestor), não ao confirmar uma que já existe (03/09/2026,
                  ver confirmarSessao/origemSessao em routes/apontamentos.ts). */}
              <DropdownMenu.Item onSelect={() => confirmar(s.id)} disabled={confirmando === s.id}>
                {confirmando === s.id ? "Confirmando..." : "Confirmar"}
              </DropdownMenu.Item>
              {/* Pedir ajuste e Excluir são "só o dono" nos respectivos endpoints
                  (solicitacoesAjuste.ts / DELETE /:id) — em sessão de outro consultor o
                  servidor recusaria com 403/404, então a tela nem oferece. Confirmar acima
                  não tem essa restrição (podeExecutarAcao já libera admin). */}
              {s.souDono && (
                <>
                  {/* Confirmar não deixa mexer no horário — só manda a sessão como o
                      rastreamento gravou. Quem precisa de outro intervalo pede aqui, antes de
                      confirmar. Bloqueio só impede pedir um NOVO ajuste — ver um já pendente
                      continua aberto (é o mesmo raciocínio de "reprovar sempre livre"). */}
                  <DropdownMenu.Item
                    onSelect={() =>
                      abrirPedidoAjuste(
                        s.id,
                        `Proposta ${s.codpro} · ${formatHorario(s.inicio, s.fim)}`,
                        s.inicio,
                        s.fim,
                        s.ajustePendente
                      )
                    }
                    disabled={motivoAjusteIndisponivel(s) !== undefined}
                    title={motivoAjusteIndisponivel(s)}
                  >
                    {s.ajustePendente ? "Ver ajuste pendente" : "Pedir ajuste de horário"}
                  </DropdownMenu.Item>
                  {/* Antes daqui não havia como apagar uma sessão rastreada errada — só
                      restava confirmar e desfazer depois. */}
                  <DropdownMenu.Item onSelect={() => excluirSessao(s)} disabled={excluindoSessao === s.id} destructive>
                    {excluindoSessao === s.id ? "Excluindo..." : "Excluir"}
                  </DropdownMenu.Item>
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu>
        </td>
      </tr>
    );
  }

  // Linha de sessão dentro do acordeon por consultor — sub-tabela numa única célula
  // (colSpan cheio, borda fechando os 4 lados nela), mesmo padrão visual e de código da
  // tabela de itens aninhada no detalhe de uma RAT logo abaixo (compacta, sem esconder
  // coluna por breakpoint: já é uma sub-tabela dentro de uma célula só, não precisa
  // acompanhar o <thead> responsivo da tabela de fora).
  function renderLinhaSessaoAgrupada(s: SessaoPendente) {
    return (
      <tr key={s.id} className={`border-t border-border/40 ${s.ajustePendente ? "border-l-2 border-l-warning bg-warning/5" : ""}`}>
        <td className="py-1.5 pr-3 font-mono text-[12.5px] text-muted">{s.id}</td>
        <td className="py-1.5 pr-3 text-[12.5px] font-semibold text-foreground">{s.codpro}</td>
        <td className="py-1.5 pr-3 font-mono text-[12.5px] text-muted">
          <button
            onClick={() => abrirDetalheAtividade(s.atividadeId)}
            className="text-primary hover:underline"
            title="Abrir a atividade (somente visualização)"
          >
            {s.atividadeId}
          </button>
        </td>
        <td className="max-w-[220px] truncate py-1.5 pr-3 text-[12.5px] text-muted" title={rotuloItem(s)}>
          {rotuloItem(s)}
        </td>
        <td className="max-w-[200px] truncate py-1.5 pr-3 text-[12.5px] text-muted" title={s.cliente ?? undefined}>
          {s.cliente ?? "—"}
          {s.codcli != null && ` (${s.codcli})`}
        </td>
        <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-[12.5px] text-muted">
          {dataCurtaFormatter.format(new Date(s.inicio))}
        </td>
        <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-[12.5px] text-muted">{formatHorario(s.inicio, s.fim)}</td>
        <td className="whitespace-nowrap py-1.5 pr-3 text-right font-mono text-[12.5px] tabular-nums text-foreground">
          {formatMinutos(s.duracaoMinutos)}
        </td>
        <td className="max-w-[320px] py-1.5 pr-3">
          {s.souDono ? (
            <button
              onClick={() => setEditandoDescricaoId(s.id)}
              className={`block w-full truncate text-left text-[12.5px] hover:underline ${
                descricoes[s.id] ?? s.observacao ? "text-foreground" : "font-medium text-warning"
              }`}
            >
              {descricoes[s.id] ?? s.observacao ?? "Sem descrição — clique para preencher"}
            </button>
          ) : (
            <button
              onClick={() => setEditandoDescricaoId(s.id)}
              title={s.observacao ?? undefined}
              className="block w-full truncate text-left text-[12.5px] text-muted hover:underline"
            >
              {s.observacao ?? "—"}
            </button>
          )}
        </td>
        <td className="py-1.5 pr-3 text-center">
          <span
            className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${toneBadge[toneSincSessao(s)]}`}
            title={tituloSincSessao(s)}
          >
            <IconeIntegracaoErp tone={toneSincSessao(s)} />
          </span>
        </td>
        <td className="py-1.5 text-right">
          <DropdownMenu placement="bottom-end">
            <DropdownMenu.Trigger>
              <button
                className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Ações do apontamento"
              >
                ⋯
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              {/* Bloqueio de apontamento não trava Confirmar: a sessão já foi trabalhada
                  ANTES do bloqueio ligar (mover card, Start/Stop, ou solicitação avulsa já
                  aprovada) — o backend só recusa por bloqueio quando a sessão nasce agora
                  (lançamento manual do gestor), não ao confirmar uma que já existe (03/09/2026,
                  ver confirmarSessao/origemSessao em routes/apontamentos.ts). */}
              <DropdownMenu.Item onSelect={() => confirmar(s.id)} disabled={confirmando === s.id}>
                {confirmando === s.id ? "Confirmando..." : "Confirmar"}
              </DropdownMenu.Item>
              {s.souDono && (
                <DropdownMenu.Item
                  onSelect={() =>
                    abrirPedidoAjuste(
                      s.id,
                      `Proposta ${s.codpro} · ${formatHorario(s.inicio, s.fim)}`,
                      s.inicio,
                      s.fim,
                      s.ajustePendente
                    )
                  }
                  disabled={motivoAjusteIndisponivel(s) !== undefined}
                  title={motivoAjusteIndisponivel(s)}
                >
                  {s.ajustePendente ? "Ver ajuste pendente" : "Pedir ajuste de horário"}
                </DropdownMenu.Item>
              )}
              {/* Diferente de "Pedir ajuste" acima (só o dono), Excluir aqui também libera
                  pro admin sobre sessão de qualquer consultor — backend confere de novo em
                  DELETE /:id, isto só evita oferecer um botão que ele recusaria. */}
              {s.podeExcluir && (
                <DropdownMenu.Item onSelect={() => excluirSessao(s)} disabled={excluindoSessao === s.id} destructive>
                  {excluindoSessao === s.id ? "Excluindo..." : "Excluir"}
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu>
        </td>
      </tr>
    );
  }

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Gestão de Projetos · Meus Apontamentos
      </p>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Meus Apontamentos</h1>
          <p className="mt-1 text-sm text-muted">
            Revise o tempo rastreado nas atividades e confirme pra virar apontamento oficial.
          </p>
        </div>
        {/* Restrito a gestor de departamento e admin (o servidor decide e também recusa o
            POST) — consultor comum aponta pelo quadro, que gera sessão rastreada. */}
        {podeLancarManual && (
          <button
            onClick={abrirModalManual}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            + Apontamento manual
          </button>
        )}
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}


      <div className="space-y-8">
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted">
              Sessões pendentes de confirmação{" "}
              {sessoesFiltradas.length > 0 &&
                (sessoesFiltradas.length === sessoes.length ? `(${sessoes.length})` : `(${sessoesFiltradas.length} de ${sessoes.length})`)}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {/* Período (AtividadeSessaoExecucao.inicio) — diferente da busca/consultor
                  abaixo, vale pra qualquer usuário, mesmo consultor comum vendo só as
                  próprias sessões. */}
              <div className="flex items-center gap-1.5">
                <label htmlFor="filtro-sessoes-data-inicio" className="text-[12.5px] text-muted">
                  De
                </label>
                <input
                  id="filtro-sessoes-data-inicio"
                  type="date"
                  value={dataInicioFiltro}
                  onChange={(e) => setDataInicioFiltro(e.target.value)}
                  className={selectClass}
                />
                <label htmlFor="filtro-sessoes-data-fim" className="text-[12.5px] text-muted">
                  até
                </label>
                <input
                  id="filtro-sessoes-data-fim"
                  type="date"
                  value={dataFimFiltro}
                  onChange={(e) => setDataFimFiltro(e.target.value)}
                  className={selectClass}
                />
              </div>
              {/* Admin ou gestor com time (mostrarConsultor) — pro consultor comum a lista já é só ele, filtro não ajudaria em nada. */}
              {mostrarConsultor && (
                <>
                  <input
                    type="text"
                    placeholder="Buscar cliente ou proposta..."
                    value={buscaSessoesInput}
                    onChange={(e) => setBuscaSessoesInput(e.target.value)}
                    className={`${selectClass} w-64`}
                  />
                  {opcoesFiltroSessoes.length > 1 && (
                    <MultiSelectDropdown
                      opcoes={opcoesFiltroSessoes.map((c) => ({ value: c.codfor, label: `${c.codfor} - ${c.nome}` }))}
                      selecionados={codforsFiltroSessoes}
                      onChange={setCodforsFiltroSessoes}
                      labelTodos="Todos os consultores"
                      labelSufixo="consultores"
                    />
                  )}
                </>
              )}
              {/* Escopo é o que está NA TELA (sessoesFiltradas) — filtrar por um consultor
                  e clicar aqui confirma só as dele, e o número sempre bate com a lista
                  visível. O resumo por RAT (modal abaixo) é o que deixa o encapsulamento
                  conferível antes de disparar de verdade. */}
              {sessoesFiltradas.length > 0 && (
                <button
                  onClick={abrirResumoLote}
                  className="rounded-md border border-primary/40 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10"
                >
                  Confirmar Todos ({sessoesFiltradas.length})
                </button>
              )}
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                      ID
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Proposta
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                      Id Ativ.
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted lg:table-cell">
                      Item
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted md:table-cell">
                      Cliente
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Data
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                      Horário
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Duração
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted lg:table-cell">
                      Descrição
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-center font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                      Sinc. ERP
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {loading &&
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="hidden px-2.5 py-3.5 sm:table-cell">
                          <Skeleton className="h-4 w-8" />
                        </td>
                        <td className="px-2.5 py-3.5">
                          <Skeleton className="h-4 w-16" />
                        </td>
                        <td className="hidden px-2.5 py-3.5 sm:table-cell">
                          <Skeleton className="h-4 w-8" />
                        </td>
                        <td className="hidden px-2.5 py-3.5 lg:table-cell">
                          <Skeleton className="h-4 w-28" />
                        </td>
                        <td className="hidden px-2.5 py-3.5 md:table-cell">
                          <Skeleton className="h-4 w-28" />
                        </td>
                        <td className="px-2.5 py-3.5">
                          <Skeleton className="h-4 w-24" />
                        </td>
                        <td className="hidden px-2.5 py-3.5 sm:table-cell">
                          <Skeleton className="h-4 w-24" />
                        </td>
                        <td className="px-2.5 py-3.5 text-right">
                          <Skeleton className="ml-auto h-4 w-12" />
                        </td>
                        <td className="hidden px-2.5 py-3.5 lg:table-cell">
                          <Skeleton className="h-7 w-full" />
                        </td>
                        <td className="hidden px-2.5 py-3.5 text-center sm:table-cell">
                          <Skeleton className="mx-auto h-4 w-4 rounded-full" />
                        </td>
                        <td className="px-2.5 py-3.5 text-right">
                          <Skeleton className="ml-auto h-7 w-20 rounded" />
                        </td>
                      </tr>
                    ))}
                  {/* mostrarConsultor (admin/gestor vendo o time): agrupa em acordeon por
                      consultor em vez de repetir o nome numa coluna à parte. */}
                  {!loading &&
                    mostrarConsultor &&
                    gruposPorConsultor.map((grupo) => {
                      const expandido = consultoresExpandidos.has(grupo.codfor);
                      return (
                        <Fragment key={grupo.codfor}>
                          <tr
                            onClick={() => toggleExpandirConsultor(grupo.codfor)}
                            className={`cursor-pointer transition ${
                              expandido ? "border-t border-primary bg-primary/5" : "border-t border-border/60 hover:bg-surface-2"
                            }`}
                          >
                            <td colSpan={11} className={`px-2.5 py-2.5 ${expandido ? "border-l border-r border-primary" : ""}`}>
                              <p className="flex items-center justify-between gap-2 text-sm">
                                <span className="flex items-center gap-2 font-semibold text-foreground">
                                  <span className="text-muted">{expandido ? "▾" : "▸"}</span>
                                  {grupo.consultorNome}
                                </span>
                                <span className="font-mono text-[12.5px] tabular-nums text-muted">
                                  {grupo.sessoes.length} apont. · {formatMinutos(grupo.totalMinutos)}
                                </span>
                              </p>
                            </td>
                          </tr>
                          {/* Mesmo padrão do detalhe de uma RAT logo abaixo: os apontamentos do
                              consultor moram dentro de UMA célula de colSpan cheio — é essa célula
                              que fecha as 4 bordas do acordeon, não cada linha. */}
                          {expandido && (
                            <tr className="border-t border-border/60 bg-surface-2/40">
                              <td colSpan={11} className="border-b border-l border-r border-primary px-2.5 py-3">
                                <table className="w-full border-collapse">
                                  <thead>
                                    <tr>
                                      <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        ID
                                      </th>
                                      <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        Proposta
                                      </th>
                                      <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        Id Ativ.
                                      </th>
                                      <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        Item
                                      </th>
                                      <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        Cliente
                                      </th>
                                      <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        Data
                                      </th>
                                      <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        Horário
                                      </th>
                                      <th className="py-1.5 pr-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        Duração
                                      </th>
                                      <th className="w-2/5 py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        Descrição
                                      </th>
                                      <th className="py-1.5 pr-3 text-center font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        Sinc. ERP
                                      </th>
                                      <th className="py-1.5" />
                                    </tr>
                                  </thead>
                                  <tbody>{grupo.sessoes.map((s) => renderLinhaSessaoAgrupada(s))}</tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  {!loading && !mostrarConsultor && sessoesFiltradas.map((s) => renderLinhaSessao(s))}
                  {!loading && sessoesFiltradas.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-2.5 py-8 text-center text-sm text-muted">
                        {sessoes.length === 0
                          ? 'Nenhuma sessão pendente — mova um card pra "Em Andamento" pra começar a rastrear tempo.'
                          : "Nenhuma sessão encontrada com os filtros atuais."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted">RATs</p>
              <input
                type="text"
                placeholder="Buscar cliente, proposta ou nº da RAT..."
                value={buscaInput}
                onChange={(e) => setBuscaInput(e.target.value)}
                className={`${selectClass} w-64`}
              />
              <input
                type="text"
                placeholder="Buscar na observação ou id da atividade..."
                value={buscaItemInput}
                onChange={(e) => setBuscaItemInput(e.target.value)}
                className={`${selectClass} w-64`}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {situacoesRat.length > 1 && (
                <MultiSelectDropdown
                  opcoes={situacoesRat.map((s) => ({ value: s.sitrat, label: s.label }))}
                  selecionados={sitratFiltro}
                  onChange={onMudarFiltroSitrat}
                  labelTodos="Todas as situações"
                  labelSufixo="situações"
                  acessorio={padroesRats.estrela("sitrat")}
                />
              )}
              <MultiSelectDropdown
                opcoes={OPCOES_INTEGRACAO}
                selecionados={integracaoFiltro}
                onChange={onMudarFiltroIntegracao}
                labelTodos="Todas as sincronizações"
                labelSufixo="sincronizações"
                acessorio={padroesRats.estrela("integracao")}
              />
              {opcoesFiltro.length > 1 && (
                <MultiSelectDropdown
                  opcoes={opcoesFiltro.map((c) => ({ value: c.codfor, label: `${c.codfor} - ${c.nome}` }))}
                  selecionados={codforsFiltro}
                  onChange={onMudarFiltroConsultor}
                  labelTodos="Todos os consultores"
                  labelSufixo="consultores"
                  acessorio={padroesRats.estrela("codfor")}
                />
              )}
              {/* Contador vem de GET /rats/elegiveis-fechamento (carregarRats) — não da página
                  atual de `rats` (que é só 1 página), mas RESPEITA os mesmos filtros da tela
                  (14/09/2026, ver filtrosRatsParaQuery): filtrar por consultor/busca/situação/
                  integração aqui muda tanto a tabela quanto o que "Fechar Todos" abrange.
                  `null` (ainda não carregado) mostra sem número, nunca "(0)" por engano. */}
              <button
                onClick={abrirResumoFechamentoLote}
                disabled={carregandoResumoFechamentoLote || totalElegiveisFechamento === 0}
                className="flex items-center gap-2 rounded-md border border-primary/40 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                {carregandoResumoFechamentoLote && <Spinner className="h-3.5 w-3.5" />}
                Fechar Todos{totalElegiveisFechamento != null ? ` (${totalElegiveisFechamento})` : ""}
              </button>
            </div>
          </div>
          {/* ListaServidor sobre GET /rats/lista: só monta depois que os padrões dos filtros (estrela) foram aplicados, senão a 1ª consulta
              sairia sem eles. */}
          {padroesRats.pronto ? (
            <ListaServidor<RatRow, AcoesRats>
              chave="projetos.apontamentos.rats"
              url="/api/rats/lista"
              params={filtrosRatsParaQuery()}
              defs={COLUNAS_RATS}
              ctx={{
                navegar: navigate,
                sincronizar: sincronizarErp,
                fechar: fecharRat,
                sincronizando,
                fechando,
                avisoSinc: avisoSincPorRat,
                expandidas: ratsExpandidas,
              }}
              chaveLinha={(rat) => String(rat.id)}
              rotulo="RATs"
              vazio="Nenhuma RAT ainda — confirme uma sessão pendente pra começar."
              pageSize={PAGE_SIZE_RATS}
              // GET /rats/lista aceita até 100 por página (paginaMaxima no backend).
              opcoesPorPagina={OPCOES_POR_PAGINA_RATS}
              recarga={recargaRats}
              detalhe={renderDetalheRat}
              abertas={abertasRats}
              onAlternarAberta={(rat) => toggleExpandirRat(rat)}
              ajustarLinha={(rat) => (ajustesRat[rat.id] ? { ...rat, ...ajustesRat[rat.id] } : rat)}
              aoCarregar={() => setAjustesRat({})}
              aoMudarConsulta={mudarConsultaColunasRats}
              aoErro={(_status, mensagem) => setErro(mensagem)}
            />
          ) : (
            <div className="rounded-lg border border-border bg-surface p-4">
              <Skeleton className="h-6 w-full" />
            </div>
          )}
        </section>
      </div>

      {editandoDescricaoId != null &&
        (() => {
          const sessao = sessoes.find((s) => s.id === editandoDescricaoId);
          if (!sessao) return null;
          return (
            <ModalEditarDescricao
              somenteLeitura={!sessao.souDono}
              titulo={`Proposta ${sessao.codpro}`}
              valorInicial={descricoes[sessao.id] ?? sessao.observacao ?? ""}
              onSalvar={(texto) => salvarDescricaoSessaoPendente(sessao.id, texto)}
              onFechar={() => setEditandoDescricaoId(null)}
            />
          );
        })()}

      {/* Edição da observação de um item JÁ confirmado (dentro da RAT) — mesmo PATCH do modal
          acima (que edita a sessão ainda não confirmada); o backend decide onde grava
          (RatItem.desati ou AtividadeSessaoExecucao.observacao) conforme o estado da sessão. */}
      {editandoObservacao && (
        <ModalEditarDescricao
          somenteLeitura={editandoObservacao.somenteLeitura}
          titulo={`Apontamento de ${
            editandoObservacao.item.datati ? dateFormatter.format(new Date(editandoObservacao.item.datati)) : "—"
          }`}
          valorInicial={editandoObservacao.item.desati ?? ""}
          onSalvar={(texto) =>
            salvarObservacaoItem(editandoObservacao.item.sessaoId!, editandoObservacao.ratId, texto)
          }
          onFechar={() => setEditandoObservacao(null)}
        />
      )}

      {/* Manutenção da sessão (coluna Sessão): admin edita com a RAT Digitada; os demais abrem em leitura com o motivo. */}
      {mantendoSessao && (
        <ModalManutencaoSessao
          titulo={`Sessão ${mantendoSessao.item.sessaoId}`}
          contexto={[
            `Consultor: ${mantendoSessao.rat.consultorNome}`,
            `Proposta ${mantendoSessao.rat.codpro ?? "—"} · ${mantendoSessao.rat.cliente ?? "—"}`,
            mantendoSessao.item.confirmadoNoSenior
              ? `Registrado no Senior: RAT ${mantendoSessao.item.numrat}/${mantendoSessao.item.seqrat}`
              : "Ainda não registrado no Senior",
            `Item: ${rotuloItem(mantendoSessao.item)}`,
          ]}
          inicial={{
            data: mantendoSessao.item.datati ? mantendoSessao.item.datati.slice(0, 10) : "",
            inicio: mantendoSessao.item.horini != null ? formatHoraDoDia(mantendoSessao.item.horini) : "",
            fim: mantendoSessao.item.horfim != null ? formatHoraDoDia(mantendoSessao.item.horfim) : "",
            descricao: mantendoSessao.item.desati ?? "",
          }}
          somenteLeitura={!mantendoSessao.item.podeManterSessao}
          motivoSomenteLeitura={mantendoSessao.item.motivoBloqueioManutencao}
          registradoNoSenior={mantendoSessao.item.confirmadoNoSenior}
          salvando={salvandoSessao}
          erro={erroSessao}
          onSalvar={salvarManutencaoSessao}
          onFechar={() => setMantendoSessao(null)}
        />
      )}

      {/* Erro completo de "falha no envio" — mesmo modal da observação, só leitura, só
          trocando o título e o texto mostrado (o erro do Senior, não a observação do item). */}
      {erroEnvioItem && (
        <ModalEditarDescricao
          somenteLeitura
          tituloSomenteLeitura="Falha no envio ao Senior"
          titulo={`Apontamento de ${
            erroEnvioItem.datati ? dateFormatter.format(new Date(erroEnvioItem.datati)) : "—"
          }`}
          valorInicial={(erroEnvioItem.edicaoStatus === "falha" ? erroEnvioItem.edicaoErro : erroEnvioItem.envioErro) ?? ""}
          onSalvar={() => {}}
          onFechar={() => setErroEnvioItem(null)}
        />
      )}

      {/* Escolha da RAT de destino na confirmação individual (25/09/2026) — só abre quando o
          consultor tem 2+ RATs Digitadas na proposta (ver confirmar). Cada opção mostra as
          descrições recentes, que é por onde se reconhece a RAT (ex.: filial do cliente). */}
      {escolhaRat && (
        <Modal
          open
          onClose={() => confirmando !== escolhaRat.sessaoId && setEscolhaRat(null)}
          fecharPorFora={false}
          title="Em qual RAT?"
          subtitulo={escolhaRat.titulo}
        >
          <div className="space-y-4 p-4">
            <OpcoesRatDestino
              nome="rat-destino"
              opcoes={escolhaRat.opcoes}
              valor={escolhaRat.valor}
              onChange={(valor) => setEscolhaRat((atual) => (atual ? { ...atual, valor } : atual))}
              className="max-h-80 overflow-y-auto"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setEscolhaRat(null)}
                disabled={confirmando === escolhaRat.sessaoId}
                className="rounded-md border border-border px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  const { sessaoId, valor } = escolhaRat;
                  await enviarConfirmacao(sessaoId, ratDestinoDoValor(valor));
                  setEscolhaRat(null);
                }}
                disabled={confirmando === escolhaRat.sessaoId}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {confirmando === escolhaRat.sessaoId && <Spinner className="h-3.5 w-3.5" />}
                Confirmar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Resumo antes de confirmar em lote — agrupado pela MESMA chave (consultor+proposta)
          que o servidor usa pra encapsular na RAT, pra deixar visível que nada vai se
          misturar antes de disparar de verdade. Não fecha por fora: some ação em andamento
          ou resultado com falha que não pode sumir num clique sem querer. */}
      {resumoLote && (
        <Modal
          open
          onClose={() => !confirmandoLote && setResumoLote(null)}
          fecharPorFora={false}
          title="Confirmar apontamentos em lote"
          subtitulo={`${resumoLote.reduce((soma, g) => soma + g.sessaoIds.length, 0)} sessões · ${resumoLote.length} RAT${resumoLote.length === 1 ? "" : "s"}`}
        >
          <div className="space-y-4 p-4">
            <div className="max-h-[28rem] space-y-3 overflow-y-auto rounded-md border border-border bg-surface-2/40 p-3">
              {resumoLote.map((g) => (
                <div key={g.chave} className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-foreground">
                      Proposta {g.codpro} · {g.consultorNome ?? "eu"}
                    </span>
                    <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted">
                      {g.sessaoIds.length} apont. · {formatMinutos(g.minutos)}
                    </span>
                  </div>
                  {g.destino != null && (
                    <OpcoesRatDestino
                      nome={`rat-destino-${g.chave}`}
                      opcoes={ratsDestino[g.chave] ?? []}
                      valor={g.destino}
                      desabilitado={confirmandoLote || resultadoLote != null}
                      onChange={(valor) =>
                        setResumoLote((atual) =>
                          atual ? atual.map((x) => (x.chave === g.chave ? { ...x, destino: valor } : x)) : atual
                        )
                      }
                    />
                  )}
                </div>
              ))}
            </div>

            {resultadoLote && resultadoLote.falhas.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <p className="mb-1 font-medium">
                  {resultadoLote.confirmados} confirmado{resultadoLote.confirmados === 1 ? "" : "s"}, {resultadoLote.falhas.length}{" "}
                  falhou{resultadoLote.falhas.length === 1 ? "" : "aram"}:
                </p>
                <ul className="list-inside list-disc space-y-0.5">
                  {resultadoLote.falhas.map((f) => (
                    <li key={f.sessaoId}>
                      Sessão {f.sessaoId}: {f.erro}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setResumoLote(null)}
                disabled={confirmandoLote}
                className="rounded-md border border-border px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
              >
                {resultadoLote ? "Fechar" : "Cancelar"}
              </button>
              {!resultadoLote && (
                <button
                  onClick={confirmarTodos}
                  disabled={confirmandoLote}
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {confirmandoLote && <Spinner className="h-3.5 w-3.5" />}
                  Confirmar {resumoLote.reduce((soma, g) => soma + g.sessaoIds.length, 0)} apontamentos
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Resumo do "Fechar Todos" — clone do modal de "Confirmar apontamentos em lote" acima,
          mesma UX: mostra o que vai ser fechado ANTES de disparar, e falha parcial fica
          visível no próprio diálogo em vez de fechar sozinho. */}
      {resumoFechamentoLote && (
        <Modal
          open
          onClose={() => !fechandoLote && setResumoFechamentoLote(null)}
          fecharPorFora={false}
          title="Fechar RATs em lote"
          subtitulo={`${resumoFechamentoLote.length} RAT${resumoFechamentoLote.length === 1 ? "" : "s"}`}
        >
          <div className="space-y-4 p-4">
            {resumoFechamentoLote.length === 0 ? (
              <p className="text-sm text-muted">Nenhuma RAT Digitada elegível para fechamento agora.</p>
            ) : (
              <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border border-border bg-surface-2/40 p-3">
                {resumoFechamentoLote.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-foreground">
                      RAT {r.numrat ?? r.id} · Proposta {r.codpro ?? "—"} · {r.consultorNome}
                    </span>
                    <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted">{formatMinutos(r.totalMinutos)}</span>
                  </div>
                ))}
              </div>
            )}

            {resultadoFechamentoLote && resultadoFechamentoLote.falhas.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <p className="mb-1 font-medium">
                  {resultadoFechamentoLote.solicitados} solicitado{resultadoFechamentoLote.solicitados === 1 ? "" : "s"} (o
                  fechamento em si acontece em segundo plano),{" "}
                  {resultadoFechamentoLote.falhas.length} falhou{resultadoFechamentoLote.falhas.length === 1 ? "" : "aram"}:
                </p>
                <ul className="list-inside list-disc space-y-0.5">
                  {resultadoFechamentoLote.falhas.map((f) => (
                    <li key={f.ratId}>
                      RAT {f.ratId}: {f.erro}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setResumoFechamentoLote(null)}
                disabled={fechandoLote}
                className="rounded-md border border-border px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
              >
                {resultadoFechamentoLote ? "Fechar" : "Cancelar"}
              </button>
              {!resultadoFechamentoLote && resumoFechamentoLote.length > 0 && (
                <button
                  onClick={fecharTodos}
                  disabled={fechandoLote}
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {fechandoLote && <Spinner className="h-3.5 w-3.5" />}
                  Fechar {resumoFechamentoLote.length} RATs
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Pedido de correção de horário. Não fecha por clique fora nem por Esc — tem texto
          digitado dentro, mesma razão do modal de parada. */}
      {pedidoAjuste && (
        <Modal
          open
          onClose={() => setPedidoAjuste(null)}
          fecharPorFora={false}
          title={pedidoAjuste.pendente ? "Ajuste aguardando o gestor" : "Pedir ajuste de horário"}
          subtitulo={pedidoAjuste.titulo}
        >
          <div className="space-y-3 p-4">
            {pedidoAjuste.pendente ? (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-[12.5px] text-warning">
                Pedido enviado em {dataCurtaFormatter.format(new Date(pedidoAjuste.pendente.criadoEm))} às {horaCurtaFormatter.format(new Date(pedidoAjuste.pendente.criadoEm))}, aguardando decisão. O
                envio ao Senior está retido até lá. Para mudar o horário pedido, o gestor precisa decidir este pedido antes.
              </p>
            ) : (
              <p className="text-[12.5px] text-muted">
                O envio deste apontamento ao Senior fica retido até o gestor decidir — o ERP só recebe o horário final.
              </p>
            )}
            {!pedidoAjuste.pendente && janela && <p className="text-[11.5px] text-muted">{textoJanelaRetroativa(janela)}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="aj-data" className="text-[12px] text-muted">
                Data
              </label>
              <input
                id="aj-data"
                type="date"
                min={janela?.primeiroDiaPermitido}
                value={ajusteData}
                onChange={(e) => setAjusteData(e.target.value)}
                disabled={pedidoAjuste.pendente != null}
                className="rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <label htmlFor="aj-ini" className="text-[12px] text-muted">
                das
              </label>
              <input
                id="aj-ini"
                type="time"
                value={ajusteInicio}
                onChange={(e) => setAjusteInicio(e.target.value)}
                disabled={pedidoAjuste.pendente != null}
                className="rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <label htmlFor="aj-fim" className="text-[12px] text-muted">
                às
              </label>
              <input
                id="aj-fim"
                type="time"
                value={ajusteFim}
                onChange={(e) => setAjusteFim(e.target.value)}
                disabled={pedidoAjuste.pendente != null}
                className="rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <textarea
              value={ajusteMotivo}
              onChange={(e) => setAjusteMotivo(e.target.value)}
              disabled={pedidoAjuste.pendente != null}
              rows={3}
              placeholder="Motivo da correção — é o que o gestor lê pra decidir"
              className="w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {erroAjuste && <p className="text-[12px] text-destructive">{erroAjuste}</p>}
            {/* Com pedido pendente não há o que enviar — só fechar. Mostrar um botão que o
                servidor recusaria seria prometer uma ação que não existe. */}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setPedidoAjuste(null)}
                disabled={enviandoAjuste}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
              >
                {pedidoAjuste.pendente ? "Fechar" : "Cancelar"}
              </button>
              {!pedidoAjuste.pendente && (
                <button
                  onClick={enviarPedidoAjuste}
                  disabled={enviandoAjuste}
                  className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {enviandoAjuste ? "Enviando..." : "Enviar para o gestor"}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Mesmo painel que abre ao clicar no card do quadro, em modo leitura: todas as ações
          de escrita do AtividadeDetalhe (planejamento, checklist, anexos, comentários) são
          governadas por `podeEditar`, então false basta pra virar só visualização. */}
      {detalheAtividade && (
        <AtividadeDetalhe
          atividadeId={detalheAtividade.id}
          titulo={`Proposta ${detalheAtividade.codpro} · Projeto ${detalheAtividade.numprj ?? "—"}`}
          podeEditar={false}
          dataPrevistaInicio={detalheAtividade.dataPrevistaInicio}
          dataPrevistaFim={detalheAtividade.dataPrevistaFim}
          codemp={detalheAtividade.codemp}
          codpro={detalheAtividade.codpro}
          itemDescricao={detalheAtividade.itemDescricao}
          itemQtdhor={detalheAtividade.itemQtdhor}
          itemAlocado={detalheAtividade.itemAlocado}
          itemRealizado={detalheAtividade.itemRealizado}
          estruturaNome={detalheAtividade.estruturaNome}
          estruturaPercentual={detalheAtividade.estruturaPercentual}
          estruturaAtividadeId={detalheAtividade.estruturaAtividadeId}
          depexeLabel={detalheAtividade.depexeLabel}
          podeVerCronograma={detalheAtividade.podeVerCronograma}
          qtdhorPrevisto={detalheAtividade.qtdhorPrevisto ?? null}
          horasExcedentes={detalheAtividade.horasExcedentes ?? 0}
          horasRealizadas={detalheAtividade.horasRealizadas}
          // Painel em modo leitura: aqui é o consultor olhando o próprio apontamento, e
          // ele nunca autoriza as próprias horas excedentes.
          podeAutorizarExcedente={false}
          souOExecutor={false}
          // Painel só-leitura: nenhuma ação de excedente/apontamento aparece aqui de
          // qualquer forma (gates acima), então o valor não afeta a tela.
          bloqueadoApontamento={false}
          bloqueadoExcedente={false}
          onClose={() => setDetalheAtividade(null)}
        />
      )}

      {modalManual && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-foreground">Apontamento manual</h2>
              <button
                onClick={() => {
                  setModalManual(false);
                  limparFormularioManual();
                }}
                className="text-sm text-muted hover:text-foreground"
              >
                Fechar
              </button>
            </div>
            {erroManual && (
              <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {erroManual}
              </p>
            )}
            <div className="space-y-3">
              {/* Só aparece pra quem pode lançar por mais de uma pessoa (gestor/admin) —
                  consultor comum recebe uma lista com ele mesmo e não vê seletor nenhum. */}
              {consultoresManual.length > 1 && (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted">Consultor</span>
                  <select value={manualCodfor} onChange={(e) => onMudarConsultorManual(e.target.value)} className={selectClass}>
                    <option value="">Eu mesmo</option>
                    {consultoresManual.map((c) => (
                      <option key={c.codfor} value={c.codfor}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted">Atividade</span>
                {/* Combobox em vez de <select>: a lista de um consultor chega a dezenas de
                    atividades, com a mesma proposta repetida em vários itens. Agrupa por
                    proposta+cliente e permite buscar — `<option>` nativo não aceita nada
                    disso. */}
                <SelectBuscavel
                  opcoes={atividades.map((a) => ({
                    value: a.id,
                    grupo: `Proposta ${a.codpro}${a.cliente ? ` · ${a.cliente}` : ""}`,
                    rotulo: rotuloItem(a),
                  }))}
                  valor={manualAtividadeId ? Number(manualAtividadeId) : null}
                  onChange={(id) => setManualAtividadeId(String(id))}
                  placeholder={carregandoAtividadesManual ? "Carregando..." : "Selecione a atividade..."}
                  textoVazio="Nenhuma atividade disponível para este consultor."
                  desabilitado={carregandoAtividadesManual}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted">Data</span>
                <input type="date" value={manualData} onChange={(e) => setManualData(e.target.value)} className={selectClass} />
              </label>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[11px] text-muted">Início</span>
                  <input type="time" value={manualInicio} onChange={(e) => setManualInicio(e.target.value)} className={selectClass} />
                </label>
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[11px] text-muted">Fim</span>
                  <input type="time" value={manualFim} onChange={(e) => setManualFim(e.target.value)} className={selectClass} />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted">Descrição</span>
                <textarea
                  value={manualDescricao}
                  onChange={(e) => setManualDescricao(e.target.value)}
                  rows={2}
                  className={`${selectClass} resize-none`}
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setModalManual(false);
                  limparFormularioManual();
                }}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
              >
                Cancelar
              </button>
              <button
                onClick={salvarManual}
                disabled={salvandoManual}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {salvandoManual ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
