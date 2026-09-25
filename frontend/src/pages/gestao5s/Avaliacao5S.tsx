import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BotoesNota } from "../../components/gestao5s/BotoesNota";
import { UploadFotos } from "../../components/gestao5s/UploadFotos";
import { Miniatura } from "../../components/gestao5s/Miniatura";
import { Visualizador } from "../../components/gestao5s/Visualizador";
import { classeBotaoPerigo, classeBotaoPrimario, classeBotaoSecundario, classeCampo, classeRotulo } from "../../components/gestao5s/campos";
import { Skeleton } from "../../components/ui/Skeleton";
import { useToast } from "../../components/ui/Toast";
import { cn } from "../../lib/cn";
import { mensagemDeErro } from "../../utils/gestao5s";
import {
  CELULA_TOM,
  ImagemRef,
  Percentuais,
  SENSOS,
  Senso,
  formatarDiaIso,
  formatarPerc,
  tomDaNota,
} from "../../utils/gestao5s";

interface Resposta {
  id: number;
  senso: Senso;
  texto: string;
  nota: number | null;
  naoSeAplica: boolean;
  inconsistencia: string | null;
  complemento: string | null;
  imagens: ImagemRef[];
}

interface BlocoSenso {
  senso: Senso;
  observacoes: string | null;
  melhorias: string | null;
  pontosAtencao: string | null;
  informacoes: string | null;
  imagens: ImagemRef[];
}

interface ObservacaoEquipe {
  id: number;
  areaNome: string;
  dataOcorrido: string;
  texto: string;
  autorNome: string | null;
  imagens: ImagemRef[];
}

interface Detalhe {
  id: number;
  titulo: string;
  areaNome: string;
  areaTipo: string;
  avaliadorNome: string | null;
  data: string;
  status: "em_andamento" | "finalizada";
  percentuais: Percentuais;
  pode: { editar: boolean; finalizar: boolean; reabrir: boolean; excluir: boolean };
  respostas: Resposta[];
  sensos: BlocoSenso[];
  observacoesEquipe: ObservacaoEquipe[];
  // Avaliação de ambiente aberta por uma área agrupadora aponta o pai; o pai lista as filhas.
  pai: { id: number; titulo: string } | null;
  filhas: {
    id: number;
    titulo: string;
    areaNome: string;
    status: "em_andamento" | "finalizada";
    percentuais: Percentuais;
    respondidas: number;
    total: number;
  }[];
}

const CAMPOS_BLOCO: { chave: "observacoes" | "melhorias" | "pontosAtencao" | "informacoes"; rotulo: string }[] = [
  { chave: "observacoes", rotulo: "Observações" },
  { chave: "melhorias", rotulo: "Possíveis melhorias" },
  { chave: "pontosAtencao", rotulo: "Pontos de atenção" },
  { chave: "informacoes", rotulo: "Informações adicionais" },
];

// Questionário e detalhe de uma avaliação 5S. Mobile-first: um senso por vez, botões de nota
// grandes, salvamento automático a cada resposta e barra de resultado fixa no rodapé. Sem permissão
// de edição (líder, ou avaliação finalizada) a mesma tela vira leitura.
export function Avaliacao5S() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { mostrar } = useToast();
  const [av, setAv] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sensoAtivo, setSensoAtivo] = useState<Senso>("seiri");
  const [foto, setFoto] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);

  const carregar = useCallback(() => {
    return axios
      .get<Detalhe>(`/api/5s/avaliacoes/${id}`)
      .then(({ data }) => {
        setAv(data);
        setErro(null);
      })
      .catch((err) => setErro(mensagemDeErro(err, "Falha ao carregar a avaliação")));
  }, [id]);

  // Ir de uma avaliação pra outra (ex.: de uma área agrupadora pra uma de suas áreas) só troca o
  // `id` da rota: o React reaproveita este componente e o estado da tela anterior sobreviveria.
  // Cada avaliação começa sempre no primeiro senso (Seiri), sem herdar o senso, a foto ou os
  // dados da anterior. Declarado ANTES do efeito de carga pra rodar primeiro.
  useEffect(() => {
    setSensoAtivo("seiri");
    setFoto(null);
    setAv(null);
    setErro(null);
  }, [id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const editar = av?.pode.editar ?? false;

  const resumoPorSenso = useMemo(() => {
    const mapa = {} as Record<Senso, { respondidas: number; total: number }>;
    for (const s of SENSOS) mapa[s.chave] = { respondidas: 0, total: 0 };
    for (const r of av?.respostas ?? []) {
      mapa[r.senso].total += 1;
      if (r.nota != null || r.naoSeAplica) mapa[r.senso].respondidas += 1;
    }
    return mapa;
  }, [av]);

  const totalRespondidas = Object.values(resumoPorSenso).reduce((a, s) => a + s.respondidas, 0);
  const total = Object.values(resumoPorSenso).reduce((a, s) => a + s.total, 0);

  function atualizarLocal(respostaId: number, patch: Partial<Resposta>) {
    setAv((atual) => (atual ? { ...atual, respostas: atual.respostas.map((r) => (r.id === respostaId ? { ...r, ...patch } : r)) } : atual));
  }

  async function salvarResposta(r: Resposta, patch: Partial<Pick<Resposta, "nota" | "naoSeAplica" | "inconsistencia" | "complemento">>) {
    atualizarLocal(r.id, patch);
    try {
      const { data } = await axios.put<{ percentuais: Percentuais }>(`/api/5s/avaliacoes/${id}/respostas/${r.id}`, patch);
      setAv((atual) => (atual ? { ...atual, percentuais: data.percentuais } : atual));
    } catch (err) {
      mostrar(mensagemDeErro(err, "Não foi possível salvar a resposta"), "destructive");
      carregar();
    }
  }

  function atualizarBloco(senso: Senso, patch: Partial<BlocoSenso>) {
    setAv((atual) => (atual ? { ...atual, sensos: atual.sensos.map((b) => (b.senso === senso ? { ...b, ...patch } : b)) } : atual));
  }

  async function salvarBloco(senso: Senso, campo: string, valor: string | null) {
    try {
      await axios.put(`/api/5s/avaliacoes/${id}/sensos/${senso}`, { [campo]: valor });
    } catch (err) {
      mostrar(mensagemDeErro(err, "Não foi possível salvar o texto"), "destructive");
    }
  }

  async function acao(caminho: "finalizar" | "reabrir", sucesso: string) {
    setProcessando(true);
    try {
      await axios.post(`/api/5s/avaliacoes/${id}/${caminho}`);
      mostrar(sucesso, "success");
      await carregar();
    } catch (err) {
      mostrar(mensagemDeErro(err, "Não foi possível concluir a ação"), "destructive");
    } finally {
      setProcessando(false);
    }
  }

  async function excluir() {
    if (!window.confirm("Excluir esta avaliação em andamento? Esta ação não pode ser desfeita.")) return;
    setProcessando(true);
    try {
      await axios.delete(`/api/5s/avaliacoes/${id}`);
      mostrar("Avaliação excluída", "success");
      navigate("/5s/avaliacoes");
    } catch (err) {
      mostrar(mensagemDeErro(err, "Não foi possível excluir"), "destructive");
      setProcessando(false);
    }
  }

  function finalizar() {
    if (totalRespondidas < total) {
      mostrar(`Faltam ${total - totalRespondidas} pergunta(s) sem resposta (use NA quando não se aplicar)`, "warning");
      return;
    }
    if (window.confirm("Finalizar a avaliação? Depois disso ela entra nos resultados e no ranking.")) acao("finalizar", "Avaliação finalizada");
  }

  if (erro) {
    return (
      <div>
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{erro}</p>
        <Link to="/5s/avaliacoes" className="mt-4 inline-block text-sm text-primary hover:underline">
          ← Voltar às avaliações
        </Link>
      </div>
    );
  }
  if (!av) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // Avaliação-pai de uma área agrupadora: não tem perguntas próprias. Mostra o resultado acumulado dos
  // ambientes (soma das notas / (5 × perguntas), como a aba Comum da planilha) e um cartão por
  // ambiente, que abre o questionário dele.
  if (av.filhas.length > 0) {
    const finalizadas = av.filhas.filter((f) => f.status === "finalizada").length;
    return (
      <div className="pb-24">
        <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão 5S · Avaliação</p>
        <h1 className="font-display text-xl font-bold text-foreground sm:text-2xl">{av.titulo}</h1>
        <p className="mb-4 mt-1 text-sm text-muted">
          {formatarDiaIso(av.data)} · Avaliador: {av.avaliadorNome ?? "—"} · {finalizadas}/{av.filhas.length} ambientes finalizados ·{" "}
          <span className={av.status === "em_andamento" ? "text-warning" : "text-success"}>{av.status === "em_andamento" ? "Em andamento" : "Finalizada"}</span>
        </p>

        <section className="mb-6 rounded-lg border border-border bg-surface p-4 shadow-sm">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted">Resultado acumulado dos ambientes</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {SENSOS.map((s) => (
              <div key={s.chave} className="rounded-md border border-border/60 p-2 text-center">
                <p className="text-[11px] text-muted">{s.curto}</p>
                <p className={cn("mt-1 inline-block rounded px-1.5 py-0.5 font-mono text-sm tabular-nums", CELULA_TOM[tomDaNota(av.percentuais.porSenso[s.chave])])}>{formatarPerc(av.percentuais.porSenso[s.chave])}</p>
              </div>
            ))}
            <div className="rounded-md border border-border p-2 text-center">
              <p className="text-[11px] font-semibold text-foreground">Geral</p>
              <p className={cn("mt-1 inline-block rounded px-1.5 py-0.5 font-mono text-sm font-bold tabular-nums", CELULA_TOM[tomDaNota(av.percentuais.geral)])}>{formatarPerc(av.percentuais.geral, 1)}</p>
            </div>
          </div>
        </section>

        <h2 className="mb-2 font-display text-lg font-bold text-foreground">Ambientes</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {av.filhas.map((f) => (
            <Link key={f.id} to={`/5s/avaliacoes/${f.id}`} className="block rounded-lg border border-border bg-surface p-3 transition hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">{f.areaNome}</span>
                <span className={cn("rounded px-1.5 py-0.5 font-mono text-xs tabular-nums", CELULA_TOM[tomDaNota(f.percentuais.geral)])}>{formatarPerc(f.percentuais.geral)}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${f.total ? (f.respondidas / f.total) * 100 : 0}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {f.respondidas}/{f.total} respondidas · <span className={f.status === "finalizada" ? "text-success" : "text-warning"}>{f.status === "finalizada" ? "Finalizado" : "Em andamento"}</span>
              </p>
            </Link>
          ))}
        </div>

        {av.observacoesEquipe.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-2 font-display text-lg font-bold text-foreground">Observações da equipe no mês</h2>
            <div className="space-y-2">
              {av.observacoesEquipe.map((o) => (
                <div key={o.id} className="rounded-lg border border-border bg-surface p-3">
                  <p className="text-[11px] text-muted">
                    {formatarDiaIso(o.dataOcorrido)} · {o.areaNome} · {o.autorNome ?? "—"}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{o.texto}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 py-2.5 backdrop-blur lg:left-60">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <p className="text-[12px] text-muted">Cada ambiente é finalizado na própria avaliação; a rodada fecha quando todos estiverem finalizados.</p>
            <div className="flex flex-none items-center gap-2">
              {av.pode.excluir && (
                <button type="button" disabled={processando} onClick={excluir} className={classeBotaoPerigo}>
                  Excluir rodada
                </button>
              )}
              <Link to="/5s/avaliacoes" className={classeBotaoSecundario}>
                Voltar
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const senso = SENSOS.find((s) => s.chave === sensoAtivo)!;
  const indice = SENSOS.findIndex((s) => s.chave === sensoAtivo);
  const perguntas = av.respostas.filter((r) => r.senso === sensoAtivo);
  const bloco = av.sensos.find((b) => b.senso === sensoAtivo)!;
  const emAndamento = av.status === "em_andamento";

  return (
    <div className="pb-24">
      {av.pai && (
        <Link to={`/5s/avaliacoes/${av.pai.id}`} className="mb-2 inline-block text-sm text-primary hover:underline">
          ← Parte de: {av.pai.titulo}
        </Link>
      )}
      <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão 5S · Avaliação</p>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-bold text-foreground sm:text-2xl">{av.titulo}</h1>
          <p className="mt-1 text-sm text-muted">
            {formatarDiaIso(av.data)} · Avaliador: {av.avaliadorNome ?? "—"} ·{" "}
            <span className={emAndamento ? "text-warning" : "text-success"}>{emAndamento ? "Em andamento" : "Finalizada"}</span>
          </p>
        </div>
        {!emAndamento && av.pode.reabrir && (
          <button type="button" disabled={processando} onClick={() => acao("reabrir", "Avaliação reaberta")} className={classeBotaoSecundario}>
            Reabrir para edição
          </button>
        )}
      </div>

      {/* Abas dos 5 sensos — rolam na horizontal no celular. */}
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="tablist">
        {SENSOS.map((s) => {
          const ativo = s.chave === sensoAtivo;
          const r = resumoPorSenso[s.chave];
          const perc = av.percentuais.porSenso[s.chave];
          return (
            <button
              key={s.chave}
              type="button"
              role="tab"
              aria-selected={ativo}
              onClick={() => setSensoAtivo(s.chave)}
              className={cn(
                "flex min-h-11 flex-none flex-col items-start rounded-md border px-3 py-1.5 text-left transition",
                ativo ? "border-primary bg-primary/10" : "border-border bg-surface hover:bg-surface-2"
              )}
            >
              <span className={cn("text-sm font-semibold", ativo ? "text-foreground" : "text-muted")}>{s.nome}</span>
              <span className="text-[11px] text-muted">
                {r.respondidas}/{r.total} · {formatarPerc(perc)}
              </span>
            </button>
          );
        })}
      </div>

      <h2 className="mb-3 font-display text-lg font-bold text-foreground">{senso.rotulo}</h2>

      {perguntas.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">Nenhuma pergunta deste senso nesta avaliação.</p>}

      <div className="space-y-3">
        {perguntas.map((r, i) => (
          <PerguntaCard
            key={r.id}
            numero={i + 1}
            r={r}
            avaliacaoId={av.id}
            editar={editar}
            onLocal={(patch) => atualizarLocal(r.id, patch)}
            onSalvar={(patch) => salvarResposta(r, patch)}
            onRecarregar={carregar}
            onAbrirFoto={setFoto}
          />
        ))}
      </div>

      {/* Bloco de fechamento do senso. */}
      {(editar || CAMPOS_BLOCO.some((c) => bloco[c.chave]) || bloco.imagens.length > 0) && (
        <section className="mt-6 rounded-lg border border-border bg-surface p-4 shadow-sm">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted">Fechamento de {senso.nome}</p>
          <div className="space-y-3">
            {CAMPOS_BLOCO.map((c) =>
              editar ? (
                <div key={c.chave}>
                  <label className={classeRotulo}>{c.rotulo}</label>
                  <textarea
                    rows={2}
                    className={classeCampo}
                    value={bloco[c.chave] ?? ""}
                    onChange={(e) => atualizarBloco(sensoAtivo, { [c.chave]: e.target.value })}
                    onBlur={(e) => salvarBloco(sensoAtivo, c.chave, e.target.value.trim() || null)}
                  />
                </div>
              ) : bloco[c.chave] ? (
                <div key={c.chave}>
                  <p className={classeRotulo}>{c.rotulo}</p>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{bloco[c.chave]}</p>
                </div>
              ) : null
            )}
            <UploadFotos
              imagens={bloco.imagens}
              urlUpload={`/api/5s/avaliacoes/${av.id}/imagens`}
              campos={{ senso: sensoAtivo }}
              podeEditar={editar}
              onAlterado={carregar}
              onAbrir={setFoto}
            />
          </div>
        </section>
      )}

      <div className="mt-4 flex justify-between gap-2">
        <button type="button" disabled={indice === 0} onClick={() => setSensoAtivo(SENSOS[indice - 1].chave)} className={`${classeBotaoSecundario} min-h-11`}>
          ← {indice > 0 ? SENSOS[indice - 1].nome : "Anterior"}
        </button>
        <button type="button" disabled={indice === SENSOS.length - 1} onClick={() => setSensoAtivo(SENSOS[indice + 1].chave)} className={`${classeBotaoSecundario} min-h-11`}>
          {indice < SENSOS.length - 1 ? SENSOS[indice + 1].nome : "Próximo"} →
        </button>
      </div>

      {av.observacoesEquipe.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 font-display text-lg font-bold text-foreground">Observações da equipe no mês</h2>
          <div className="space-y-2">
            {av.observacoesEquipe.map((o) => (
              <div key={o.id} className="rounded-lg border border-border bg-surface p-3">
                <p className="text-[11px] text-muted">
                  {formatarDiaIso(o.dataOcorrido)} · {o.areaNome} · {o.autorNome ?? "—"}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{o.texto}</p>
                {o.imagens.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {o.imagens.map((img) => (
                      <Miniatura key={img.id} id={img.id} nome={img.nomeArquivo} onAbrir={setFoto} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Barra de resultado fixa: o % aparece em tempo real enquanto se responde. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 py-2.5 backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] text-muted">
              {totalRespondidas}/{total} respondidas
            </p>
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              Geral
              <span className={cn("rounded px-1.5 py-0.5 font-mono text-sm tabular-nums", CELULA_TOM[tomDaNota(av.percentuais.geral)])}>
                {formatarPerc(av.percentuais.geral, 1)}
              </span>
            </p>
          </div>
          <div className="flex flex-none items-center gap-2">
            {av.pode.excluir && (
              <button type="button" disabled={processando} onClick={excluir} className={classeBotaoPerigo}>
                Excluir
              </button>
            )}
            {av.pode.finalizar && (
              <button type="button" disabled={processando} onClick={finalizar} className={`${classeBotaoPrimario} min-h-11`}>
                Finalizar
              </button>
            )}
            {!editar && (
              <Link to="/5s/avaliacoes" className={classeBotaoSecundario}>
                Voltar
              </Link>
            )}
          </div>
        </div>
      </div>

      <Visualizador url={foto} onFechar={() => setFoto(null)} />
    </div>
  );
}

interface PerguntaCardProps {
  numero: number;
  r: Resposta;
  avaliacaoId: number;
  editar: boolean;
  onLocal: (patch: Partial<Resposta>) => void;
  onSalvar: (patch: Partial<Pick<Resposta, "nota" | "naoSeAplica" | "inconsistencia" | "complemento">>) => void;
  onRecarregar: () => void;
  onAbrirFoto: (url: string) => void;
}

function PerguntaCard({ numero, r, avaliacaoId, editar, onLocal, onSalvar, onRecarregar, onAbrirFoto }: PerguntaCardProps) {
  const temDetalhe = !!(r.inconsistencia || r.complemento || r.imagens.length > 0);
  const [aberto, setAberto] = useState(temDetalhe);
  const respondida = r.nota != null || r.naoSeAplica;

  return (
    <div className={cn("rounded-lg border bg-surface p-3 shadow-sm sm:p-4", respondida ? "border-border" : "border-warning/50")}>
      <p className="mb-3 text-sm font-medium text-foreground">
        <span className="mr-1.5 font-mono text-xs text-muted">{numero}.</span>
        {r.texto}
      </p>

      {editar ? (
        <BotoesNota nota={r.nota} naoSeAplica={r.naoSeAplica} onChange={(v) => onSalvar(v)} />
      ) : (
        <p className="text-sm">
          <span className="text-muted">Resposta: </span>
          <span className="font-semibold text-foreground">{r.naoSeAplica ? "NA" : r.nota ?? "—"}</span>
        </p>
      )}

      {editar && (
        <button type="button" onClick={() => setAberto((v) => !v)} className="mt-3 min-h-9 text-xs font-medium text-primary hover:underline">
          {aberto ? "Ocultar inconsistência e fotos" : temDetalhe ? "Ver inconsistência e fotos" : "+ Registrar inconsistência ou foto"}
        </button>
      )}

      {(aberto || (!editar && temDetalhe)) && (
        <div className="mt-2 space-y-3">
          {editar ? (
            <>
              <div>
                <label className={classeRotulo}>Inconsistência identificada</label>
                <textarea
                  rows={2}
                  className={classeCampo}
                  value={r.inconsistencia ?? ""}
                  onChange={(e) => onLocal({ inconsistencia: e.target.value })}
                  onBlur={(e) => onSalvar({ inconsistencia: e.target.value.trim() || null })}
                />
              </div>
              <div>
                <label className={classeRotulo}>Informações complementares</label>
                <textarea
                  rows={2}
                  className={classeCampo}
                  value={r.complemento ?? ""}
                  onChange={(e) => onLocal({ complemento: e.target.value })}
                  onBlur={(e) => onSalvar({ complemento: e.target.value.trim() || null })}
                />
              </div>
            </>
          ) : (
            <>
              {r.inconsistencia && (
                <div>
                  <p className={classeRotulo}>Inconsistência</p>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{r.inconsistencia}</p>
                </div>
              )}
              {r.complemento && (
                <div>
                  <p className={classeRotulo}>Informações complementares</p>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{r.complemento}</p>
                </div>
              )}
            </>
          )}
          <UploadFotos
            imagens={r.imagens}
            urlUpload={`/api/5s/avaliacoes/${avaliacaoId}/imagens`}
            campos={{ respostaId: String(r.id) }}
            podeEditar={editar}
            onAlterado={onRecarregar}
            onAbrir={onAbrirFoto}
          />
        </div>
      )}
    </div>
  );
}

