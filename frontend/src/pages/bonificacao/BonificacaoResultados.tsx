import { useMemo, useState } from "react";
import { ListaServidor } from "../../components/colunas/ListaServidor";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";
import { classeFiltro, fmtCompetencia, fmtMoeda, fmtNumero, fmtPontos, Selo, useAcessoBonificacao, useConsultores, useProcessos } from "./comum";

// Gestão de Bonificação › Resultados: uma linha por consultor x competência x indicador, de todos os processos. Base dos relatórios (por
// consultor, por indicador, por mês): filtre, ordene, agrupe pelo resumo do rodapé e exporte. Quem administra vê também o que ainda está aberto.

interface ResultadoLista {
  id: number;
  processo: string;
  competencia: string;
  consultor: string;
  indicador: string;
  valorApurado: number | null;
  valorInformado: number | null;
  pontos: number | null;
  valorBase: number | null;
  valor: number | null;
  situacao: string;
  observacao: string | null;
}

const num = "font-mono text-sm tabular-nums text-foreground";
const COLUNAS: DefColuna<ResultadoLista>[] = [
  { nome: "competencia", titulo: "Competência", fixa: true, largura: 110, resumos: ["contagem"], classe: "font-mono text-sm font-semibold text-foreground", render: (r) => fmtCompetencia(r.competencia) },
  { nome: "processo", titulo: "Processo", largura: 200, classe: "text-sm text-foreground", texto: (r) => r.processo, render: (r) => r.processo },
  { nome: "consultor", titulo: "Consultor", largura: 190, classe: "text-sm text-foreground", texto: (r) => r.consultor, render: (r) => r.consultor },
  { nome: "indicador", titulo: "Indicador", largura: 220, classe: "text-sm text-foreground", texto: (r) => r.indicador, render: (r) => r.indicador },
  { nome: "valorApurado", titulo: "Apurado", direita: true, largura: 100, classe: num, render: (r) => fmtNumero(r.valorApurado) },
  { nome: "valorInformado", titulo: "Informado", direita: true, largura: 100, classe: num, render: (r) => fmtNumero(r.valorInformado) },
  { nome: "pontos", titulo: "Pontos", direita: true, largura: 90, classe: num, formatarResumo: fmtPontos, render: (r) => fmtPontos(r.pontos) },
  { nome: "valorBase", titulo: "Valor base", direita: true, largura: 110, classe: num, formatarResumo: fmtMoeda, render: (r) => fmtMoeda(r.valorBase) },
  { nome: "valor", titulo: "Valor", direita: true, largura: 110, classe: "font-mono text-sm font-semibold tabular-nums text-primary", formatarResumo: fmtMoeda, render: (r) => (r.valor == null ? <span className="text-warning">pendente</span> : fmtMoeda(r.valor)) },
  { nome: "situacao", titulo: "Situação", largura: 100, render: (r) => <Selo texto={r.situacao} tone={r.situacao === "Fechado" ? "success" : "warning"} /> },
  { nome: "observacao", titulo: "Observação", largura: 220, classe: "text-sm text-muted", render: (r) => r.observacao ?? "—" },
];

export function BonificacaoResultados() {
  const acesso = useAcessoBonificacao();
  const processos = useProcessos();
  const consultores = useConsultores();
  const [processoId, setProcessoId] = useState("");
  const [codfor, setCodfor] = useState("");
  const [situacao, setSituacao] = useState("");
  const [competenciaDe, setCompetenciaDe] = useState("");
  const [competenciaAte, setCompetenciaAte] = useState("");

  const params = useMemo(
    () => ({ processoId: processoId || undefined, codfor: codfor || undefined, situacao: situacao || undefined, competenciaDe: competenciaDe || undefined, competenciaAte: competenciaAte || undefined }),
    [processoId, codfor, situacao, competenciaDe, competenciaAte]
  );

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão de Bonificação</p>
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold text-foreground">Resultados por indicador</h1>
        <p className="mt-1 text-sm text-muted">Cada linha é um indicador de um consultor numa competência. Filtre por processo, consultor ou período e exporte.</p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select aria-label="Processo" className={classeFiltro} value={processoId} onChange={(e) => setProcessoId(e.target.value)}>
          <option value="">Todos os processos</option>
          {processos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
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
        {acesso?.administra && (
          <select aria-label="Situação do fechamento" className={classeFiltro} value={situacao} onChange={(e) => setSituacao(e.target.value)}>
            <option value="">Abertos e fechados</option>
            <option value="fechado">Só fechados</option>
            <option value="aberto">Só abertos</option>
          </select>
        )}
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
          Competência
          <input type="month" aria-label="Competência de" className={classeFiltro} value={competenciaDe} max={competenciaAte || undefined} onChange={(e) => setCompetenciaDe(e.target.value)} />
          –
          <input type="month" aria-label="Competência até" className={classeFiltro} value={competenciaAte} min={competenciaDe || undefined} onChange={(e) => setCompetenciaAte(e.target.value)} />
        </label>
      </div>

      <ListaServidor<ResultadoLista>
        chave="bonificacao.resultados"
        camposRelacionados
        exportavel="bonificacao-resultados"
        url="/api/bonificacao/resultados"
        params={params}
        defs={COLUNAS}
        chaveLinha={(r) => String(r.id)}
        rotulo="resultados"
        vazio="Nenhum resultado para os filtros escolhidos."
        pageSize={25}
        rodape={(d) => (
          <div className="flex flex-wrap gap-x-8 gap-y-1 border-t border-border bg-surface px-5 py-3">
            {(
              [
                ["Pontos (filtro atual)", fmtPontos(d?.totais?.pontos ?? 0)],
                ["Valor (filtro atual)", fmtMoeda(d?.totais?.valor ?? 0)],
              ] as const
            ).map(([rotulo, valor]) => (
              <div key={rotulo}>
                <p className="text-[10.5px] text-muted">{rotulo}</p>
                <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{valor}</p>
              </div>
            ))}
          </div>
        )}
      />
    </div>
  );
}
