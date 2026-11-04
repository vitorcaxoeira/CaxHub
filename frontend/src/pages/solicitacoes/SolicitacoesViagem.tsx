import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { AutocompleteRemoto } from "../../components/ui/AutocompleteRemoto";
import { MultiSelectDropdown } from "../../components/ui/MultiSelectDropdown";
import { MolduraFiltro, DATA_EMBUTIDA } from "../../components/ui/ControlesFiltro";
import { regras } from "../../components/ui/padroesFiltros/regras";
import { usePadroesTela } from "../../components/ui/padroesFiltros/usePadroesTela";
import { ListaServidor, type Resposta } from "../../components/colunas/ListaServidor";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";
import { toneBadge } from "../../components/ui/badges";
import { StatusViagemBadge } from "../../components/solicitacoes/StatusViagemBadge";
import { classeBotaoPrimario, classeCampo } from "../../components/solicitacoes/campos";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { hojeIso } from "../../utils/gestao5s";
import {
  FINALIDADE_ROTULO,
  STATUS_ROTULO,
  formatarDia,
  formatarMoeda,
  formatarPeriodo,
  mensagemDeErro,
  type Finalidade,
  type StatusViagem,
} from "../../utils/solicitacoesViagem";

export type EscopoViagem = "minhas" | "atendimento" | "aprovacao";

interface LinhaViagem {
  id: number;
  status: string;
  finalidade: Finalidade;
  motivo: string;
  solicitanteNome: string;
  atendimentoNome: string | null;
  clienteNome: string | null;
  propostaRotulo: string | null;
  dataInicio: string | null;
  dataFim: string | null;
  cidadesDestino: string;
  qtdPessoas: number;
  precisaHospedagem: boolean;
  precisaAereo: boolean;
  precisaCarro: boolean;
  valorAprovado: number | null;
  tipo: "viagem" | "outros";
  // Só no pedido "Outros": os primeiros itens (o que e quantos).
  resumoItens: { descricao: string | null; quantidade: number | null }[];
}

interface ClienteOpcao {
  codcli: number;
  nomcli: string;
  apecli: string;
}

const TEXTOS: Record<EscopoViagem, { secao: string; titulo: string; descricao: string; vazio: string }> = {
  minhas: {
    secao: "Gestão de Solicitações · Viagens",
    titulo: "Minhas Solicitações",
    descricao: "Viagens e pedidos (material, equipamento) que você abriu ou que foram feitos para você — acompanhe cotação, aprovação e reserva.",
    vazio: "Você ainda não tem solicitações de viagem.",
  },
  atendimento: {
    secao: "Gestão de Solicitações · Atendimento",
    titulo: "Atendimento de Viagens",
    descricao: "Todas as solicitações: assuma, cote, envie para aprovação e registre as reservas.",
    vazio: "Nenhuma solicitação neste filtro.",
  },
  aprovacao: {
    secao: "Gestão de Solicitações · Aprovações",
    titulo: "Aprovações de Viagens",
    descricao: "Solicitações do seu departamento que aguardam a sua decisão.",
    vazio: "Nenhuma solicitação neste filtro.",
  },
};

const STATUS_OPCOES = (Object.keys(STATUS_ROTULO) as StatusViagem[]).map((s) => ({ value: s, label: STATUS_ROTULO[s] }));
const FINALIDADE_OPCOES = (Object.keys(FINALIDADE_ROTULO) as Finalidade[]).map((f) => ({ value: f, label: FINALIDADE_ROTULO[f] }));

const PADRAO_STATUS: Record<EscopoViagem, StatusViagem[]> = {
  minhas: [],
  atendimento: ["solicitada", "em_cotacao"],
  aprovacao: ["aguardando_aprovacao"],
};

// Lista com filtro e ordem por coluna, colunas configuráveis, resumo no rodapé e colunas calculadas (ListaServidor + lista em memória no
// servidor, 03/11/2026): o escopo de permissão e os filtros do topo continuam no servidor.
const COLUNAS_VIAGEM: DefColuna<LinhaViagem, (id: number) => void>[] = [
  { nome: "id", titulo: "Nº", fixa: true, largura: 70, classe: "font-mono text-[12.5px] text-foreground", resumos: ["contagem"], render: (v) => `#${v.id}` },
  { nome: "situacao", titulo: "Status", largura: 170, render: (v) => <StatusViagemBadge status={v.status} tipo={v.tipo} /> },
  { nome: "solicitanteNome", titulo: "Solicitante", largura: 180, classe: "text-foreground", texto: (v) => v.solicitanteNome, render: (v) => v.solicitanteNome },
  { nome: "atendimentoNome", titulo: "Atendimento", largura: 160, classe: "text-muted", texto: (v) => v.atendimentoNome, render: (v) => v.atendimentoNome ?? "—" },
  { nome: "finalidade", titulo: "Finalidade", largura: 160, classe: "text-muted", render: (v) => FINALIDADE_ROTULO[v.finalidade] ?? v.finalidade },
  { nome: "clienteNome", titulo: "Cliente", largura: 180, classe: "text-foreground", texto: (v) => v.clienteNome, render: (v) => v.clienteNome ?? "—" },
  { nome: "propostaRotulo", titulo: "Proposta", largura: 150, classe: "text-muted", texto: (v) => v.propostaRotulo, render: (v) => v.propostaRotulo ?? "—" },
  {
    nome: "dataInicio",
    titulo: "Período",
    largura: 170,
    classe: "text-foreground",
    render: (v) => (v.tipo === "outros" ? `Até ${formatarDia(v.dataFim)}` : formatarPeriodo(v.dataInicio, v.dataFim)),
  },
  { nome: "dataFim", titulo: "Término", largura: 100, classe: "text-muted", render: (v) => formatarDia(v.dataFim) },
  {
    nome: "cidadesDestino",
    titulo: "Destino / itens",
    largura: 220,
    classe: "text-muted",
    texto: (v) => (v.tipo === "outros" ? v.resumoItens.map((i) => `${i.descricao} ×${i.quantidade ?? 1}`).join(", ") : v.cidadesDestino),
    render: (v) =>
      v.tipo === "outros"
        ? v.resumoItens.map((i) => `${i.descricao} ×${i.quantidade ?? 1}`).join(", ")
        : `${v.cidadesDestino} · ${v.qtdPessoas} ${v.qtdPessoas === 1 ? "pessoa" : "pessoas"}`,
  },
  { nome: "qtdPessoas", titulo: "Pessoas", direita: true, largura: 80, classe: "tabular-nums text-muted", render: (v) => v.qtdPessoas },
  {
    nome: "servicos",
    titulo: "Serviços",
    semOrdenar: true,
    largura: 150,
    render: (v) => (
      <div className="flex flex-wrap gap-1">
        {v.tipo === "outros" && <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] ${toneBadge.neutral}`}>Outros</span>}
        {v.precisaHospedagem && <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] ${toneBadge.neutral}`}>Hotel</span>}
        {v.precisaAereo && <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] ${toneBadge.neutral}`}>Aéreo</span>}
        {v.precisaCarro && <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] ${toneBadge.neutral}`}>Carro</span>}
      </div>
    ),
  },
  {
    nome: "valorAprovado",
    titulo: "Aprovado",
    direita: true,
    largura: 120,
    classe: "font-mono text-[12.5px] text-foreground",
    formatarResumo: (n) => formatarMoeda(n),
    render: (v) => formatarMoeda(v.valorAprovado),
  },
];

// A mesma página serve as três rotas: trocar de escopo monta a lista de novo (filtro do zero e o padrão salvo daquele escopo).
export function SolicitacoesViagem({ escopo }: { escopo: EscopoViagem }) {
  return <ListaSolicitacoes key={escopo} escopo={escopo} />;
}

function ListaSolicitacoes({ escopo }: { escopo: EscopoViagem }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const texto = TEXTOS[escopo];
  // Em "minhas", quem não é admin nem líder só entra como viajante: precisa saber disso ANTES do primeiro
  // carregamento, senão a lista abriria sem o filtro e piscaria (admin e líder não precisam esperar).
  const [pronto, setPronto] = useState(escopo !== "minhas" || user?.role === "admin");
  const [somenteViajante, setSomenteViajante] = useState(false);
  const [status, setStatus] = useState<StatusViagem[]>(PADRAO_STATUS[escopo]);
  const [finalidades, setFinalidades] = useState<Finalidade[]>([]);
  const [cliente, setCliente] = useState<ClienteOpcao | null>(null);
  // Só entram viagens cujo término é esta data ou depois (o backend já aceita `de`). Vazio = histórico inteiro.
  const [terminoDe, setTerminoDe] = useState("");
  const [busca, setBusca] = useState("");
  const buscaDebounced = useDebouncedValue(busca, 300);
  const [kpis, setKpis] = useState<Record<string, number>>({});
  const [erro, setErro] = useState<string | null>(null);

  // Padrão de cada filtro (estrela, 03/11/2026): um por escopo (minhas, atendimento, aprovação), aplicado antes da 1ª consulta.
  const p = usePadroesTela({
    tela: `solicitacoes.${escopo}`,
    campos: {
      status: { rotulo: "Status", atual: status, aplicar: setStatus, validar: regras.lista("string", STATUS_OPCOES.map((o) => o.value)), semOpcoes: true },
      finalidade: {
        rotulo: "Finalidade",
        atual: finalidades,
        aplicar: setFinalidades,
        validar: regras.lista("string", FINALIDADE_OPCOES.map((o) => o.value)),
        semOpcoes: true,
      },
      cliente: { rotulo: "Cliente", atual: cliente, aplicar: setCliente, validar: regras.objeto("codcli"), semOpcoes: true },
      terminoDe: {
        rotulo: "Término a partir de",
        atual: terminoDe || null,
        aplicar: (v: string | null) => setTerminoDe(v ?? ""),
        validar: regras.data(),
        semOpcoes: true,
      },
    },
  });

  // Chaveado em id/papel (não no objeto `user`): se o objeto for recriado, o filtro que a pessoa já
  // mexeu na tela não pode voltar ao padrão.
  const usuarioId = user?.id;
  const usuarioRole = user?.role;
  useEffect(() => {
    if (escopo !== "minhas" || usuarioId == null || usuarioRole === "admin") {
      setSomenteViajante(false);
      setPronto(true);
      return;
    }
    if (!p.pronto) return;
    let cancelado = false;
    setPronto(false);
    axios
      .get("/api/dashboard/meu-perfil")
      .then(({ data }) => {
        if (cancelado) return;
        const lider = (data.departamentosGerenciados ?? []).length > 0;
        setSomenteViajante(!lider);
        if (!lider) {
          // Viagem/pedido que já terminou fica de fora; "Ver histórico" limpa a data. Sem status marcado de
          // propósito: quem recebe um pedido "Outros" acompanha desde a abertura, e é o servidor que limita
          // o que cada um enxerga (viagem só Reservada/Finalizada; pedido tudo, menos Cancelado).
          // Quem salvou um padrão para a data fica com ele.
          if (!p.temPadrao("terminoDe")) setTerminoDe(hojeIso());
        }
      })
      .catch(() => {})
      .finally(() => !cancelado && setPronto(true));
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escopo, usuarioId, usuarioRole, p.pronto]);

  const totalGeral = useMemo(() => Object.values(kpis).reduce((a, b) => a + b, 0), [kpis]);

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">{texto.secao}</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-foreground">{texto.titulo}</h1>
        {!somenteViajante && (
          <Link to="/solicitacoes/nova" className={classeBotaoPrimario}>
            Nova solicitação
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">
        {somenteViajante ? "Viagens em que você viaja e pedidos feitos para você." : texto.descricao}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {STATUS_OPCOES.map((s) => {
          const ativo = status.includes(s.value);
          return (
            <button
              key={s.value}
              onClick={() => setStatus((atual) => (atual.includes(s.value) ? atual.filter((x) => x !== s.value) : [...atual, s.value]))}
              className={`rounded-md px-3 py-1 text-[12.5px] font-medium ${
                ativo ? "bg-primary text-primary-foreground" : "border border-border text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              {s.label} <span className="font-mono text-[11px] opacity-80">{kpis[s.value] ?? 0}</span>
            </button>
          );
        })}
        {status.length > 0 && (
          <button onClick={() => setStatus([])} className="px-2 text-[12.5px] text-muted hover:text-foreground">
            Limpar status ({totalGeral} no total)
          </button>
        )}
        <span className="relative inline-block h-7 w-7">{p.estrela("status")}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nº, motivo, destino, item, solicitante ou cliente"
          className={`${classeCampo} max-w-sm`}
        />
        <MolduraFiltro rotulo="Término a partir de" acessorio={p.estrela("terminoDe")}>
          <input type="date" aria-label="Término a partir de" value={terminoDe} onChange={(e) => setTerminoDe(e.target.value)} className={DATA_EMBUTIDA} />
        </MolduraFiltro>
        {terminoDe && (
          <button onClick={() => setTerminoDe("")} className="text-[12.5px] text-primary hover:underline" title="Viagens já encerradas ficam fora; limpe a data para ver o histórico.">
            Ver histórico
          </button>
        )}
        <MultiSelectDropdown opcoes={FINALIDADE_OPCOES} selecionados={finalidades} onChange={setFinalidades} labelTodos="Todas as finalidades" labelSufixo="finalidade(s)"  acessorio={p.estrela("finalidade")} />
        <div className="w-64">
          <AutocompleteRemoto<ClienteOpcao>
            valor={cliente}
            onChange={setCliente}
            url="/api/solicitacoes-viagem/apoio/clientes"
            chaveLista="clientes"
            rotulo={(c) => c.apecli || c.nomcli}
            detalhe={(c) => c.nomcli}
            chave={(c) => c.codcli}
            placeholder="Todos os clientes"
            acessorio={p.estrela("cliente")}
          />
        </div>
      </div>

      {pronto && p.pronto && (
        <div className="mt-4">
          <ListaServidor<LinhaViagem, (id: number) => void>
            chave={`solicitacoes.${escopo}`}
            url="/api/solicitacoes-viagem"
            params={{
              escopo,
              status: status.join(",") || undefined,
              finalidade: finalidades.join(",") || undefined,
              codcli: cliente?.codcli,
              de: terminoDe || undefined,
              q: buscaDebounced || undefined,
            }}
            defs={COLUNAS_VIAGEM}
            chaveLinha={(v) => String(v.id)}
            onLinha={(v) => navigate(`/solicitacoes/${v.id}`)}
            rotulo="solicitações"
            vazio={terminoDe ? `Nenhuma viagem com término a partir de ${formatarDia(terminoDe)}. Use "Ver histórico" para ver as anteriores.` : texto.vazio}
            pageSize={25}
            opcoesPorPagina={[25, 50, 100, 200]}
            aoCarregar={(d) => setKpis((d as Resposta<LinhaViagem> & { kpis?: Record<string, number> }).kpis ?? {})}
          />
        </div>
      )}
    </div>
  );
}
