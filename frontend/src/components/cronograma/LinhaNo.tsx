import { useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { HorasAgregadas, OrcamentoItem, StatusNo, estadoAlertaItem, formatHorasCompacto, larguraColunaHorasPx } from "../../lib/cronograma";
import { NoCronogramaCompleto } from "../../hooks/useCronograma";
import { Tone, toneBadge } from "../ui/badges";
import { Spinner } from "../ui/Spinner";
import { BadgeStatus } from "./BadgeStatus";
import { MenuAcoesNo, DestinoMover } from "./MenuAcoesNo";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

function formatPeriodoCompacto(inicio: string | null, fim: string | null): string {
  if (!inicio && !fim) return "—";
  const i = inicio ? dateFormatter.format(new Date(inicio)) : "?";
  const f = fim ? dateFormatter.format(new Date(fim)) : "?";
  return `${i} – ${f}`;
}

// Exportada (junto com IconeStatusAtividade abaixo) pra ser reusada fora da árvore de
// edição — ver HierarquiaAtividadeTooltip.tsx, que mostra a mesma linha em modo leitura.
export function iniciais(nome: string | null): string {
  if (!nome) return "—";
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "—";
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primeira + ultima).toUpperCase();
}

const CIRCULO_STATUS: Record<StatusNo, string> = {
  nao_iniciada: "border-muted",
  em_curso: "border-primary bg-primary/20",
  bloqueada: "border-warning bg-warning/20",
  concluida: "border-success bg-success",
};

export function IconeStatusAtividade({ status }: { status: StatusNo }) {
  return (
    <span className={`flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full border-2 ${CIRCULO_STATUS[status]}`}>
      {status === "concluida" && (
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="var(--success-foreground)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </span>
  );
}

// Ícone do status de integração com o Senior — o tom já identifica o estado sozinho
// (integracaoErpTone em ratDominio.ts é uma bijeção: falha=destructive, enviando=warning,
// pendente=neutral, sincronizado=success), então o ícone escolhe pelo tom, sem precisar do
// status cru. Descritivo completo vai só no `title` de quem usa (hover), não aqui dentro.
function IconeIntegracaoErp({ tone, className = "h-2.5 w-2.5" }: { tone: Tone; className?: string }) {
  if (tone === "warning") return <Spinner className={className} />; // enviando — em voo
  if (tone === "destructive") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true">
        <line x1="6" y1="6" x2="18" y2="18" />
        <line x1="18" y1="6" x2="6" y2="18" />
      </svg>
    );
  }
  if (tone === "neutral") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" aria-hidden="true">
        <circle cx="12" cy="12" r="8" />
      </svg>
    );
  }
  // success — sincronizado
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function combinarRefs<T>(...refs: (((node: T) => void) | undefined)[]) {
  return (node: T) => {
    for (const ref of refs) ref?.(node);
  };
}

interface LinhaNoProps {
  no: NoCronogramaCompleto;
  profundidade: number;
  temFilhos: boolean;
  expandido: boolean;
  statusEfetivo: StatusNo;
  // Alocado e Realizado, já somados pra cima (ver agregarHoras).
  agregado: HorasAgregadas;
  // Horas contratadas do item da proposta, já somadas pra cima (ver agregarOrcado).
  orcado: number;
  // Só presente pra tipo="item". Não alimenta mais coluna nenhuma — sobrou pra decidir o
  // estado de alerta da linha (borda, fundo e os chips de estouro).
  orcamento?: OrcamentoItem;
  contagemDescendentes: number;
  selecionado: boolean;
  destinosPossiveis: DestinoMover[];
  onToggleExpandir: () => void;
  onSelecionar: () => void;
  onAbrirDrawer: () => void;
  onDuplicar: () => void;
  onMoverPara: (parentId: number) => void;
  onSoltar?: () => void;
  onAdicionarDentro?: (tipo: "pasta" | "atividade") => void;
  onAlocarConsultores?: () => void;
  onExcluir: () => void;
  // Reenvia a alocação ao Senior — só faz sentido (e o MenuAcoesNo só mostra a ação) quando
  // no.integracaoErpTone === "destructive" (falha no envio, ver GET .../cronograma).
  onSincronizarSenior?: () => void;
  // Dígitos mínimos de hora usados em toda a linha (ver larguraHorasProposta em
  // cronograma.ts) — mesmo valor pra árvore inteira, calculado uma vez no topo.
  larguraHoras: number;
  // Permissão no nível da proposta (ver backend podeGerenciarProposta). Separada do
  // `no.podeEditarItem` porque organizar a estrutura não é alocar: quem enxerga a
  // proposta pode reorganizá-la, mesmo em item de outro departamento.
  podeGerenciarProposta: boolean;
}

export function LinhaNo({
  no,
  profundidade,
  temFilhos,
  expandido,
  statusEfetivo,
  agregado,
  orcado,
  orcamento,
  contagemDescendentes,
  selecionado,
  destinosPossiveis,
  onToggleExpandir,
  onSelecionar,
  onAbrirDrawer,
  onDuplicar,
  onMoverPara,
  onSoltar,
  onAdicionarDentro,
  onAlocarConsultores,
  onExcluir,
  onSincronizarSenior,
  larguraHoras,
  podeGerenciarProposta,
}: LinhaNoProps) {
  const paddingEsquerda = 14 + profundidade * 24;

  // Arrastar um ITEM só o agrupa/desagrupa de uma pasta raiz — organização da estrutura,
  // não distribuição de horas. Por isso vale a permissão da proposta e não a do item:
  // antes, item de outro departamento ficava imóvel no meio da árvore, sem como
  // organizá-lo. Pasta e atividade seguem pela permissão do item que as contém.
  const podeArrastar = no.tipo === "item" ? podeGerenciarProposta : no.podeEditarItem;
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: `no-${no.id}`,
    disabled: !podeArrastar,
  });
  const { setNodeRef: setTopoRef, isOver: isOverTopo } = useDroppable({
    id: `topo-${no.id}`,
    disabled: no.tipo === "item",
  });
  const { setNodeRef: setCorpoRef, isOver: isOverCorpo } = useDroppable({ id: `corpo-${no.id}` });

  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 30 } : undefined;

  function aoClicarLinha() {
    onSelecionar();
    // Nó com filhos: o clique expande/recolhe. Abrir o painel de edição de uma pasta
    // cheia era o comportamento mais provável de ser acidental — quem clica numa pasta
    // quer ver o que tem dentro. Editar passou pro menu ⋯.
    if (temFilhos) {
      onToggleExpandir();
      return;
    }
    // Folha (pasta vazia ou atividade sem filhos): não há o que expandir, então o clique
    // continua abrindo a edição direto. Item nunca abre: ele não é editável aqui.
    if (no.tipo !== "item") onAbrirDrawer();
  }

  // Tratamento de linha por estado de alerta do item — só os dois mais graves pintam a
  // linha inteira (borda + fundo) e ganham chip. `estouro_distribuicao` deixou de ter
  // representação visual na linha: ele só aparecia nos números do bloco de orçamento,
  // que saiu daqui. Continua sendo calculado porque alimenta os outros dois estados.
  const alerta = orcamento ? estadoAlertaItem(orcamento) : "ok";
  const excedenteReal = orcamento ? orcamento.horasRealizadas - orcamento.horasContratadas : 0;

  // Mesma função usada pelo cabeçalho da árvore — é o que garante que os dois alinhem.
  const larguraColunaNumero = larguraColunaHorasPx(larguraHoras);

  return (
    <div className="group relative" ref={setTopoRef}>
      {isOverTopo && <div className="absolute inset-x-0 top-0 z-20 h-0.5 bg-primary" />}
      <div
        ref={combinarRefs(setDragRef, setCorpoRef)}
        role="treeitem"
        aria-expanded={temFilhos ? expandido : undefined}
        aria-selected={selecionado}
        tabIndex={0}
        onClick={aoClicarLinha}
        onFocus={onSelecionar}
        // min-h abaixo da altura natural do conteúdo de propósito: toda linha tem uma
        // linha de texto só, e quem define a altura é o avatar do responsável (22px) nas
        // atividades. O min-h vira só um piso pra linha vazia, em vez de reservar espaço
        // morto como os 46px de antes.
        className={`flex ${
          no.tipo === "item" ? "min-h-[32px]" : "min-h-7"
        } cursor-pointer items-center gap-1.5 border-b border-border/50 py-1 pr-2 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
          alerta === "estouro_realizado"
            ? "border-l-[3px] border-l-destructive bg-destructive/10"
            : alerta === "real_acima_previsto"
              ? "border-l-[3px] border-l-warning bg-warning/10"
              : no.tipo === "pasta"
                ? "bg-surface-2"
                : "bg-surface hover:bg-surface-2"
        } ${
          alerta === "ok" || alerta === "estouro_distribuicao"
            ? no.tipo === "item" && expandido
              ? "border-l-[3px] border-l-primary"
              : no.tipo === "item"
                ? "border-l border-l-border"
                : ""
            : ""
        } ${selecionado ? "ring-1 ring-inset ring-primary/50" : ""} ${isDragging ? "opacity-40" : ""} ${
          isOverCorpo && no.tipo !== "atividade" ? "ring-2 ring-inset ring-primary/40" : ""
        }`}
        style={style}
      >
        {/* Coluna 1 — Estrutura. É a ÚNICA flexível da linha, e é dentro dela que mora a
            indentação. Antes o paddingLeft ficava na linha inteira, então abrir uma pasta
            empurrava tudo pra direita e o departamento aparecia num x diferente a cada
            nível. Agora a indentação é consumida aqui e as colunas seguintes não sentem. */}
        <div
          className="flex min-w-0 flex-1 items-center gap-1.5"
          style={{ paddingLeft: paddingEsquerda }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpandir();
            }}
            className="flex w-4 flex-none items-center justify-center rounded text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {temFilhos ? (expandido ? "▾" : "▸") : "·"}
          </button>

          {podeArrastar && (
            <span
              {...listeners}
              {...attributes}
              onClick={(e) => e.stopPropagation()}
              className="flex-none cursor-grab text-[11px] text-muted opacity-0 group-hover:opacity-100 active:cursor-grabbing"
              title="Arrastar"
            >
              ⠿
            </span>
          )}

          <span className="flex-none text-[13px]">{no.tipo === "item" ? "📦" : no.tipo === "pasta" ? "📁" : null}</span>

          {no.tipo === "atividade" && <IconeStatusAtividade status={statusEfetivo} />}

              {/* Nº do item como prefixo, com 2 dígitos. `flex-none` e largura fixa: assim
                  não disputa o orçamento do truncate e as descrições começam todas no mesmo
                  x, mesmo quando a proposta passa do item 9 pro 10. */}
              {no.tipo === "item" && no.seqite != null && (
                <span
                  className="w-5 flex-none text-right font-mono text-[11.5px] tabular-nums text-muted"
                  title={`Item ${no.seqite}`}
                >
                  {String(no.seqite).padStart(2, "0")}
                </span>
              )}
              {/* Sem teto de largura: a descrição fica com toda a sobra da coluna de
                  estrutura, que é a única flexível da linha. Quem garante que ela não
                  empurra ninguém é o `truncate` com `min-w-0`. */}
              <span
                className={`min-w-0 flex-1 truncate text-sm ${
                  no.tipo === "item" ? "font-medium text-foreground" : "text-foreground"
                }`}
                title={no.nome}
              >
                {no.nome}
              </span>

            {/* Chips de alerta dentro da coluna de estrutura: são condicionais, e do lado
                de fora empurrariam as colunas estáticas em algumas linhas e não em outras. */}
            {no.tipo === "item" && alerta === "estouro_realizado" && (
              <span
                className="hidden flex-none items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-destructive sm:inline-flex"
                title={`Realizado excede o contratado em ${formatHorasCompacto(excedenteReal, larguraHoras)}`}
              >
                ⚠ +{formatHorasCompacto(excedenteReal, larguraHoras)}
              </span>
            )}

            {no.tipo === "item" && alerta === "real_acima_previsto" && (
              <span
                className="hidden flex-none items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-warning sm:inline-flex"
                title="O realizado já passou do que foi distribuído — planejamento ficou pra trás"
              >
                real &gt; distr
              </span>
            )}

            {/* Duração da atividade (EstruturaAtividade.duracaoHoras) fora de sincronia com
                o qtdhor da alocação enviada ao Senior — bug de sincronização conhecido (ver
                backend/src/sync/atividadeConsultorSync.ts), não um estado de orçamento. */}
            {no.tipo === "atividade" && no.horasDivergentes && (
              <span
                className="hidden flex-none items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-warning sm:inline-flex"
                title={`Duração da tarefa: ${formatHorasCompacto(no.horasPrevistas ?? 0, larguraHoras)} · Enviado ao Senior: ${formatHorasCompacto(no.horasAlocadas, larguraHoras)} — fora de sincronia`}
              >
                ⚠ horas div.
              </span>
            )}

            {/* Status de integração com o Senior (seqati confirmado / enviando / falha no
                envio / ainda pendente) — fato sobre o ENVIO em si, não sobre desalinho de
                dado (isso é horasDivergentes, acima). Os dois podem estar presentes ao
                mesmo tempo sem relação causal entre eles. */}
            {no.tipo === "atividade" && no.integracaoErpLabel != null && (
              <span
                className={`hidden h-4 w-4 flex-none items-center justify-center rounded-full sm:inline-flex ${
                  toneBadge[no.integracaoErpTone ?? "neutral"]
                }`}
                title={`Integração com o Senior: ${no.integracaoErpLabel}`}
              >
                <IconeIntegracaoErp tone={no.integracaoErpTone ?? "neutral"} />
              </span>
            )}

            {/* Predecessora fica na coluna de estrutura: é sobre a atividade em si, e
                acompanha o nome dela. */}
            {no.tipo === "atividade" && no.predecessoraId != null && (
              <span className="flex-none rounded bg-warning/15 px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-warning">
                dep. {no.predecessoraId}
              </span>
            )}
        </div>

        {/* Coluna 2 — Departamento executor (item) ou Responsável (atividade). É a MESMA
            vaga: as duas informações nunca coexistem numa linha, e dividir o slot mantém a
            tabela estreita. Largura fixa e `flex-none`, então o conteúdo começa sempre no
            mesmo x — antes o responsável vivia dentro da coluna flexível, encostado à
            direita da descrição, e por isso a borda esquerda dele variava com o tamanho de
            cada nome. */}
        <div className="hidden w-[168px] flex-none sm:block">
          {no.tipo === "item" && no.depexeLabel && (
            <span
              className="block truncate rounded bg-surface-2 px-1.5 py-0.5 text-center font-mono text-[9.5px] font-medium text-muted"
              title={`Departamento executor: ${no.depexeLabel}`}
            >
              {no.depexeLabel}
            </span>
          )}
          {no.tipo === "atividade" && (
            <span className="flex min-w-0 items-center gap-1.5" title={no.responsavelNome ?? "Sem responsável"}>
              <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-surface-2 font-mono text-[9.5px] font-medium text-muted">
                {iniciais(no.responsavelNome)}
              </span>
              {/* Nome ao lado das iniciais — o avatar sozinho obrigava a passar o mouse
                  pra saber de quem era a atividade. */}
              {no.responsavelNome && <span className="min-w-0 truncate text-[12px] text-muted">{no.responsavelNome}</span>}
            </span>
          )}
        </div>

        {/* Colunas numéricas — Orçado, Realizado e Alocado. Todas com a MESMA largura,
            `flex-none` e presentes em toda linha, inclusive quando vazias: é isso que faz
            os números caírem sempre no mesmo x, seja pasta, item ou atividade. Antes as
            duas grandezas de pasta dividiam uma coluna só ("000:00 · 100:00") enquanto o
            item ficava com ela vazia, e nada alinhava.

            As três somam pra cima pela mesma lógica: Orçado vem de agregarOrcado (para no
            nó do item, que é onde mora o contrato) e Realizado/Alocado vêm de agregarHoras
            (param na atividade, que é onde mora a distribuição).

            Só Orçado fica em branco na atividade: ela não tem contrato próprio, o que ela
            tem é distribuição, e isso já vive na coluna Alocado. Pasta abaixo de um item
            também fica, porque somaria zero e "000:00" ali sugeriria contrato zerado. */}
        <div
          className="hidden flex-none text-right font-mono text-[12px] tabular-nums text-muted md:block"
          style={{ width: larguraColunaNumero }}
          title="Orçado"
        >
          {no.tipo === "item" || (no.tipo === "pasta" && orcado > 0) ? formatHorasCompacto(orcado, larguraHoras) : ""}
        </div>

        <div
          className={`hidden flex-none text-right font-mono text-[12px] tabular-nums md:block ${
            agregado.horasRealizadas > agregado.horasPrevistas ? "text-warning" : "text-primary"
          }`}
          style={{ width: larguraColunaNumero }}
          title="Realizado"
        >
          {formatHorasCompacto(agregado.horasRealizadas, larguraHoras)}
        </div>

        <div
          className="hidden flex-none text-right font-mono text-[12px] tabular-nums text-muted md:block"
          style={{ width: larguraColunaNumero }}
          title="Alocado"
        >
          {formatHorasCompacto(agregado.horasPrevistas, larguraHoras)}
        </div>

        {/* Excedente autorizado (AtividadeConsultor.horasExcedentes), somado pra cima do
            mesmo jeito que Realizado/Alocado (ver agregarHoras). Em branco quando zero — a
            maioria das linhas nunca tem excedente, então "0:00" em toda linha só faria
            ruído; aqui o vazio já é o sinal de "nada fora do combinado". */}
        <div
          className="hidden flex-none text-right font-mono text-[12px] tabular-nums text-warning md:block"
          style={{ width: larguraColunaNumero }}
          title="Excedente"
        >
          {agregado.horasExcedentes > 0 ? formatHorasCompacto(agregado.horasExcedentes, larguraHoras) : ""}
        </div>

        <div className="hidden w-[110px] flex-none text-right font-mono text-[11.5px] text-muted md:block">
          {no.tipo === "atividade" ? formatPeriodoCompacto(no.dataPrevistaInicio, no.dataPrevistaFim) : ""}
        </div>

        <div className="w-[90px] flex-none text-right">
          <BadgeStatus status={statusEfetivo} />
        </div>

        <div className="w-6 flex-none" onClick={(e) => e.stopPropagation()}>
          {no.podeEditarItem && (
            <MenuAcoesNo
              no={no}
              contagemDescendentes={contagemDescendentes}
              destinosPossiveis={destinosPossiveis}
              ehItem={no.tipo === "item"}
              onEditar={onAbrirDrawer}
              onDuplicar={onDuplicar}
              onMoverPara={onMoverPara}
              onSoltar={onSoltar}
              onAdicionarDentro={no.tipo !== "atividade" ? onAdicionarDentro : undefined}
              permiteAdicionarAtividade={no.tipo === "item" || (no.tipo === "pasta" && no.seqite != null)}
              onAlocarConsultores={onAlocarConsultores}
              onExcluir={onExcluir}
              onSincronizarSenior={onSincronizarSenior}
            />
          )}
        </div>
      </div>
    </div>
  );
}
