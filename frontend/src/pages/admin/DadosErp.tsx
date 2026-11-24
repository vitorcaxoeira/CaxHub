import { useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { TabelaDadosImportados, type RespostaDadosBase } from "../../components/colunas/TabelaDadosImportados";

// Consulta dos dados JÁ IMPORTADOS de uma tabela do Senior (Administração > Importados do
// Senior > "Ver dados") e, na rota /removidos/, a lista de REMOVIDOS. Somente leitura — o espelho
// nunca é editado aqui. Sem entrada própria no Sidebar: só alcançável pela tela de importação.
// Desde 21/10/2026 (pedido do Vitor) tudo é no SERVIDOR, para qualquer tamanho de tabela: busca de
// texto, funil por coluna com operador e valor (FiltroColunaServidor, nada carregado antes de abrir)
// e paginação. Os filtros ficam na URL (`?f=`), para F5/voltar/link manterem o recorte.

interface RespostaDados extends RespostaDadosBase {
  jobName: string;
  displayName: string;
  tabelaSenior: string;
  tabelaLocal: string;
  // Só na lista de removidos (?situacao=): contagem de cada situação, início da última varredura e o recorte do filtro da sync.
  situacao?: Situacao;
  contagens?: { removidos: number; candidatos: number };
  candidatosDesde?: string | null;
  recorte?: string[];
  recorteLocal?: boolean;
  motivoSemRecorte?: string | null;
}

// Lista de REMOVIDOS (21/10/2026): a mesma tela, recortada por situação. "Candidatos" usa a mesma conta da varredura (vivos não vistos
// na última varredura, dentro do recorte do filtro da sincronização), para bater com o selo "teto · N" da tela de importação.
type Situacao = "candidatos" | "removidos" | "sumidos";
const SITUACOES: { valor: Situacao; rotulo: string }[] = [
  { valor: "candidatos", rotulo: "Candidatos da última varredura" },
  { valor: "removidos", rotulo: "Marcados como removidos" },
  { valor: "sumidos", rotulo: "Todos os sumidos" },
];

// Data-só-dia (@db.Date chega como meia-noite UTC) vira dd/mm/aaaa; data com hora vira
// dd/mm/aaaa hh:mm no fuso local. Texto de data é montado na mão, sem `new Date(...)` no caso
// de dia puro, pra não deslocar o dia em America/Sao_Paulo.
function formatarData(iso: string): string {
  if (iso.endsWith("T00:00:00.000Z")) {
    const [ano, mes, dia] = iso.slice(0, 10).split("-");
    return `${dia}/${mes}/${ano}`;
  }
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function DadosErp() {
  const { jobName } = useParams<{ jobName: string }>();
  const local = useLocation();
  // A mesma tela serve ao ERP (/admin/sincronizacao-erp/dados/...) e ao HCM (/admin/sincronizacao-hcm/dados/...).
  const hcm = local.pathname.startsWith("/admin/sincronizacao-hcm");
  const API = hcm ? "/api/sync-hcm" : "/api/sync-erp";
  const ROTA = hcm ? "/admin/sincronizacao-hcm" : "/admin/sincronizacao-erp";
  const TITULO = hcm ? "Importados do HCM" : "Importados do ERP";
  // /admin/sincronizacao-erp/removidos/:jobName — a lista de removidos com os mesmos filtros do "Ver dados".
  const modoRemovidos = local.pathname.includes("/removidos/");
  const [params, setParams] = useSearchParams();
  const situacaoParam = params.get("situacao");
  const situacao: Situacao | undefined = modoRemovidos
    ? situacaoParam === "candidatos" || situacaoParam === "removidos" || situacaoParam === "sumidos"
      ? situacaoParam
      : "sumidos"
    : undefined;
  const [resposta, setResposta] = useState<RespostaDados | null>(null);

  const trocarSituacao = (valor: Situacao) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set("situacao", valor);
        return n;
      },
      { replace: true }
    );

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        <Link to={ROTA} className="hover:underline">
          Administração · {TITULO}
        </Link>
      </p>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">
            {modoRemovidos ? "Removidos no Senior" : "Dados importados"} — {resposta?.displayName ?? jobName}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {modoRemovidos ? (
              <>
                Registros que não vieram mais na consulta ao {hcm ? "HCM" : "Senior"}. Confira alguns direto no ERP: se não existem mais lá, a
                detecção está correta. Nada é apagado: só marcado.
              </>
            ) : resposta ? (
              <>
                Espelho local <span className="font-mono">{resposta.tabelaLocal}</span> da tabela{" "}
                <span className="font-mono">{resposta.tabelaSenior}</span> do {hcm ? "HCM" : "Senior"} · somente leitura.
              </>
            ) : (
              "Somente leitura."
            )}
          </p>
        </div>
        <Link
          to={ROTA}
          className="flex-none rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition hover:bg-surface-2"
        >
          ← Voltar pra lista
        </Link>
      </div>


      {modoRemovidos && (
        <div className="mb-4 space-y-2">
          <div className="inline-flex flex-wrap gap-1 rounded-md border border-border p-1" role="group" aria-label="Situação">
            {SITUACOES.map((o) => {
              const n =
                o.valor === "candidatos"
                  ? resposta?.contagens?.candidatos
                  : o.valor === "removidos"
                    ? resposta?.contagens?.removidos
                    : resposta?.contagens
                      ? resposta.contagens.candidatos + resposta.contagens.removidos
                      : undefined;
              const ativa = situacao === o.valor;
              return (
                <button
                  key={o.valor}
                  type="button"
                  onClick={() => trocarSituacao(o.valor)}
                  aria-pressed={ativa}
                  className={`rounded px-3 py-1.5 text-[12.5px] font-medium transition ${ativa ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"}`}
                >
                  {o.rotulo}
                  {n != null && <span className="ml-1.5 font-mono tabular-nums opacity-80">{n.toLocaleString("pt-BR")}</span>}
                </button>
              );
            })}
          </div>
          <p className="text-[12px] text-muted">
            {resposta?.candidatosDesde
              ? `Candidatos = vivos que não vieram na última varredura (${formatarData(resposta.candidatosDesde)})`
              : "Ainda não houve varredura nesta tabela"}
            {resposta?.recorte && resposta.recorte.length > 0 && (
              <>
                {" "}· recorte do filtro da sincronização: <span className="font-mono text-foreground">{resposta.recorte.join(" e ")}</span>
              </>
            )}
            {resposta && resposta.recorteLocal === false && (
              <span className="text-destructive"> · o filtro usa campo não guardado localmente ({resposta.motivoSemRecorte}): candidatos não podem ser calculados.</span>
            )}
          </p>
        </div>
      )}

      {/* Busca, funil e ordem por coluna, colunas configuráveis, rodapé de totais e paginação: tudo no servidor (TabelaDadosImportados,
          trazido do CaxHub_Dash em 03/11/2026). A situação dos removidos vai junto como parâmetro fixo. */}
      <TabelaDadosImportados<RespostaDados>
        endpoint={`${API}/${jobName}/dados`}
        paramsExtras={{ situacao }}
        reinicia={`${API}/${jobName}`}
        mensagemVazio={modoRemovidos ? "Nenhum registro nesta situação." : "Nenhum registro importado ainda."}
        tituloControle="Controle do espelho"
        onResposta={setResposta}
      />
    </div>
  );
}
