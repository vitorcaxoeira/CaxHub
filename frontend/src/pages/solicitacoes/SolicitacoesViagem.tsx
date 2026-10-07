import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { AutocompleteRemoto } from "../../components/ui/AutocompleteRemoto";
import { MultiSelectDropdown } from "../../components/ui/MultiSelectDropdown";
import { Pagination } from "../../components/ui/Pagination";
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

export function SolicitacoesViagem({ escopo }: { escopo: EscopoViagem }) {
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
  const [pagina, setPagina] = useState(1);
  const [linhas, setLinhas] = useState<LinhaViagem[]>([]);
  const [total, setTotal] = useState(0);
  const [kpis, setKpis] = useState<Record<string, number>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const tamanho = 25;

  // A mesma página serve as três rotas: trocar de escopo recomeça o filtro do zero.
  useEffect(() => {
    setStatus(PADRAO_STATUS[escopo]);
    setFinalidades([]);
    setCliente(null);
    setTerminoDe("");
    setBusca("");
    setPagina(1);
  }, [escopo]);

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
          setTerminoDe(hojeIso());
        }
      })
      .catch(() => {})
      .finally(() => !cancelado && setPronto(true));
    return () => {
      cancelado = true;
    };
  }, [escopo, usuarioId, usuarioRole]);

  const carregar = useCallback(async () => {
    if (!pronto) return;
    setCarregando(true);
    setErro(null);
    try {
      const { data } = await axios.get("/api/solicitacoes-viagem", {
        params: {
          escopo,
          status: status.join(",") || undefined,
          finalidade: finalidades.join(",") || undefined,
          codcli: cliente?.codcli,
          de: terminoDe || undefined,
          q: buscaDebounced || undefined,
          pagina,
          tamanho,
        },
      });
      setLinhas(data.solicitacoes);
      setTotal(data.total);
      setKpis(data.kpis);
    } catch (err) {
      setErro(mensagemDeErro(err, "Não foi possível carregar as solicitações"));
    } finally {
      setCarregando(false);
    }
  }, [pronto, escopo, status, finalidades, cliente, terminoDe, buscaDebounced, pagina]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Qualquer filtro novo volta pra primeira página.
  useEffect(() => {
    setPagina(1);
  }, [status, finalidades, cliente, terminoDe, buscaDebounced]);

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
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nº, motivo, destino, item, solicitante ou cliente"
          className={`${classeCampo} max-w-sm`}
        />
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          Término a partir de
          <input type="date" value={terminoDe} onChange={(e) => setTerminoDe(e.target.value)} className={`${classeCampo} w-auto`} />
        </label>
        {terminoDe && (
          <button onClick={() => setTerminoDe("")} className="text-[12.5px] text-primary hover:underline" title="Viagens já encerradas ficam fora; limpe a data para ver o histórico.">
            Ver histórico
          </button>
        )}
        <MultiSelectDropdown opcoes={FINALIDADE_OPCOES} selecionados={finalidades} onChange={setFinalidades} labelTodos="Todas as finalidades" labelSufixo="finalidade(s)" />
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
          />
        </div>
      </div>

      {erro && <p className="mt-4 text-sm text-destructive">{erro}</p>}

      <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-[11.5px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Nº</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Solicitante</th>
              <th className="px-4 py-2.5 font-medium">Finalidade</th>
              <th className="px-4 py-2.5 font-medium">Cliente / Proposta</th>
              <th className="px-4 py-2.5 font-medium">Período e destino</th>
              <th className="px-4 py-2.5 font-medium">Serviços</th>
              <th className="px-4 py-2.5 text-right font-medium">Aprovado</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((v) => (
              <tr key={v.id} onClick={() => navigate(`/solicitacoes/${v.id}`)} className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2">
                <td className="px-4 py-2.5 font-mono text-[12.5px] text-foreground">#{v.id}</td>
                <td className="px-4 py-2.5">
                  <StatusViagemBadge status={v.status} tipo={v.tipo} />
                </td>
                <td className="px-4 py-2.5 text-foreground">
                  {v.solicitanteNome}
                  {v.atendimentoNome && <span className="block text-[11.5px] text-muted">Atend.: {v.atendimentoNome}</span>}
                </td>
                <td className="px-4 py-2.5 text-muted">{FINALIDADE_ROTULO[v.finalidade] ?? v.finalidade}</td>
                <td className="px-4 py-2.5 text-foreground">
                  {v.clienteNome ?? <span className="text-muted">—</span>}
                  {v.propostaRotulo && <span className="block text-[11.5px] text-muted">{v.propostaRotulo}</span>}
                </td>
                <td className="px-4 py-2.5 text-foreground">
                  {v.tipo === "outros" ? `Até ${formatarDia(v.dataFim)}` : formatarPeriodo(v.dataInicio, v.dataFim)}
                  <span className="block max-w-[16rem] truncate text-[11.5px] text-muted">
                    {v.tipo === "outros"
                      ? v.resumoItens.map((i) => `${i.descricao} ×${i.quantidade ?? 1}`).join(", ")
                      : `${v.cidadesDestino} · ${v.qtdPessoas} ${v.qtdPessoas === 1 ? "pessoa" : "pessoas"}`}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {v.tipo === "outros" && <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] ${toneBadge.neutral}`}>Outros</span>}
                    {v.precisaHospedagem && <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] ${toneBadge.neutral}`}>Hotel</span>}
                    {v.precisaAereo && <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] ${toneBadge.neutral}`}>Aéreo</span>}
                    {v.precisaCarro && <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] ${toneBadge.neutral}`}>Carro</span>}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-[12.5px] text-foreground">{formatarMoeda(v.valorAprovado)}</td>
              </tr>
            ))}
            {!carregando && linhas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted">
                  {terminoDe ? `Nenhuma viagem com término a partir de ${formatarDia(terminoDe)}. Use "Ver histórico" para ver as anteriores.` : texto.vazio}
                </td>
              </tr>
            )}
            {carregando && linhas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted">
                  Carregando...
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination page={pagina} pageSize={tamanho} total={total} loading={carregando} onPageChange={setPagina} label="solicitações" />
      </div>
    </div>
  );
}
