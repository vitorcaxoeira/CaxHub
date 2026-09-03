import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { agregarHoras, formatHorasCompacto, larguraHorasProposta, somarOrcamentos } from "../../lib/cronograma";
import { tomConsumo } from "../../lib/consumoHoras";
import { useCronograma } from "../../hooks/useCronograma";
import { ArvoreCronograma } from "../../components/cronograma/ArvoreCronograma";
import { IndicadorProgresso } from "../../components/cronograma/IndicadorProgresso";
import { KpisCronograma } from "../../components/cronograma/KpisCronograma";
import { Modal } from "../../components/ui/Modal";
import { IconeStatusSolicitacao, TOM_STATUS_SOLICITACAO, StatusSolicitacao } from "../../components/ui/IconeStatusSolicitacao";

const toneBadge: Record<string, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  neutral: "bg-muted/15 text-muted",
};

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

// Tooltip do indicador de status (ver bloco dos 3 checkboxes abaixo) — mesmo texto que
// contaria em Aprovações, resumido pra um hover.
function tituloUltimaSolicitacao(s: {
  status: StatusSolicitacao;
  valorSolicitado: boolean;
  solicitanteNome: string;
  criadoEm: string;
  decididoEm: string | null;
  decisorNome: string | null;
  observacaoDecisao: string | null;
}): string {
  const acao = s.valorSolicitado ? "ligar" : "desligar";
  if (s.status === "pendente") {
    return `${s.solicitanteNome} pediu para ${acao} em ${dateTimeFormatter.format(new Date(s.criadoEm))} — decida em Aprovações.`;
  }
  const quando = s.decididoEm ? dateTimeFormatter.format(new Date(s.decididoEm)) : "—";
  const desfecho = s.status === "aprovada" ? "aprovou" : "reprovou";
  const observacao = s.observacaoDecisao ? ` — "${s.observacaoDecisao}"` : "";
  return `${s.decisorNome ?? "Alguém"} ${desfecho} o pedido de ${s.solicitanteNome} para ${acao}, em ${quando}${observacao}`;
}

// Cronograma exclusivo da proposta — editor de EAP (WBS) em árvore. Todos os itens da
// proposta entram como âncora fixa da lista (vêm do Senior, nunca criados/excluídos
// aqui); pastas organizacionais e atividades-folha ficam por conta do Líder Técnico.
export function CronogramaProposta() {
  const { codemp, codpro } = useParams<{ codemp: string; codpro: string }>();
  const navigate = useNavigate();
  const {
    proposta,
    nos,
    loading,
    erro,
    recarregar,
    atualizarNo,
    criarNo,
    excluirNo,
    duplicarNo,
    moverItem,
    atualizarBloqueiaExcedenteEstrutura,
    atualizarConfigApontamentoProposta,
    solicitarConfigProposta,
    atualizarConfigApontamentoAlocacao,
    atualizarHorasExcedentesAlocacao,
    sincronizarAlocacao,
    acompanharSincronizacaoAlocacao,
  } = useCronograma(codemp, codpro);
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [erroConfig, setErroConfig] = useState<string | null>(null);

  async function onMudarBloqueiaExcedente(bloqueia: boolean) {
    setSalvandoConfig(true);
    setErroConfig(null);
    try {
      await atualizarBloqueiaExcedenteEstrutura(bloqueia);
    } catch (err) {
      setErroConfig((err as Error).message);
    } finally {
      setSalvandoConfig(false);
    }
  }

  // Mesmo padrão acima, pros dois toggles novos de bloqueio de apontamento/excedente da
  // proposta inteira — ver useCronograma/atualizarConfigApontamentoProposta.
  async function onMudarConfigApontamento(patch: Partial<{ bloqueiaApontamento: boolean; bloqueiaExcedente: boolean }>) {
    setSalvandoConfig(true);
    setErroConfig(null);
    try {
      await atualizarConfigApontamentoProposta(patch);
    } catch (err) {
      setErroConfig((err as Error).message);
    } finally {
      setSalvandoConfig(false);
    }
  }

  // Quem NÃO tem alçada (podeAprovarConfiguracao) não alterna o checkbox: abre este modal,
  // justifica, e o clique vira um pedido pra admin/gestor do Comercial/gestor da Diretoria
  // decidir em /projetos/aprovacoes.
  const [pedido, setPedido] = useState<{ campo: string; rotulo: string; valorSolicitado: boolean } | null>(null);
  const [motivoPedido, setMotivoPedido] = useState("");
  const [enviandoPedido, setEnviandoPedido] = useState(false);
  const [erroPedido, setErroPedido] = useState<string | null>(null);

  function abrirPedido(campo: string, rotulo: string, valorSolicitado: boolean) {
    setPedido({ campo, rotulo, valorSolicitado });
    setMotivoPedido("");
    setErroPedido(null);
  }

  async function enviarPedido() {
    if (!pedido) return;
    if (motivoPedido.trim() === "") {
      setErroPedido("Descreva o motivo — é o que o aprovador lê pra decidir.");
      return;
    }
    setEnviandoPedido(true);
    setErroPedido(null);
    try {
      await solicitarConfigProposta(pedido.campo, pedido.valorSolicitado, motivoPedido.trim());
      setPedido(null);
    } catch (err) {
      setErroPedido((err as Error).message);
    } finally {
      setEnviandoPedido(false);
    }
  }

  // Última solicitação de um campo, qualquer status — alimenta o indicador visual
  // (aguardando/aprovado/reprovado, ver IconeStatusSolicitacao) ao lado de cada checkbox.
  function ultimaSolicitacaoDoCampo(campo: string) {
    return proposta?.solicitacoesConfigPorCampo.find((s) => s.campo === campo) ?? null;
  }

  // Pedido ainda não decidido pra este campo: trava o checkbox pros DOIS perfis — o caminho
  // de mudar passa a ser decidir o pedido em Aprovações (senão a decisão aplicaria de novo,
  // em cima de um valor já alterado por fora).
  function pendenteDoCampo(campo: string) {
    const ultima = ultimaSolicitacaoDoCampo(campo);
    return ultima?.status === "pendente" ? ultima : null;
  }

  // "Bloquear apontamentos" não passa por aprovação (03/09/2026, a pedido do Vitor): não
  // impacta orçamento, é decisão do próprio gestor da área — muda direto sempre que a pessoa
  // já gerencia a proposta (mesmo bloco `proposta.podeGerenciarProposta` que envolve os 3
  // checkboxes). As outras duas alternam direto só pra quem tem alçada de aprovar; senão
  // abrem o pedido.
  function onAlternarFlag(campo: string, rotulo: string, valor: boolean) {
    if (campo === "bloqueiaApontamento" || proposta?.podeAprovarConfiguracao) {
      if (campo === "bloqueiaExcedenteEstrutura") onMudarBloqueiaExcedente(valor);
      else onMudarConfigApontamento({ [campo]: valor } as Partial<{ bloqueiaApontamento: boolean; bloqueiaExcedente: boolean }>);
      return;
    }
    abrirPedido(campo, rotulo, valor);
  }

  const orcamentoTotal = useMemo(() => somarOrcamentos(nos.filter((n) => n.tipo === "item"), agregarHoras(nos)), [nos]);

  // Avanço da proposta = Realizado sobre ORÇADO (o contratado), não sobre o Alocado.
  // Antes era sobre o alocado, o que respondia "quanto do planejado já foi feito" e podia
  // marcar 100% com metade do contrato ainda por distribuir. Sobre o orçado ele responde
  // "quanto do contrato já foi consumido", que é a leitura que os KPIs logo abaixo dão.
  //
  // `consumoReal` já vem de somarOrcamentos com guarda contra divisão por zero, e a cor
  // sai do mesmo tomConsumo do card do Quadro — azul, âmbar a partir de 80%, vermelho
  // acima de 100%.
  const tomAvanco = tomConsumo(orcamentoTotal.consumoReal);
  // Largura de dígitos de hora usada por TODA a tela (árvore, drawer, rodapé) — calculada
  // uma vez aqui a partir do total da proposta (ver larguraHorasProposta) e propagada por
  // prop, pra que os números de horas fiquem alinhados entre item/pasta/atividade
  // independente do nível ou do tamanho de cada valor individual.
  const larguraHoras = useMemo(() => larguraHorasProposta(orcamentoTotal), [orcamentoTotal]);

  return (
    <div>
      <button onClick={() => navigate(-1)} className="text-sm text-primary hover:underline">
        ← Voltar
      </button>

      {proposta && (
        <div className="mb-4 mt-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">
            Proposta {proposta.codpro} · Projeto {proposta.numprj}
          </p>
          <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex flex-wrap items-center gap-2 font-display text-2xl font-bold text-foreground">
                {proposta.cliente}
                <span className={`rounded-full px-2 py-0.5 font-mono text-xs font-medium ${toneBadge[proposta.sitproTone]}`}>
                  {proposta.sitproLabel}
                </span>
              </p>
            </div>
            <div className="flex-none text-right">
              <p className={`font-mono text-2xl font-semibold tabular-nums ${tomAvanco.texto || "text-foreground"}`}>
                {Math.round(orcamentoTotal.consumoReal * 100)}%
              </p>
              <p className="font-mono text-[12px] tabular-nums text-muted">
                {formatHorasCompacto(orcamentoTotal.horasRealizadas, larguraHoras)} /{" "}
                {formatHorasCompacto(orcamentoTotal.horasContratadas, larguraHoras)}
              </p>
            </div>
          </div>
          <IndicadorProgresso avanco={orcamentoTotal.consumoReal} cor={tomAvanco.barra} alturaPx={4} className="mt-3" />

          {/* Só quem gerencia a proposta decide essa regra — desliga o bypass "Salvar mesmo
              excedendo" da edição de duração (DrawerAtividade). horasExcedentes continua
              funcionando normal, é um canal à parte (autoriza estourar, não some daqui). */}
          {proposta.podeGerenciarProposta && (
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              {[
                {
                  campo: "bloqueiaExcedenteEstrutura",
                  valor: proposta.bloqueiaExcedenteEstrutura,
                  rotulo: 'Travar horas acima do saldo do item na estrutura (sem "salvar mesmo excedendo")',
                },
                { campo: "bloqueiaApontamento", valor: proposta.bloqueiaApontamento, rotulo: "Bloquear apontamentos nesta proposta" },
                { campo: "bloqueiaExcedente", valor: proposta.bloqueiaExcedente, rotulo: "Bloquear horas excedentes nesta proposta" },
              ].map(({ campo, valor, rotulo }) => {
                const pendenteAqui = pendenteDoCampo(campo);
                const ultima = ultimaSolicitacaoDoCampo(campo);
                return (
                  <label key={campo} className="flex items-center gap-2 text-sm text-muted">
                    <input
                      type="checkbox"
                      checked={valor}
                      disabled={salvandoConfig || pendenteAqui != null}
                      onChange={(e) => onAlternarFlag(campo, rotulo, e.target.checked)}
                    />
                    {rotulo}
                    {/* Mesmo padrão do badge de integração ERP na árvore (LinhaNo.tsx) —
                        círculo colorido pelo tom + ícone, hover explica o resto. Cobre os
                        3 desfechos: pendente trava o checkbox (acima); aprovada/reprovada
                        só ilustra o que aconteceu da última vez que alguém pediu isto. */}
                    {ultima && (
                      <span
                        className={`inline-flex h-4 w-4 flex-none items-center justify-center rounded-full ${toneBadge[TOM_STATUS_SOLICITACAO[ultima.status]]}`}
                        title={tituloUltimaSolicitacao(ultima)}
                      >
                        <IconeStatusSolicitacao status={ultima.status} />
                      </span>
                    )}
                  </label>
                );
              })}
              {!proposta.podeAprovarConfiguracao && (
                <p className="basis-full text-[11.5px] text-muted">
                  "Bloquear apontamentos" muda direto. As outras duas dependem de aprovação de admin, gestor do Comercial ou da
                  Diretoria — o clique nelas abre um pedido.
                </p>
              )}
              {erroConfig && <p className="text-[12px] text-destructive">{erroConfig}</p>}
            </div>
          )}
        </div>
      )}

      {/* Placar antes da árvore: é o resumo que responde "como está a proposta" e tem que
          estar visível na abertura, sem depender de rolar até o fim de uma EAP longa. */}
      {!loading && !erro && nos.some((n) => n.tipo === "item") && (
        <KpisCronograma totais={orcamentoTotal} larguraHoras={larguraHoras} />
      )}

      <ArvoreCronograma
        projetoId={`${codemp}-${codpro}`}
        codemp={codemp ?? ""}
        codpro={codpro ?? ""}
        nos={nos}
        loading={loading}
        erro={erro}
        onTentarNovamente={recarregar}
        atualizarNo={atualizarNo}
        criarNo={criarNo}
        excluirNo={excluirNo}
        duplicarNo={duplicarNo}
        moverItem={moverItem}
        podeGerenciarProposta={proposta?.podeGerenciarProposta ?? false}
        larguraHoras={larguraHoras}
        bloqueiaExcedenteEstrutura={proposta?.bloqueiaExcedenteEstrutura ?? false}
        sincronizarAlocacao={sincronizarAlocacao}
        acompanharSincronizacaoAlocacao={acompanharSincronizacaoAlocacao}
        atualizarConfigApontamentoAlocacao={atualizarConfigApontamentoAlocacao}
        atualizarHorasExcedentesAlocacao={atualizarHorasExcedentesAlocacao}
      />

      {/* fecharPorFora={false}: o modal pede uma decisão escrita, e sair sem querer perderia
          o motivo já digitado (ver comentário do próprio componente). */}
      <Modal
        open={pedido != null}
        onClose={() => setPedido(null)}
        title="Solicitar mudança de configuração"
        subtitulo={pedido ? `${pedido.valorSolicitado ? "Ligar" : "Desligar"}: ${pedido.rotulo}` : undefined}
        fecharPorFora={false}
      >
        <div className="space-y-3">
          <p className="text-[12.5px] text-muted">
            O pedido vai para admin, gestor do Comercial ou da Diretoria decidir em Aprovações. A configuração só muda
            depois da aprovação.
          </p>
          <textarea
            autoFocus
            value={motivoPedido}
            onChange={(e) => setMotivoPedido(e.target.value)}
            rows={3}
            placeholder="Por que esta mudança é necessária?"
            className="w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {erroPedido && <p className="text-[12px] text-destructive">{erroPedido}</p>}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setPedido(null)}
              disabled={enviandoPedido}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={enviarPedido}
              disabled={enviandoPedido}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {enviandoPedido ? "Enviando..." : "Enviar solicitação"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
