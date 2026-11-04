import axios from "axios";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Award,
  BookOpen,
  Banknote,
  Briefcase,
  CalendarClock,
  CalendarRange,
  CalendarX,
  ChartBar,
  ChartColumn,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CirclePlus,
  ClipboardList,
  ClipboardPlus,
  Clock,
  CreditCard,
  Database,
  DatabaseZap,
  FileText,
  FolderKanban,
  Gauge,
  HandCoins,
  Headset,
  History,
  House,
  IdCard,
  Inbox,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  type LucideIcon,
  MapPin,
  MessageSquare,
  Network,
  PencilLine,
  Plane,
  Plug,
  ReceiptText,
  RefreshCw,
  Repeat,
  Settings,
  Settings2,
  Sheet,
  ShieldCheck,
  Sparkles,
  SquareKanban,
  Store,
  Target,
  Timer,
  TreePalm,
  TrendingUp,
  Upload,
  UserMinus,
  Users,
  UsersRound,
  Wallet,
  Waypoints,
} from "lucide-react";
import { cn } from "../lib/cn";
import { abrirCaminho, abrirNoAcordeao, alternarNoAcordeao, irmaosDoMenu } from "./menuAcordeao";
import { useAuth } from "../auth/AuthContext";
import { DEPEXE_COMERCIAL } from "../auth/acessoComercial";
import { DEPEXE_DHO } from "../auth/acessoRh";
import { DEPEXES_PLANO_EVOLUCAO } from "../auth/acessoPlanoEvolucao";

interface NavLeaf {
  to: string;
  label: string;
  // Só aparece pra quem é admin ou gestor de algum departamento (dinâmico, via
  // DepartamentoGestor — não dá pra expressar isso com `roles`, que é estático).
  gestorOuAdmin?: boolean;
  // Combina com `gestorOuAdmin` como OU, não AND: também aparece pra quem tem Consultor
  // próprio (dinâmico, via Consultor.email — mesmo caso de `gestorOuAdmin` não dar pra
  // expressar com `roles`). Hoje só a Meta diária usa isto — acesso liberado ao consultor
  // comum, mas restrito ao próprio registro dele no backend (ver routes/jornadas.ts).
  souConsultor?: boolean;
  // Também aparece pra quem VIAJA numa solicitação reservada/finalizada (dinâmico, via
  // `viajante` do /meu-perfil). Combina em OU com `gestorOuAdmin`, como `souConsultor`. Só
  // "Minhas Solicitações" usa — o viajante só consulta a própria viagem.
  souViajante?: boolean;
  // Aparece pra admin e pra quem é gestor do departamento 11 (DHO) — dinâmico, via DepartamentoGestor. Só
  // o menu Pessoas usa. Em sincronia com o RequireGestorOuAdmin (depexe) em App.tsx e com o
  // exigirAdminOuGestorDho de routes/rh/index.ts.
  gestorDho?: boolean;
  // Aparece pra admin e pra quem é gestor do departamento 2 (Comercial) — dinâmico, via DepartamentoGestor. Só Comercial › Gestão de
  // Metas usa. Em sincronia com o RequireGestorOuAdmin (depexe) em App.tsx e com o exigirAdminOuGestorComercial de routes/metasComercial.ts.
  gestorComercial?: boolean;
  // Aparece pra admin e pra quem é gestor da Consultoria ERP (8) ou HCM (9) — dinâmico, via DepartamentoGestor. Só o Plano de Evolução PJ
  // usa. Em sincronia com o RequireGestorOuAdmin (depexe) em App.tsx e com o carregarAcesso de routes/planoEvolucaoComum.ts.
  gestorConsultoria?: boolean;
  // Restringe ESTE item a papéis específicos dentro de um grupo aberto a todos (ex.: Atendimento
  // de viagens). Mantido em sincronia com o RequireRole em App.tsx e o backend.
  roles?: string[];
  // Módulo Gestão 5S: o acesso vem do cadastro de participantes do 5S (GET /5s/meu-acesso),
  // não do papel do usuário. O item só aparece pra quem tem um destes papéis no 5S.
  papel5s?: Array<"coordenador" | "avaliador" | "lider">;
  // Destaca só na rota exata. Necessário quando o caminho do item é prefixo de outro item do
  // menu (ex.: "/5s" e "/5s/observacoes") — sem isso o NavLink acende os dois ao mesmo tempo.
  end?: boolean;
}

// Sub-menu dentro de um grupo (ex.: "Integração Kyria" dentro de "Administração") — mesmo
// mecanismo de collapse dos grupos de topo, só que aninhado mais um nível. Existe pra quando um
// item começa a acumular mais de uma tela relacionada (Kyria: só "Sincronização" hoje, mais
// telas entram aqui conforme novos endpoints forem implementados).
interface NavSubgroup {
  label: string;
  children: NavLeaf[];
}

type NavGroupItem = NavLeaf | NavSubgroup;

function isSubgroup(item: NavGroupItem): item is NavSubgroup {
  return "children" in item;
}

interface NavGroup {
  label: string;
  items: NavGroupItem[];
  // Papéis que podem ver este grupo — mantido em sincronia com o `RequireRole` das
  // mesmas rotas em `App.tsx` e com o `requireRole(...)` do router correspondente no
  // backend. "*" = qualquer papel autenticado. Ao criar um menu novo, sempre
  // perguntar ao Vitor quais papéis acessam.
  roles: string[] | "*";
}

const topLevel: NavLeaf[] = [{ to: "/", label: "Início" }];

const TODOS_5S: NavLeaf["papel5s"] = ["coordenador", "avaliador", "lider"];

const groups: NavGroup[] = [
  {
    label: "Comercial",
    items: [
      { to: "/projetos/propostas", label: "Propostas", roles: ["admin", "comercial"] },
      // Só o gestor do Comercial (e o admin): a gerente lança as metas anuais do time e acompanha a evolução.
      {
        label: "Gestão de Metas",
        children: [
          { to: "/comercial/metas", label: "Painel", gestorComercial: true, end: true },
          { to: "/comercial/metas/lancamentos", label: "Lançamentos", gestorComercial: true },
          { to: "/comercial/metas/planejamento", label: "Metas do ano", gestorComercial: true },
          { to: "/comercial/metas/indicadores", label: "Indicadores", gestorComercial: true },
        ],
      },
    ],
    // O grupo é "*" porque o gestor do Comercial nem sempre tem o papel `comercial`; cada item traz o próprio filtro e o grupo some
    // sozinho de quem não vê nenhum item (filtro de grupo vazio mais abaixo).
    roles: "*",
  },
  {
    label: "Gestão de Projetos",
    items: [
      { to: "/projetos/atividades", label: "Atividades" },
      { to: "/projetos/apontamentos", label: "Meus Apontamentos" },
      // Ações do Plano de ação do Painel de Eficiência em que a pessoa é a responsável (consultor do time, não gestor).
      { to: "/projetos/minhas-acoes", label: "Minhas ações", souConsultor: true },
      // Plano de Evolução dos consultores PJ: o consultor vê só o próprio andamento (quem não participa recebe uma tela explicando).
      { to: "/projetos/meu-plano", label: "Meu plano", souConsultor: true },
      // Sem `gestorOuAdmin`: o consultor entra pra acompanhar os pedidos dele, o gestor
      // pra decidir os do time. O recorte de quem vê o quê é do servidor.
      { to: "/projetos/aprovacoes", label: "Aprovações" },
      { to: "/projetos/alocacao", label: "Alocação", gestorOuAdmin: true },
      { to: "/projetos/eficiencia", label: "Eficiência", gestorOuAdmin: true },
      // Gestão do Plano de Evolução dos consultores PJ (ciclos, participantes, prévia, apuração). Antes era um botão dentro da Eficiência.
      { to: "/projetos/plano-evolucao", label: "Plano de Evolução PJ", gestorConsultoria: true },
      { to: "/projetos/jornadas", label: "Meta diária", gestorOuAdmin: true, souConsultor: true },
      { to: "/projetos/auditoria", label: "Auditoria", gestorOuAdmin: true },
    ],
    roles: "*",
  },
  {
    label: "Gestão de Solicitações",
    items: [
      { to: "/solicitacoes/nova", label: "Nova Solicitação", gestorOuAdmin: true },
      { to: "/solicitacoes/minhas", label: "Minhas Solicitações", gestorOuAdmin: true, souViajante: true },
      // Atendimento cota e reserva: só administrativo e admin (o backend recusa o resto). Como
      // `roles` e `gestorOuAdmin` valem juntos (E), segue a entrada do módulo: o administrativo
      // só vê se também for líder.
      { to: "/solicitacoes/atendimento", label: "Atendimento", roles: ["admin", "administrativo"], gestorOuAdmin: true },
      // Sem `roles`: quem aprova é o gestor do departamento do solicitante (dinâmico, via
      // DepartamentoGestor) — mesmo caso de Alocação. Admin também entra por gestorOuAdmin.
      { to: "/solicitacoes/aprovacoes", label: "Aprovações", gestorOuAdmin: true },
    ],
    // Admin e líderes de departamento (pedido do Vitor, 05/10/2026): o grupo é "*" e cada item
    // traz `gestorOuAdmin`, que esconde o grupo inteiro de quem não é líder. Em sincronia com o
    // RequireGestorOuAdmin em App.tsx e o exigirAdminOuGestor do router no backend.
    roles: "*",
  },
  {
    label: "Gestão 5S",
    // Sem `roles`: quem acessa é quem está cadastrado como participante do 5S (papel5s). Mantido
    // em sincronia com <Require5S> em App.tsx e com o acesso da API /5s no backend.
    items: [
      { to: "/5s", label: "Resultados", papel5s: TODOS_5S, end: true },
      { to: "/5s/nova", label: "Nova Avaliação", papel5s: ["coordenador", "avaliador"] },
      { to: "/5s/avaliacoes", label: "Avaliações", papel5s: TODOS_5S },
      { to: "/5s/observacoes", label: "Observações da Equipe", papel5s: TODOS_5S },
      {
        label: "Cadastros 5S",
        children: [
          { to: "/5s/cadastros/areas", label: "Áreas e Ambientes", papel5s: ["coordenador"] },
          { to: "/5s/cadastros/perguntas", label: "Perguntas", papel5s: ["coordenador"] },
          { to: "/5s/cadastros/participantes", label: "Participantes", papel5s: ["coordenador"] },
        ],
      },
    ],
    roles: "*",
  },
  {
    label: "Financeiro a Receber",
    items: [
      { to: "/financeiro/contas-a-receber", label: "Contas a Receber" },
      { to: "/financeiro/recebimentos", label: "Recebimentos" },
      { to: "/financeiro/inadimplencia", label: "Inadimplência" },
      { to: "/financeiro/clientes", label: "Clientes" },
      { to: "/financeiro/fluxo-caixa", label: "Fluxo de Caixa" },
      { to: "/financeiro/historico", label: "Histórico" },
    ],
    roles: ["admin"],
  },
  {
    label: "Financeiro a Pagar",
    items: [{ to: "/financeiro/contas-a-pagar", label: "Contas a Pagar" }],
    roles: ["admin"],
  },
  {
    label: "Contábil",
    // Recorte por gestor de departamento reaberto em 28/08/2026 (tabela
    // DepartamentoGrupoContabil, administrada em Administração > Departamento x Grupo
    // Contábil) — o gestor vê a tela com o filtro de grupos já restrito ao(s)
    // departamento(s) dele; o admin continua vendo tudo.
    items: [{ to: "/contabil/resultado-analitico", label: "Resultado Analítico", gestorOuAdmin: true }],
    roles: "*",
  },
  {
    label: "Mercado",
    items: [
      { to: "/mercado/pedidos", label: "Listar Pedidos" },
      { to: "/mercado/analise-faturamento", label: "Análise de Faturamento" },
    ],
    roles: ["admin"],
  },
  {
    label: "Pessoas",
    // Senior HCM (módulo RH): dado sensível (folha, salário individual, rescisão). Admin e gestor do
    // departamento 11 (DHO). O grupo é "*" e cada item traz `gestorDho`, que esconde o grupo inteiro de quem
    // não é um dos dois. Em sincronia com o RequireGestorOuAdmin em App.tsx e com o exigirAdminOuGestorDho
    // de routes/rh/index.ts.
    items: [
      { to: "/rh/quadro", label: "Quadro de Pessoal", gestorDho: true },
      { to: "/rh/folha", label: "Folha de Pagamento", gestorDho: true },
      { to: "/rh/rescisoes", label: "Rescisões", gestorDho: true },
      { to: "/rh/reajustes", label: "Reajustes Salariais", gestorDho: true },
      { to: "/rh/turnover", label: "Turnover", gestorDho: true },
      {
        label: "Jornada",
        children: [
          { to: "/rh/absenteismo", label: "Absenteísmo", gestorDho: true },
          { to: "/rh/ponto", label: "Horas Extras e Banco", gestorDho: true },
          { to: "/rh/jornada", label: "Conformidade de Jornada", gestorDho: true },
        ],
      },
      { to: "/rh/ferias", label: "Férias", gestorDho: true },
      { to: "/rh/dre", label: "DRE de RH", gestorDho: true },
    ],
    roles: "*",
  },
  {
    label: "Administração",
    items: [
      { to: "/admin/usuarios", label: "Usuários" },
      { to: "/admin/sincronizacao", label: "Exportados para o Senior" },
      { to: "/admin/sincronizacao-erp", label: "Importados do ERP" },
      { to: "/admin/sincronizacao-hcm", label: "Importados do HCM" },
      {
        label: "Integração Kyria",
        children: [
          { to: "/admin/sincronizacao-kyria", label: "Sincronização" },
          { to: "/admin/mapeamento-kyria", label: "Mapeamento de Campos" },
        ],
      },
      { to: "/admin/departamento-grupo-contabil", label: "Departamento x Grupo Contábil" },
    ],
    roles: ["admin"],
  },
];

// Ícones do menu (04/11/2026, trazidos da modernização visual do CaxHub_Dash): um ícone lucide por tela (pela rota) e por grupo/sub-menu
// (pelo rótulo). As telas que existem nos dois produtos usam o mesmo ícone do Dash. Sem ícone, o item fica com um espaço do mesmo
// tamanho, alinhado aos outros.
const ICONE_DA_ROTA: Record<string, LucideIcon> = {
  "/": House,
  "/projetos/propostas": FileText,
  "/comercial/metas": LayoutDashboard,
  "/comercial/metas/lancamentos": PencilLine,
  "/comercial/metas/planejamento": CalendarRange,
  "/comercial/metas/indicadores": ListChecks,
  "/projetos/atividades": SquareKanban,
  "/projetos/apontamentos": Clock,
  "/projetos/minhas-acoes": ListTodo,
  "/projetos/meu-plano": Award,
  "/projetos/aprovacoes": CircleCheck,
  "/projetos/alocacao": UsersRound,
  "/projetos/eficiencia": Gauge,
  "/projetos/plano-evolucao": TrendingUp,
  "/projetos/jornadas": CalendarClock,
  "/projetos/auditoria": History,
  "/solicitacoes/nova": CirclePlus,
  "/solicitacoes/minhas": Inbox,
  "/solicitacoes/atendimento": Headset,
  "/solicitacoes/aprovacoes": CircleCheck,
  "/5s": ChartBar,
  "/5s/nova": ClipboardPlus,
  "/5s/avaliacoes": ClipboardList,
  "/5s/observacoes": MessageSquare,
  "/5s/cadastros/areas": MapPin,
  "/5s/cadastros/perguntas": CircleHelp,
  "/5s/cadastros/participantes": Users,
  "/financeiro/contas-a-receber": ReceiptText,
  "/financeiro/recebimentos": Banknote,
  "/financeiro/inadimplencia": CircleAlert,
  "/financeiro/clientes": Users,
  "/financeiro/fluxo-caixa": TrendingUp,
  "/financeiro/historico": History,
  "/financeiro/contas-a-pagar": ReceiptText,
  "/contabil/resultado-analitico": ChartColumn,
  "/mercado/pedidos": ClipboardList,
  "/mercado/analise-faturamento": ChartColumn,
  "/rh/quadro": IdCard,
  "/rh/folha": Wallet,
  "/rh/rescisoes": UserMinus,
  "/rh/reajustes": TrendingUp,
  "/rh/turnover": Repeat,
  "/rh/absenteismo": CalendarX,
  "/rh/ponto": Timer,
  "/rh/jornada": ShieldCheck,
  "/rh/ferias": TreePalm,
  "/rh/dre": Sheet,
  "/admin/usuarios": Users,
  "/admin/sincronizacao": Upload,
  "/admin/sincronizacao-erp": Database,
  "/admin/sincronizacao-hcm": DatabaseZap,
  "/admin/sincronizacao-kyria": RefreshCw,
  "/admin/mapeamento-kyria": Waypoints,
  "/admin/departamento-grupo-contabil": Network,
};
const ICONE_DO_GRUPO: Record<string, LucideIcon> = {
  Comercial: Briefcase,
  "Gestão de Metas": Target,
  "Gestão de Projetos": FolderKanban,
  "Gestão de Solicitações": Plane,
  "Gestão 5S": Sparkles,
  "Cadastros 5S": Settings2,
  "Financeiro a Receber": HandCoins,
  "Financeiro a Pagar": CreditCard,
  Contábil: BookOpen,
  Mercado: Store,
  Pessoas: Users,
  Jornada: Clock,
  Administração: Settings,
  "Integração Kyria": Plug,
};

/** Ícone do menu: mesmo tamanho e traço em todo lugar; sem ícone, um espaço do mesmo tamanho para o texto não desalinhar. */
function IconeMenu({ icone: Icone, pequeno = false }: { icone?: LucideIcon; pequeno?: boolean }) {
  const tamanho = pequeno ? 16 : 18;
  if (!Icone) return <span aria-hidden="true" className="shrink-0" style={{ width: tamanho }} />;
  return <Icone size={tamanho} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />;
}

function Seta({ aberto }: { aberto: boolean }) {
  return (
    <ChevronRight
      size={16}
      strokeWidth={1.75}
      aria-hidden="true"
      className={cn("ml-auto shrink-0 text-muted transition-transform duration-150 motion-reduce:transition-none", aberto && "rotate-90")}
    />
  );
}

// Recuo enxuto (04/11/2026, pedido do Vitor): px-2 + gap-2 + ícone de 16 px. Cada nível do menu desloca ~16 px, como antes dos ícones.
const BASE_ITEM = "flex w-full items-center gap-2 rounded-md px-2 text-sm leading-snug transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Tela (item de topo ou folha): selecionada em verde-escuro; as outras em cinza, escurecendo no hover. */
const classeLink = (folha: boolean) => ({ isActive }: { isActive: boolean }) =>
  cn(
    BASE_ITEM,
    folha ? "py-1.5" : "py-2",
    isActive ? "bg-primary font-medium text-primary-foreground shadow-sm" : "text-muted hover:bg-surface-2 hover:text-foreground"
  );

/** Grupo ou sub-menu: expandido ou com a tela aberta fica em texto escuro; recolhido, cinza. */
const classeGrupo = (destaque: boolean) =>
  cn(BASE_ITEM, "py-2 font-medium", destaque ? "text-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground");

/** Lista de um nível abaixo: linha guia no centro do ícone do pai (px-2 + 16/2 = 16 px) e o filho logo depois dela: ~16 px por nível. */
const SUBLISTA = "ml-[15px] mt-0.5 space-y-0.5 border-l border-border";

/** Menu recolhido (só desktop): botão quadrado só com o ícone. */
const BOTAO_FAIXA = "mx-auto flex h-10 w-10 items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Menu em acordeão (04/11/2026, regra do CaxHub_Dash): abrir um grupo fecha o aberto do mesmo nível (ver menuAcordeao.ts).
const IRMAOS_MENU = irmaosDoMenu(groups.map((g) => ({ label: g.label, subgrupos: g.items.filter(isSubgroup).map((i) => i.label) })));

// Grupo (e sub-menu) que contém a rota atual — o item cujo caminho casa com o endereço (igual
// ou prefixo seguido de "/"), preferindo o mais longo. Rota sem item no menu (ex.: detalhe de
// uma solicitação) não abre nada.
function gruposDaRota(pathname: string): string[] {
  let melhor: { tamanho: number; labels: string[] } | null = null;
  const casa = (to: string) => pathname === to || (to !== "/" && pathname.startsWith(`${to}/`));
  for (const group of groups) {
    for (const item of group.items) {
      const folhas = isSubgroup(item) ? item.children.map((c) => ({ to: c.to, labels: [group.label, item.label] })) : [{ to: item.to, labels: [group.label] }];
      for (const f of folhas) {
        if (casa(f.to) && (!melhor || f.to.length > melhor.tamanho)) melhor = { tamanho: f.to.length, labels: f.labels };
      }
    }
  }
  return melhor?.labels ?? [];
}


interface SidebarProps {
  open: boolean;
  // Estado do drawer mobile (abaixo do breakpoint `lg`) — independente de `open`, que só
  // colapsa/expande o painel de desktop. Ver AppShell.tsx.
  mobileOpen?: boolean;
  // Fecha o drawer mobile ao navegar (clique num link). Sem efeito no desktop — lá não há
  // drawer pra fechar, é só um setState que não muda nada visualmente.
  onNavigate?: () => void;
  /** Menu recolhido (faixa de ícones, desktop): clicar num grupo pede para abrir o menu. */
  onExpandir?: () => void;
}

export function Sidebar({ open, mobileOpen = false, onNavigate, onExpandir }: SidebarProps) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  // Abre o grupo da página atual (no carregamento e a cada navegação), em acordeão: o vizinho do mesmo nível fecha (04/11/2026, regra
  // do CaxHub_Dash; antes os abertos na mão ficavam abertos e o menu crescia). Rota sem item no menu não mexe em nada.
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => abrirCaminho(new Set(), gruposDaRota(pathname), IRMAOS_MENU));
  useEffect(() => {
    const abrir = gruposDaRota(pathname);
    if (abrir.length === 0) return;
    setOpenGroups((prev) => abrirCaminho(prev, abrir, IRMAOS_MENU));
  }, [pathname]);
  const [ehGestorOuAdmin, setEhGestorOuAdmin] = useState(false);
  // Tem Consultor próprio (Consultor.email == o dele) — dinâmico, igual ehGestorOuAdmin,
  // mas admin não precisa disto pra ver nada (já entra por ehGestorOuAdmin).
  const [souConsultor, setSouConsultor] = useState(false);
  // Viaja em alguma solicitação já reservada/finalizada (vem do mesmo /meu-perfil).
  const [souViajante, setSouViajante] = useState(false);
  // Gerencia o departamento 11 (DHO) — vem do mesmo /meu-perfil; admin entra por `user.role`.
  const [ehGestorDho, setEhGestorDho] = useState(false);
  // Gerencia o departamento 2 (Comercial) — vem do mesmo /meu-perfil; admin entra por `user.role`.
  const [ehGestorComercial, setEhGestorComercial] = useState(false);
  // Gerencia a Consultoria ERP ou HCM (DEPEXES_PLANO_EVOLUCAO) — vem do mesmo /meu-perfil; admin entra por `user.role`.
  const [ehGestorConsultoria, setEhGestorConsultoria] = useState(false);
  // Papel no módulo 5S (null = não é participante). Mesma guarda de efeito superado do /meu-perfil.
  const [papel5s, setPapel5s] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelado = false;
    axios
      .get<{ papel: string | null }>("/api/5s/meu-acesso")
      .then(({ data }) => !cancelado && setPapel5s(data.papel))
      .catch(() => !cancelado && setPapel5s(null));
    return () => {
      cancelado = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (user.role === "admin") {
      setEhGestorOuAdmin(true);
      setSouConsultor(false);
      setSouViajante(false);
      setEhGestorDho(true);
      setEhGestorComercial(true);
      setEhGestorConsultoria(true);
      return;
    }
    // Guarda de "efeito superado" (28/08/2026) — mesma classe de corrida já corrigida em
    // AuthContext.tsx (ver interceptor-global-precisa-validar-identidade-da-requisicao):
    // este efeito dispara de novo toda vez que `user` muda (login/logout/troca de conta).
    // Sem isso, a resposta de /meu-perfil de uma sessão ANTERIOR (ex.: um gestor) podia
    // chegar depois de já estar logado como outra pessoa e marcar `ehGestorOuAdmin` errado
    // pra sessão nova — foi assim que o menu Contábil apareceu pro Edson, que não gerencia
    // departamento nenhum.
    let cancelado = false;
    axios
      .get("/api/dashboard/meu-perfil")
      .then(({ data }) => {
        if (cancelado) return;
        setEhGestorOuAdmin((data.departamentosGerenciados ?? []).length > 0);
        setSouConsultor(data.consultor != null);
        setSouViajante(data.viajante === true);
        // Cada item de departamentosGerenciados é um objeto { depexe, depexeLabel, integrantes }, não o número.
        setEhGestorDho((data.departamentosGerenciados ?? []).some((d: { depexe: number }) => d.depexe === DEPEXE_DHO));
        setEhGestorComercial((data.departamentosGerenciados ?? []).some((d: { depexe: number }) => d.depexe === DEPEXE_COMERCIAL));
        setEhGestorConsultoria((data.departamentosGerenciados ?? []).some((d: { depexe: number }) => DEPEXES_PLANO_EVOLUCAO.includes(d.depexe)));
      })
      .catch(() => {
        if (!cancelado) {
          setEhGestorOuAdmin(false);
          setSouConsultor(false);
          setSouViajante(false);
          setEhGestorDho(false);
          setEhGestorComercial(false);
          setEhGestorConsultoria(false);
        }
      });
    return () => {
      cancelado = true;
    };
  }, [user]);

  // `gestorOuAdmin` e `souConsultor` combinam como OU quando um item declara os dois (ex.: Meta
  // diária): item sem nenhuma das duas flags é sempre visível.
  function leafVisivel(item: NavLeaf): boolean {
    if (item.roles && !(user && item.roles.includes(user.role))) return false;
    if (item.papel5s) return !!papel5s && (item.papel5s as string[]).includes(papel5s);
    if (item.gestorDho) return ehGestorDho;
    if (item.gestorComercial) return ehGestorComercial;
    if (item.gestorConsultoria) return ehGestorConsultoria;
    return (
      (!item.gestorOuAdmin && !item.souConsultor && !item.souViajante) ||
      !!(item.gestorOuAdmin && ehGestorOuAdmin) ||
      !!(item.souConsultor && souConsultor) ||
      !!(item.souViajante && souViajante)
    );
  }

  const visibleGroups = groups
    .filter((group) => user && (group.roles === "*" || group.roles.includes(user.role)))
    .map((group) => ({
      ...group,
      items: group.items
        .map((item) => (isSubgroup(item) ? { ...item, children: item.children.filter(leafVisivel) } : item))
        // Sub-menu sem nenhum filho visível some inteiro (mesmo espírito do filtro de grupo
        // vazio logo abaixo, um nível mais fundo).
        .filter((item) => (isSubgroup(item) ? item.children.length > 0 : leafVisivel(item))),
    }))
    // Grupo com `roles: "*"` mas cujo único item (ou todos) é `gestorOuAdmin: true` (ex.:
    // Contábil) fica sem NENHUM item pra quem não é gestor nem admin — sem este filtro, o
    // grupo continuava aparecendo vazio no menu (achado real: Edson via "Contábil" com
    // "Em breve" dentro, 28/08/2026). A visibilidade do GRUPO precisa considerar o resultado
    // do filtro por item, não só o `roles` estático dele.
    .filter((group) => group.items.length > 0);

  // Clique no grupo ou sub-menu: aberto fecha; fechado abre e fecha o vizinho do mesmo nível (acordeão).
  function toggleGroup(label: string) {
    setOpenGroups((prev) => alternarNoAcordeao(prev, label, IRMAOS_MENU));
  }

  // Grupo (ou sub-menu) que contém a tela aberta: fica em destaque, aberto ou não.
  const rotaAtual = new Set(gruposDaRota(pathname));

  const navegacao = (
    <nav
      aria-label="Menu principal"
      className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-3 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      {topLevel.map((item) => (
        <NavLink key={item.to} to={item.to} end className={classeLink(false)} onClick={onNavigate}>
          <IconeMenu icone={ICONE_DA_ROTA[item.to]} pequeno />
          <span className="min-w-0 flex-1 whitespace-normal">{item.label}</span>
        </NavLink>
      ))}

      {visibleGroups.map((group) => {
        const isOpen = openGroups.has(group.label);
        return (
          <div key={group.label}>
            <button type="button" onClick={() => toggleGroup(group.label)} aria-expanded={isOpen} className={classeGrupo(isOpen || rotaAtual.has(group.label))}>
              <IconeMenu icone={ICONE_DO_GRUPO[group.label]} pequeno />
              <span className="min-w-0 flex-1 whitespace-normal text-left">{group.label}</span>
              <Seta aberto={isOpen} />
            </button>
            {/* Sem fallback "Em breve" pra grupo vazio (28/08/2026): `visibleGroups` acima já
                filtra fora qualquer grupo cujos itens zeraram depois do recorte por
                gestorOuAdmin — chegar aqui com `group.items` vazio não acontece mais. */}
            {isOpen && (
              <div className={SUBLISTA}>
                {group.items.map((item) => {
                  if (!isSubgroup(item)) {
                    return (
                      <NavLink key={item.to} to={item.to} end={item.end} className={classeLink(true)} onClick={onNavigate}>
                        <IconeMenu icone={ICONE_DA_ROTA[item.to]} pequeno />
                        <span className="min-w-0 flex-1 whitespace-normal">{item.label}</span>
                      </NavLink>
                    );
                  }
                  // Mesmo mecanismo de collapse dos grupos de topo (openGroups/toggleGroup),
                  // só reaproveitado um nível mais fundo — labels de grupo e sub-menu não
                  // colidem hoje, não precisa de chave composta.
                  const subOpen = openGroups.has(item.label);
                  return (
                    <div key={item.label}>
                      <button
                        type="button"
                        onClick={() => toggleGroup(item.label)}
                        aria-expanded={subOpen}
                        className={classeGrupo(subOpen || rotaAtual.has(item.label))}
                      >
                        <IconeMenu icone={ICONE_DO_GRUPO[item.label]} pequeno />
                        <span className="min-w-0 flex-1 whitespace-normal text-left">{item.label}</span>
                        <Seta aberto={subOpen} />
                      </button>
                      {subOpen && (
                        <div className={SUBLISTA}>
                          {item.children.map((child) => (
                            <NavLink key={child.to} to={child.to} end={child.end} className={classeLink(true)} onClick={onNavigate}>
                              <IconeMenu icone={ICONE_DA_ROTA[child.to]} pequeno />
                              <span className="min-w-0 flex-1 whitespace-normal">{child.label}</span>
                            </NavLink>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );

  // Recolhido (desktop): só os ícones, centralizados. O nome vai na dica (title) e no rótulo acessível. Item de topo navega direto; grupo
  // reabre o menu já com ele aberto.
  const faixa = (
    <nav aria-label="Menu principal (recolhido)" className="min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden py-4">
      {topLevel.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end
          title={item.label}
          aria-label={item.label}
          className={({ isActive }) => cn(BOTAO_FAIXA, isActive ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground")}
        >
          <IconeMenu icone={ICONE_DA_ROTA[item.to]} />
        </NavLink>
      ))}
      {visibleGroups.map((group) => (
        <button
          key={group.label}
          type="button"
          title={group.label}
          aria-label={`${group.label} (abre o menu)`}
          onClick={() => {
            setOpenGroups((prev) => (prev.has(group.label) ? prev : abrirNoAcordeao(prev, group.label, IRMAOS_MENU)));
            onExpandir?.();
          }}
          className={cn(BOTAO_FAIXA, rotaAtual.has(group.label) ? "bg-primary/10 text-primary" : "text-muted hover:bg-surface-2 hover:text-foreground")}
        >
          <IconeMenu icone={ICONE_DO_GRUPO[group.label]} />
        </button>
      ))}
    </nav>
  );

  return (
    // Dois comportamentos no mesmo elemento, um por breakpoint: abaixo de `lg` é um drawer
    // fixo que desliza por transform (`mobileOpen`); a partir de `lg` é o painel `sticky` (preso ao
    // topo, altura da tela), que só colapsa/expande a largura (`open`) — nunca os dois ao
    // mesmo tempo, o breakpoint decide (28/08/2026, ver AppShell.tsx pro backdrop/estado).
    // Recolhido no desktop (04/11/2026, como no CaxHub_Dash): em vez de sumir, vira uma faixa de ícones de 64 px.
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex h-dvh w-64 flex-none flex-col overflow-hidden border-r border-border bg-surface transition-transform duration-200 motion-reduce:transition-none lg:sticky lg:top-0 lg:z-auto lg:translate-x-0 lg:transition-[width]",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        open ? "lg:w-60" : "lg:w-16"
      )}
    >
      <div className={cn("flex h-16 flex-none items-center border-b border-border px-5", !open && "lg:justify-center lg:px-0")}>
        <img src="/marca/icone-128.png" alt="CaxHub" className={cn("h-8 w-8 flex-none rounded-lg", open ? "mr-2.5" : "mr-2.5 lg:mr-0")} />
        <p className={cn("whitespace-nowrap font-display text-lg font-bold text-foreground", !open && "lg:hidden")}>CaxHub</p>
      </div>
      {/* Rolagem própria (12/10/2026): no celular a gaveta é `fixed` com overflow-hidden e a altura da tela; sem
          `overflow-y-auto` + `min-h-0` o que passa da tela era cortado e os últimos itens de um grupo aberto (ex.:
          Pessoas) ficavam inalcançáveis. `h-dvh` acompanha a barra do navegador do celular; o respiro embaixo
          cobre a barra home do iPhone. No desktop (`lg:`) o painel é `sticky` com a altura da tela: fica parado
          enquanto a página rola e só o menu rola dentro dele (a pedido, 12/10/2026). Recolhido, só no desktop: a
          gaveta do celular mostra sempre o menu completo. */}
      {open ? (
        navegacao
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col lg:hidden">{navegacao}</div>
          <div className="hidden min-h-0 flex-1 flex-col lg:flex">{faixa}</div>
        </>
      )}
    </aside>
  );
}
