import { useMemo, useState } from "react";
import { ListaServidor } from "../../../components/colunas/ListaServidor";
import type { DefColuna } from "../../../components/colunas/useColunasConfiguraveis";
import { classeBotaoPrimario } from "../../../components/gestao5s/campos";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { DetalheProcesso } from "./DetalheProcesso";
import { NovoDescontoModal } from "./NovoDescontoModal";
import {
  classeFiltro,
  fmtCompetencia,
  fmtData,
  fmtMoeda,
  Selo,
  SITUACAO_OPCOES,
  STATUS_OPCOES,
  TOM_STATUS,
  useAcessoDescontos,
  useOpcoesDescontos,
  type StatusProcesso,
} from "./comum";
import type { ProcessoDetalhe } from "./tipos";

// Gestão de Projetos › Gestão de Descontos › Lançamentos: um processo por linha (DESC-AAAA-000001). Quem administra lança, edita, cancela, quita e
// estorna; o gestor de área vê o time; o consultor vê só os próprios (o recorte é do backend: domain/descontosAcesso.ts).

interface ProcessoLista {
  id: number;
  processo: string;
  consultor: string;
  tipo: string;
  modo: string;
  valorTotal: number;
  valorParcela: number;
  qtdParcelas: number;
  vigenciaInicio: string;
  vigenciaFim: string;
  competenciaInicial: string;
  competenciaFinal: string | null;
  proximaCompetencia: string | null;
  parcelasDescontadas: number;
  parcelasPendentes: number;
  totalDescontado: number;
  saldoDevedor: number;
  status: string;
  statusCodigo: StatusProcesso;
  criadoEm: string;
  observacao: string | null;
}

const dinheiro = "font-mono text-sm tabular-nums text-foreground";
const COLUNAS: DefColuna<ProcessoLista>[] = [
  { nome: "processo", titulo: "Processo", fixa: true, largura: 150, resumos: ["contagem"], classe: "font-mono text-sm font-semibold text-primary", render: (p) => p.processo },
  { nome: "consultor", titulo: "Consultor", largura: 170, classe: "text-sm text-foreground", texto: (p) => p.consultor, render: (p) => p.consultor },
  { nome: "tipo", titulo: "Tipo de desconto", largura: 130, classe: "text-sm text-muted", texto: (p) => p.tipo, render: (p) => p.tipo },
  { nome: "modo", titulo: "Modo", ocultaPorPadrao: true, largura: 170, classe: "text-sm text-muted", texto: (p) => p.modo, render: (p) => p.modo },
  { nome: "valorTotal", titulo: "Valor total", direita: true, largura: 120, classe: dinheiro, formatarResumo: fmtMoeda, render: (p) => fmtMoeda(p.valorTotal) },
  { nome: "valorParcela", titulo: "Valor da parcela", ocultaPorPadrao: true, direita: true, largura: 120, classe: dinheiro, formatarResumo: fmtMoeda, render: (p) => fmtMoeda(p.valorParcela) },
  { nome: "qtdParcelas", titulo: "Parcelas", centro: true, largura: 80, classe: "font-mono text-sm tabular-nums text-muted", render: (p) => p.qtdParcelas },
  { nome: "vigenciaInicio", titulo: "Vigência: início", ocultaPorPadrao: true, largura: 110, classe: "font-mono text-sm text-muted", render: (p) => fmtData(p.vigenciaInicio) },
  { nome: "vigenciaFim", titulo: "Vigência: fim", ocultaPorPadrao: true, largura: 110, classe: "font-mono text-sm text-muted", render: (p) => fmtData(p.vigenciaFim) },
  { nome: "competenciaInicial", titulo: "Competência inicial", ocultaPorPadrao: true, largura: 120, classe: "font-mono text-sm text-muted", render: (p) => fmtCompetencia(p.competenciaInicial) },
  { nome: "competenciaFinal", titulo: "Competência final", ocultaPorPadrao: true, largura: 120, classe: "font-mono text-sm text-muted", render: (p) => fmtCompetencia(p.competenciaFinal) },
  { nome: "proximaCompetencia", titulo: "Próxima competência", largura: 130, classe: "font-mono text-sm text-muted", render: (p) => fmtCompetencia(p.proximaCompetencia) },
  { nome: "parcelasDescontadas", titulo: "Descontadas", centro: true, largura: 100, classe: "font-mono text-sm tabular-nums text-muted", render: (p) => p.parcelasDescontadas },
  { nome: "parcelasPendentes", titulo: "Pendentes", centro: true, largura: 90, classe: "font-mono text-sm tabular-nums text-muted", render: (p) => p.parcelasPendentes },
  { nome: "totalDescontado", titulo: "Total descontado", ocultaPorPadrao: true, direita: true, largura: 130, classe: dinheiro, formatarResumo: fmtMoeda, render: (p) => fmtMoeda(p.totalDescontado) },
  { nome: "saldoDevedor", titulo: "Saldo devedor", direita: true, largura: 120, classe: dinheiro, formatarResumo: fmtMoeda, render: (p) => fmtMoeda(p.saldoDevedor) },
  { nome: "status", titulo: "Status", largura: 160, render: (p) => <Selo texto={p.status} tone={TOM_STATUS[p.statusCodigo] ?? "neutral"} /> },
  { nome: "criadoEm", titulo: "Lançado em", ocultaPorPadrao: true, largura: 110, classe: "font-mono text-sm text-muted", render: (p) => fmtData(p.criadoEm) },
  { nome: "observacao", titulo: "Observação", ocultaPorPadrao: true, largura: 200, classe: "text-sm text-muted", texto: (p) => p.observacao, render: (p) => p.observacao ?? "—" },
];

export function DescontosLancamentos() {
  const acesso = useAcessoDescontos();
  const { consultores, tipos } = useOpcoesDescontos();

  const [codfor, setCodfor] = useState("");
  const [tipoId, setTipoId] = useState("");
  const [processoInput, setProcessoInput] = useState("");
  const processo = useDebouncedValue(processoInput, 350);
  const [status, setStatus] = useState("");
  const [situacaoParcela, setSituacaoParcela] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [vigenciaDe, setVigenciaDe] = useState("");
  const [vigenciaAte, setVigenciaAte] = useState("");
  const [lancamentoDe, setLancamentoDe] = useState("");
  const [lancamentoAte, setLancamentoAte] = useState("");

  const [recarga, setRecarga] = useState(0);
  const [editando, setEditando] = useState<ProcessoDetalhe | "novo" | null>(null);

  const params = useMemo(
    () => ({
      codfor: codfor || undefined,
      tipoId: tipoId || undefined,
      processo: processo || undefined,
      status: status || undefined,
      situacaoParcela: situacaoParcela || undefined,
      competencia: competencia || undefined,
      vigenciaDe: vigenciaDe || undefined,
      vigenciaAte: vigenciaAte || undefined,
      lancamentoDe: lancamentoDe || undefined,
      lancamentoAte: lancamentoAte || undefined,
    }),
    [codfor, tipoId, processo, status, situacaoParcela, competencia, vigenciaDe, vigenciaAte, lancamentoDe, lancamentoAte]
  );
  const temFiltro = Object.values(params).some(Boolean);
  function limpar() {
    setCodfor("");
    setTipoId("");
    setProcessoInput("");
    setStatus("");
    setSituacaoParcela("");
    setCompetencia("");
    setVigenciaDe("");
    setVigenciaAte("");
    setLancamentoDe("");
    setLancamentoAte("");
  }

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão de Projetos · Gestão de Descontos</p>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Lançamentos de descontos</h1>
          <p className="mt-1 text-sm text-muted">
            Descontos abatidos da nota dos consultores. Cada lançamento é um processo independente, com parcelas por competência.
          </p>
        </div>
        {acesso?.administra && (
          <button type="button" onClick={() => setEditando("novo")} className={`${classeBotaoPrimario} min-h-10`}>
            + Novo desconto
          </button>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {consultores.length > 1 && (
          <select aria-label="Consultor" className={classeFiltro} value={codfor} onChange={(e) => setCodfor(e.target.value)}>
            <option value="">Todos os consultores</option>
            {consultores.map((c) => (
              <option key={c.codfor} value={c.codfor}>
                {c.nome}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Tipo de desconto" className={classeFiltro} value={tipoId} onChange={(e) => setTipoId(e.target.value)}>
          <option value="">Todos os tipos</option>
          {tipos.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nome}
            </option>
          ))}
        </select>
        <input aria-label="Número do processo" className={`${classeFiltro} w-44`} value={processoInput} onChange={(e) => setProcessoInput(e.target.value)} placeholder="Processo (DESC-2026-…)" />
        <select aria-label="Status do processo" className={classeFiltro} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {STATUS_OPCOES.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </select>
        <select aria-label="Situação da parcela" className={classeFiltro} value={situacaoParcela} onChange={(e) => setSituacaoParcela(e.target.value)}>
          <option value="">Qualquer situação de parcela</option>
          {SITUACAO_OPCOES.map((o) => (
            <option key={o.valor} value={o.valor}>
              Parcela {o.rotulo.toLowerCase()}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
          Competência
          <input type="month" className={classeFiltro} value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
          Vigência
          <input type="date" aria-label="Vigência a partir de" className={classeFiltro} value={vigenciaDe} max={vigenciaAte || undefined} onChange={(e) => setVigenciaDe(e.target.value)} />
          –
          <input type="date" aria-label="Vigência até" className={classeFiltro} value={vigenciaAte} min={vigenciaDe || undefined} onChange={(e) => setVigenciaAte(e.target.value)} />
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
          Lançado
          <input type="date" aria-label="Lançado a partir de" className={classeFiltro} value={lancamentoDe} max={lancamentoAte || undefined} onChange={(e) => setLancamentoDe(e.target.value)} />
          –
          <input type="date" aria-label="Lançado até" className={classeFiltro} value={lancamentoAte} min={lancamentoDe || undefined} onChange={(e) => setLancamentoAte(e.target.value)} />
        </label>
        {temFiltro && (
          <button type="button" onClick={limpar} className="text-sm text-muted underline hover:text-foreground">
            Limpar filtros
          </button>
        )}
      </div>

      <ListaServidor<ProcessoLista>
        chave="projetos.descontos.processos"
        exportavel="descontos-lancamentos"
        url="/api/descontos/processos"
        params={params}
        recarga={recarga}
        defs={COLUNAS}
        chaveLinha={(p) => String(p.id)}
        rotulo="processos"
        vazio="Nenhum desconto encontrado."
        pageSize={30}
        opcoesPorPagina={[30, 50, 100, 200]}
        detalhe={(p) => <DetalheProcesso id={p.id} recarga={recarga} onMudou={() => setRecarga((n) => n + 1)} onEditar={setEditando} />}
        rodape={(d) => (
          <div className="flex flex-wrap gap-x-8 gap-y-1 border-t border-border bg-surface px-5 py-3">
            <Total rotulo="Valor total (filtro atual)" valor={d?.totais?.valorTotal} />
            <Total rotulo="Já descontado" valor={d?.totais?.totalDescontado} />
            <Total rotulo="Saldo devedor" valor={d?.totais?.saldoDevedor} />
          </div>
        )}
      />

      {editando && (
        <NovoDescontoModal
          processo={editando === "novo" ? null : editando}
          onFechar={(salvou) => {
            setEditando(null);
            if (salvou) setRecarga((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

function Total({ rotulo, valor }: { rotulo: string; valor: number | undefined }) {
  return (
    <div>
      <p className="text-[10.5px] text-muted">{rotulo}</p>
      <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{fmtMoeda(valor ?? 0)}</p>
    </div>
  );
}
