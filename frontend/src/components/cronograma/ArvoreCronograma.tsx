import { useEffect, useMemo, useState } from "react";
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import {
  achatarArvore,
  agregarHoras,
  calcularOrcamentoItem,
  derivarStatus,
  estadoAlertaItem,
  filtrarPreservandoAncestrais,
  OrcamentoItem,
  StatusNo,
} from "../../lib/cronograma";
import { NoCronogramaCompleto, PatchNo, NovoNo } from "../../hooks/useCronograma";
import { BarraFerramentas, FiltrosCronograma } from "./BarraFerramentas";
import { LinhaNo } from "./LinhaNo";
import { LinhaNovaAtividade } from "./LinhaNovaAtividade";
import { DrawerAtividade } from "./DrawerAtividade";
import { DestinoMover } from "./MenuAcoesNo";
import { LegendaOrcamento } from "./LegendaOrcamento";

const FILTROS_VAZIOS: FiltrosCronograma = {
  status: [],
  responsaveis: [],
  somenteAtraso: false,
  somenteExcedidos: false,
  realizadoAcimaPrevisto: false,
};

function chaveExpansao(projetoId: string): string {
  return `cronograma:${projetoId}:expandido`;
}

function carregarExpansaoSalva(projetoId: string): Set<number> {
  try {
    const bruto = localStorage.getItem(chaveExpansao(projetoId));
    if (!bruto) return new Set();
    return new Set(JSON.parse(bruto) as number[]);
  } catch {
    return new Set();
  }
}

function hojeUtc(): Date {
  const agora = new Date();
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()));
}

function estaAtrasada(no: NoCronogramaCompleto, statusEfetivo: StatusNo): boolean {
  if (no.tipo !== "atividade" || !no.dataPrevistaFim || statusEfetivo === "concluida") return false;
  return new Date(no.dataPrevistaFim) < hojeUtc();
}

interface ArvoreCronogramaProps {
  projetoId: string;
  nos: NoCronogramaCompleto[];
  loading: boolean;
  erro: string | null;
  onTentarNovamente: () => void;
  atualizarNo: (id: number, patch: PatchNo) => Promise<void>;
  criarNo: (novo: NovoNo) => Promise<NoCronogramaCompleto>;
  excluirNo: (id: number) => Promise<void>;
  duplicarNo: (no: NoCronogramaCompleto) => Promise<void>;
  moverItem: (seqite: number, parentId: number | null) => Promise<void>;
  // Cria pasta raiz (agrupa itens da proposta) — ação de nível de proposta inteira, não
  // de um item específico (ver backend podeGerenciarProposta).
  podeGerenciarProposta: boolean;
  // Dígitos mínimos de hora usados por toda a árvore/drawer (ver larguraHorasProposta) —
  // calculado uma vez em CronogramaProposta a partir do total da proposta.
  larguraHoras: number;
}

export function ArvoreCronograma({
  projetoId,
  nos,
  loading,
  erro,
  onTentarNovamente,
  atualizarNo,
  criarNo,
  excluirNo,
  duplicarNo,
  moverItem,
  podeGerenciarProposta,
  larguraHoras,
}: ArvoreCronogramaProps) {
  const [expandidos, setExpandidos] = useState<Set<number>>(() => carregarExpansaoSalva(projetoId));
  const [busca, setBusca] = useState("");
  const [filtros, setFiltros] = useState<FiltrosCronograma>(FILTROS_VAZIOS);
  const [visao, setVisao] = useState<"lista" | "gantt">("lista");
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const [drawerNoId, setDrawerNoId] = useState<number | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [ghostAberto, setGhostAberto] = useState<number | null>(null);

  useEffect(() => {
    setExpandidos(carregarExpansaoSalva(projetoId));
  }, [projetoId]);

  useEffect(() => {
    localStorage.setItem(chaveExpansao(projetoId), JSON.stringify([...expandidos]));
  }, [projetoId, expandidos]);

  const achatada = useMemo(() => achatarArvore(nos), [nos]);
  const agregados = useMemo(() => agregarHoras(nos), [nos]);
  const statusPorId = useMemo(() => derivarStatus(nos), [nos]);

  const porId = useMemo(() => new Map(nos.map((n) => [n.id, n])), [nos]);
  // Chave é `number | null` (null = raiz), nunca um sentinela numérico tipo -1 — os ids
  // sintéticos dos itens virtuais já usam a faixa negativa (ver idVirtualItem), então
  // qualquer sentinela numérico correria o risco de colidir com um id de verdade.
  const filhosDe = useMemo(() => {
    const mapa = new Map<number | null, NoCronogramaCompleto[]>();
    for (const n of nos) {
      if (!mapa.has(n.parentId)) mapa.set(n.parentId, []);
      mapa.get(n.parentId)!.push(n);
    }
    return mapa;
  }, [nos]);

  const idsComFilhos = useMemo(() => new Set(nos.filter((n) => (filhosDe.get(n.id)?.length ?? 0) > 0).map((n) => n.id)), [nos, filhosDe]);
  const tudoExpandido = idsComFilhos.size > 0 && [...idsComFilhos].every((id) => expandidos.has(id));

  // Orçamento (contratado/distribuído/realizado) — só existe pra tipo="item".
  const orcamentosPorId = useMemo(() => {
    const mapa = new Map<number, OrcamentoItem>();
    for (const n of nos) {
      if (n.tipo === "item") mapa.set(n.id, calcularOrcamentoItem(n, agregados));
    }
    return mapa;
  }, [nos, agregados]);

  // Resumo pro chip "⚠ {n} itens em alerta" da barra de ferramentas — o mais grave
  // presente (excedido > realizado acima do previsto) decide qual filtro o chip aplica.
  const resumoAlertas = useMemo(() => {
    let total = 0;
    let temExcedido = false;
    let temRealAcima = false;
    for (const orcamento of orcamentosPorId.values()) {
      const estado = estadoAlertaItem(orcamento);
      if (estado === "estouro_realizado" || estado === "estouro_distribuicao") {
        total++;
        temExcedido = true;
      } else if (estado === "real_acima_previsto") {
        total++;
        temRealAcima = true;
      }
    }
    return { total, temExcedido, temRealAcima };
  }, [orcamentosPorId]);

  // Descendentes totais (pastas + atividades), usado na confirmação de exclusão.
  const contagemDescendentesPorId = useMemo(() => {
    const contagem = new Map<number, number>();
    function contar(id: number): number {
      const existente = contagem.get(id);
      if (existente != null) return existente;
      let total = 0;
      for (const filho of filhosDe.get(id) ?? []) total += 1 + contar(filho.id);
      contagem.set(id, total);
      return total;
    }
    for (const n of nos) contar(n.id);
    return contagem;
  }, [nos, filhosDe]);

  function descendentesDe(id: number): Set<number> {
    const resultado = new Set<number>();
    function visitar(atualId: number) {
      for (const filho of filhosDe.get(atualId) ?? []) {
        resultado.add(filho.id);
        visitar(filho.id);
      }
    }
    visitar(id);
    return resultado;
  }

  function destinosPossiveisPara(no: NoCronogramaCompleto): DestinoMover[] {
    // Item: só agrupa dentro de pasta raiz (fora do escopo de qualquer seqite) — nunca
    // dentro de uma pasta ligada a outro item, nem risco de ciclo (item é sempre raiz da
    // própria subárvore).
    if (no.tipo === "item") {
      return nos
        .filter((n) => n.tipo === "pasta" && n.seqite == null && n.id !== no.parentId)
        .map((n) => ({ id: n.id, label: n.nome }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    const proibidos = descendentesDe(no.id);
    proibidos.add(no.id);
    if (no.parentId != null) proibidos.delete(no.parentId); // já está lá — não faz sentido listar o pai atual
    return nos
      .filter((n) => n.seqite === no.seqite && (n.tipo === "pasta" || n.tipo === "item") && !proibidos.has(n.id) && n.id !== no.parentId)
      .map((n) => ({ id: n.id, label: n.tipo === "item" ? `${n.nome} (raiz)` : n.nome }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  const responsaveisDisponiveis = useMemo(() => {
    const mapa = new Map<number, string>();
    for (const n of nos) {
      if (n.responsavelCodfor != null && n.responsavelNome) mapa.set(n.responsavelCodfor, n.responsavelNome);
    }
    return [...mapa.entries()].map(([codfor, nome]) => ({ codfor, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [nos]);

  const filtroAtivo =
    busca.trim() !== "" ||
    filtros.status.length > 0 ||
    filtros.responsaveis.length > 0 ||
    filtros.somenteAtraso ||
    filtros.somenteExcedidos ||
    filtros.realizadoAcimaPrevisto;

  const visiveis = useMemo(() => {
    if (!filtroAtivo) return new Set(nos.map((n) => n.id));

    // Filtro de orçamento é por ITEM (não por atividade individual) — restringe de
    // antemão quais seqites entram na conta; se nenhum dos dois estiver marcado,
    // `seqitesPermitidos` fica null e não filtra nada por aqui (comportamento de sempre).
    let seqitesPermitidos: Set<number | null> | null = null;
    if (filtros.somenteExcedidos || filtros.realizadoAcimaPrevisto) {
      seqitesPermitidos = new Set<number | null>();
      for (const n of nos) {
        if (n.tipo !== "item") continue;
        const orcamento = orcamentosPorId.get(n.id);
        if (!orcamento) continue;
        const qualificaExcedido = filtros.somenteExcedidos && (orcamento.estouroDistribuicao || orcamento.estouroRealizado);
        const qualificaRealAcima = filtros.realizadoAcimaPrevisto && orcamento.realAcimaDoPrevisto;
        if (qualificaExcedido || qualificaRealAcima) seqitesPermitidos.add(n.seqite);
      }
    }

    const buscaLower = busca.trim().toLowerCase();
    return filtrarPreservandoAncestrais(nos, (no) => {
      if (no.tipo !== "atividade") return false;
      const completo = no as NoCronogramaCompleto;
      if (seqitesPermitidos && !seqitesPermitidos.has(completo.seqite)) return false;
      if (buscaLower) {
        const bateNome = completo.nome.toLowerCase().includes(buscaLower);
        const bateResponsavel = (completo.responsavelNome ?? "").toLowerCase().includes(buscaLower);
        if (!bateNome && !bateResponsavel) return false;
      }
      if (filtros.status.length > 0 && !filtros.status.includes(statusPorId.get(no.id) ?? "nao_iniciada")) return false;
      if (filtros.responsaveis.length > 0 && (completo.responsavelCodfor == null || !filtros.responsaveis.includes(completo.responsavelCodfor))) {
        return false;
      }
      if (filtros.somenteAtraso && !estaAtrasada(completo, statusPorId.get(no.id) ?? "nao_iniciada")) return false;
      return true;
    });
  }, [nos, filtroAtivo, busca, filtros, statusPorId, orcamentosPorId]);

  function ancestraisTodosExpandidos(no: NoCronogramaCompleto): boolean {
    let atual = no.parentId != null ? porId.get(no.parentId) : undefined;
    while (atual) {
      if (!expandidos.has(atual.id)) return false;
      atual = atual.parentId != null ? porId.get(atual.parentId) : undefined;
    }
    return true;
  }

  const linhas = achatada.filter((no) => {
    if (!visiveis.has(no.id)) return false;
    if (filtroAtivo) return true;
    return ancestraisTodosExpandidos(no);
  });

  function alternarExpandir(id: number) {
    setExpandidos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  function alternarExpandirTudo() {
    setExpandidos(tudoExpandido ? new Set() : new Set(idsComFilhos));
  }

  async function renomear(no: NoCronogramaCompleto, nome: string) {
    try {
      await atualizarNo(no.id, { nome });
    } catch (err) {
      setErroAcao((err as Error).message);
    }
  }

  async function duplicar(no: NoCronogramaCompleto) {
    try {
      await duplicarNo(no);
    } catch (err) {
      setErroAcao((err as Error).message);
    }
  }

  async function moverPara(no: NoCronogramaCompleto, novoParentId: number) {
    try {
      if (no.tipo === "item") {
        await moverItem(no.seqite!, novoParentId);
      } else {
        const irmaos = filhosDe.get(novoParentId) ?? [];
        await atualizarNo(no.id, { parentId: novoParentId, ordem: irmaos.length });
      }
      setExpandidos((atual) => new Set(atual).add(novoParentId));
    } catch (err) {
      setErroAcao((err as Error).message);
    }
  }

  // "Soltar" um item de dentro da pasta raiz onde ele foi agrupado — volta a ficar
  // direto na raiz da árvore da proposta (comportamento de sempre).
  async function soltarItem(no: NoCronogramaCompleto) {
    try {
      await moverItem(no.seqite!, null);
    } catch (err) {
      setErroAcao((err as Error).message);
    }
  }

  async function adicionarDentro(no: NoCronogramaCompleto, tipo: "pasta" | "atividade") {
    if (tipo === "atividade") {
      setExpandidos((atual) => new Set(atual).add(no.id));
      setGhostAberto(no.id);
      return;
    }
    try {
      const criado = await criarNo({ seqite: no.seqite ?? undefined, tipo: "pasta", nome: "Nova pasta", parentId: no.id });
      setExpandidos((atual) => new Set(atual).add(no.id));
      setSelecionadoId(criado.id);
    } catch (err) {
      setErroAcao((err as Error).message);
    }
  }

  // Pasta raiz da proposta (sem seqite) — só serve pra agrupar itens entre si, ver
  // moverPara/moverItem pra colocar um item dentro dela.
  async function criarPastaRaiz() {
    try {
      const criado = await criarNo({ tipo: "pasta", nome: "Nova pasta", parentId: null });
      setSelecionadoId(criado.id);
    } catch (err) {
      setErroAcao((err as Error).message);
    }
  }

  async function excluir(no: NoCronogramaCompleto) {
    try {
      await excluirNo(no.id);
      setSelecionadoId((atual) => (atual === no.id ? null : atual));
    } catch (err) {
      setErroAcao((err as Error).message);
    }
  }

  async function criarAtividadeEmPasta(pasta: NoCronogramaCompleto, nome: string) {
    // Só chamado a partir da linha fantasma, que só existe pra pasta ligada a um item
    // (seqite != null) — ver condição de emissão do ghost row acima.
    await criarNo({ seqite: pasta.seqite!, tipo: "atividade", nome, parentId: pasta.id });
  }

  function indentar(no: NoCronogramaCompleto) {
    const irmaos = (filhosDe.get(no.parentId) ?? []).slice().sort((a, b) => a.ordem - b.ordem);
    const idx = irmaos.findIndex((n) => n.id === no.id);
    if (idx <= 0) return;
    const novoPai = irmaos[idx - 1];
    if (novoPai.tipo === "atividade") {
      setErroAcao("Só é possível indentar para dentro de uma pasta.");
      return;
    }
    if (no.tipo === "atividade" && novoPai.tipo === "item") {
      setErroAcao("Atividades só podem ficar dentro de uma pasta.");
      return;
    }
    const destino = filhosDe.get(novoPai.id) ?? [];
    setExpandidos((atual) => new Set(atual).add(novoPai.id));
    atualizarNo(no.id, { parentId: novoPai.id, ordem: destino.length }).catch((err) => setErroAcao((err as Error).message));
  }

  function dedentar(no: NoCronogramaCompleto) {
    const pai = no.parentId != null ? porId.get(no.parentId) : undefined;
    if (!pai || pai.tipo === "item") return;
    if (no.tipo === "atividade") {
      setErroAcao("Atividades só podem ficar dentro de uma pasta.");
      return;
    }
    const avoId = pai.parentId;
    if (avoId == null) return;
    const irmaosDestino = (filhosDe.get(avoId) ?? []).slice().sort((a, b) => a.ordem - b.ordem);
    const idxPai = irmaosDestino.findIndex((n) => n.id === pai.id);
    atualizarNo(no.id, { parentId: avoId, ordem: idxPai + 1 }).catch((err) => setErroAcao((err as Error).message));
  }

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (selecionadoId == null || drawerNoId != null) return;
      const alvo = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName)) return;
      const no = porId.get(selecionadoId);
      if (!no || no.tipo === "item") return;

      if (e.key === "Enter") {
        e.preventDefault();
        const pastaAlvo = no.tipo === "pasta" ? no : no.parentId != null ? porId.get(no.parentId) : undefined;
        if (pastaAlvo && pastaAlvo.tipo === "pasta") {
          setExpandidos((atual) => new Set(atual).add(pastaAlvo.id));
          setGhostAberto(pastaAlvo.id);
        }
      } else if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) dedentar(no);
        else indentar(no);
      } else if (e.key === "Delete") {
        e.preventDefault();
        const descendentes = contagemDescendentesPorId.get(no.id) ?? 0;
        const aviso = descendentes > 0 ? `Excluir "${no.nome}" e ${descendentes} item(ns) dentro dele?` : `Excluir "${no.nome}"?`;
        if (window.confirm(aviso)) excluir(no);
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionadoId, drawerNoId, porId, filhosDe, contagemDescendentesPorId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const dragId = Number(String(active.id).replace("no-", ""));
    const overRaw = String(over.id);
    const isTopo = overRaw.startsWith("topo-");
    const targetId = Number(overRaw.replace(isTopo ? "topo-" : "corpo-", ""));
    if (!Number.isFinite(dragId) || !Number.isFinite(targetId) || dragId === targetId) return;

    const dragNo = porId.get(dragId);
    const targetNo = porId.get(targetId);
    if (!dragNo || !targetNo) return;

    // Item: só agrupa (into) dentro de uma pasta raiz — sem reordenar (não tem `ordem`
    // própria, é sempre o Senior que define a sequência) nem soltar via drag (isso é
    // "Soltar do grupo" no menu ⋯). Ignora se caiu na zona "topo" ou "corpo" do alvo —
    // pra item as duas significam a mesma coisa (agrupar), não existe "antes/depois".
    if (dragNo.tipo === "item") {
      if (targetNo.tipo !== "pasta" || targetNo.seqite != null) {
        setErroAcao("Um item só pode ser arrastado pra dentro de uma pasta raiz.");
        return;
      }
      setErroAcao(null);
      setExpandidos((atualExp) => new Set(atualExp).add(targetNo.id));
      try {
        await moverItem(dragNo.seqite!, targetNo.id);
      } catch (err) {
        setErroAcao((err as Error).message);
      }
      return;
    }

    // Bloqueia soltar dentro de si mesmo ou de um descendente (senão a árvore vira um
    // ciclo — subiria pra sempre no laço de indentação/derivação de status).
    let atual: NoCronogramaCompleto | undefined = targetNo;
    while (atual) {
      if (atual.id === dragNo.id) {
        setErroAcao("Não é possível mover um nó para dentro dele mesmo ou de um descendente.");
        return;
      }
      atual = atual.parentId != null ? porId.get(atual.parentId) : undefined;
    }

    let novoParentId: number | null;
    let modo: "into" | "before" | "after";
    if (isTopo) {
      // `parentId == null` não significa mais "só item" — pasta raiz também vive na
      // raiz da árvore (ver EstruturaAtividade.seqite null). Só item de fato não deixa
      // reordenar por aqui (não tem `ordem` própria).
      if (targetNo.tipo === "item") return;
      novoParentId = targetNo.parentId;
      modo = "before";
    } else if (targetNo.tipo === "atividade") {
      if (targetNo.parentId == null) return;
      novoParentId = targetNo.parentId;
      modo = "after";
    } else {
      novoParentId = targetNo.id;
      modo = "into";
    }

    if (dragNo.tipo === "atividade" && (novoParentId == null || porId.get(novoParentId)?.tipo !== "pasta")) {
      setErroAcao("Atividades só podem ficar dentro de uma pasta.");
      return;
    }

    // Item nunca entra nessa renumeração — não tem `ordem` própria mutável por aqui (só
    // via "Agrupar em pasta…"/drag específico de item, ver ramo acima). Renumerar só
    // entre pasta/atividade evita tentar dar PATCH num id virtual (negativo) de item.
    const irmaosAtuais = (filhosDe.get(novoParentId) ?? [])
      .filter((n) => n.id !== dragNo.id && n.tipo !== "item")
      .slice()
      .sort((a, b) => a.ordem - b.ordem);
    let novaLista: NoCronogramaCompleto[];
    if (modo === "into") {
      novaLista = [...irmaosAtuais, dragNo];
    } else {
      const idx = irmaosAtuais.findIndex((n) => n.id === targetNo.id);
      novaLista = [...irmaosAtuais];
      novaLista.splice(modo === "before" ? idx : idx + 1, 0, dragNo);
    }

    setErroAcao(null);
    setExpandidos((atualExp) => (modo === "into" ? new Set(atualExp).add(novoParentId!) : atualExp));
    try {
      await Promise.all(
        novaLista.map((n, i) =>
          n.ordem === i && n.parentId === novoParentId ? Promise.resolve() : atualizarNo(n.id, { ordem: i, parentId: novoParentId })
        )
      );
    } catch (err) {
      setErroAcao((err as Error).message);
      onTentarNovamente();
    }
  }

  const drawerNo = drawerNoId != null ? porId.get(drawerNoId) : undefined;
  const candidatosPredecessora = useMemo(
    () => (drawerNo ? nos.filter((n) => n.tipo === "atividade" && n.seqite === drawerNo.seqite) : []),
    [drawerNo, nos]
  );
  const itemDoDrawer = useMemo(
    () => (drawerNo ? nos.find((n) => n.tipo === "item" && n.seqite === drawerNo.seqite) : undefined),
    [drawerNo, nos]
  );

  const elementos: JSX.Element[] = [];
  linhas.forEach((no, i) => {
    elementos.push(
      <LinhaNo
        key={no.id}
        no={no}
        profundidade={no.profundidade}
        temFilhos={(filhosDe.get(no.id)?.length ?? 0) > 0}
        expandido={expandidos.has(no.id)}
        statusEfetivo={statusPorId.get(no.id) ?? "nao_iniciada"}
        agregado={agregados.get(no.id) ?? { horasPrevistas: 0, horasRealizadas: 0, avanco: 0 }}
        orcamento={orcamentosPorId.get(no.id)}
        contagemDescendentes={contagemDescendentesPorId.get(no.id) ?? 0}
        selecionado={selecionadoId === no.id}
        destinosPossiveis={destinosPossiveisPara(no)}
        onToggleExpandir={() => alternarExpandir(no.id)}
        onSelecionar={() => setSelecionadoId(no.id)}
        onAbrirDrawer={() => setDrawerNoId(no.id)}
        onRenomear={(nome) => renomear(no, nome)}
        onDuplicar={() => duplicar(no)}
        onMoverPara={(parentId) => moverPara(no, parentId)}
        onSoltar={no.tipo === "item" ? () => soltarItem(no) : undefined}
        onAdicionarDentro={no.tipo !== "atividade" ? (tipo) => adicionarDentro(no, tipo) : undefined}
        onExcluir={() => excluir(no)}
        larguraHoras={larguraHoras}
      />
    );
    // Fecha (emite a linha fantasma de) toda pasta ancestral cujo último descendente
    // visível é justamente este `no` — não só quando `no` em si é a pasta (senão nunca
    // apareceria depois dos filhos, só em pastas vazias). Anda da mais funda pra mais
    // rasa, na mesma ordem em que a árvore visualmente "fecha" aquele nível.
    const proxima = linhas[i + 1];
    const profundidadeProxima = proxima ? proxima.profundidade : -1;
    let noAtual: NoCronogramaCompleto | undefined = no;
    let profundidadeAtual = no.profundidade;
    while (noAtual && profundidadeAtual >= profundidadeProxima) {
      const pastaFechando: NoCronogramaCompleto = noAtual;
      const profundidadeFechando: number = profundidadeAtual;
      if (pastaFechando.tipo === "pasta" && pastaFechando.seqite != null && expandidos.has(pastaFechando.id)) {
        elementos.push(
          <LinhaNovaAtividade
            key={`ghost-${pastaFechando.id}`}
            pastaNome={pastaFechando.nome}
            profundidade={profundidadeFechando}
            onCriar={(nome) => criarAtividadeEmPasta(pastaFechando, nome)}
            abrirAutomaticamente={ghostAberto === pastaFechando.id}
            onAbriu={() => setGhostAberto(null)}
          />
        );
      }
      noAtual = pastaFechando.parentId != null ? porId.get(pastaFechando.parentId) : undefined;
      profundidadeAtual -= 1;
    }
  });

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <BarraFerramentas
          buscaInicial={busca}
          onBuscaChange={setBusca}
          tudoExpandido={tudoExpandido}
          onToggleExpandirTudo={alternarExpandirTudo}
          responsaveisDisponiveis={responsaveisDisponiveis}
          filtros={filtros}
          onFiltrosChange={setFiltros}
          visao={visao}
          onVisaoChange={setVisao}
          onNovaPastaRaiz={podeGerenciarProposta ? criarPastaRaiz : undefined}
          resumoAlertas={resumoAlertas}
        />

        {(erro || erroAcao) && (
          <div className="flex items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2.5">
            <p className="text-sm text-destructive">{erro ?? erroAcao}</p>
            <button
              onClick={() => {
                setErroAcao(null);
                if (erro) onTentarNovamente();
              }}
              className="flex-none rounded-md border border-destructive/40 px-3 py-1 text-[12.5px] text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {erro ? "Tentar novamente" : "Ok"}
            </button>
          </div>
        )}

        {visao === "gantt" ? (
          <div className="p-10 text-center text-sm text-muted">Visão Gantt em breve.</div>
        ) : loading ? (
          <div className="space-y-0">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex h-9 items-center gap-2 border-b border-border/50 px-4">
                <div className="h-3 w-3 animate-pulse rounded-full bg-surface-2" />
                <div className="h-3 flex-1 max-w-[240px] animate-pulse rounded bg-surface-2" />
                <div className="ml-auto h-3 w-16 animate-pulse rounded bg-surface-2" />
              </div>
            ))}
          </div>
        ) : (
          <div>
            <LegendaOrcamento className="border-b border-border px-4 py-2" />
            <div className="flex items-center gap-2 border-b border-border bg-surface-2 py-2 pl-[14px] pr-3">
              <span className="w-4 flex-none" />
              <span className="flex-1 font-mono text-[11px] font-medium uppercase tracking-wider text-muted">Estrutura</span>
              <span className="hidden w-[22px] flex-none md:block" />
              <span
                className="hidden flex-none text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted md:block"
                style={{ width: `${2 * (larguraHoras + 3) + 4}ch` }}
              >
                Horas
              </span>
              <span className="hidden w-[110px] flex-none text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted md:block">
                Período
              </span>
              <span className="w-[90px] flex-none text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">Status</span>
              <span className="w-6 flex-none" />
            </div>

            {linhas.length === 0 ? <p className="p-8 text-center text-sm text-muted">Nenhum resultado com os filtros atuais.</p> : elementos}
          </div>
        )}
      </div>

      {drawerNo && (
        <DrawerAtividade
          no={drawerNo}
          item={itemDoDrawer}
          porId={porId}
          agregados={agregados}
          candidatosPredecessora={candidatosPredecessora}
          onFechar={() => setDrawerNoId(null)}
          onSalvar={atualizarNo}
          larguraHoras={larguraHoras}
        />
      )}
    </DndContext>
  );
}
