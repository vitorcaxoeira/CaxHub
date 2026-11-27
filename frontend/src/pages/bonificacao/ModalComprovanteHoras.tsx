import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { TabelaLocal } from "../../components/colunas/TabelaLocal";
import type { ColunaLocal } from "../../components/colunas/aplicarLocal";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";
import { Modal } from "../../components/ui/Modal";
import { fmtCompetencia, fmtHorasMinutos } from "./comum";

// Comprovação de uma célula de Horas Kyria x Trabalhadas: os lançamentos que formam as horas trabalhadas, o banco de horas ou as horas do
// Kyria do atendente no mês (GET /bonificacao/relatorios/horas-kyria/comprovante, com os mesmos filtros do cálculo).

export type TipoComprovante = "ponto" | "banco" | "kyria";

export interface PedidoDeComprovante {
  tipo: TipoComprovante;
  codemp: number;
  codfor: number;
  consultor: string;
  competencia: string;
  /** O número clicado na tela, em minutos: o modal avisa se a soma das linhas não bater com ele. */
  minutosNaTela: number;
}

export interface LinhaPonto {
  data: string;
  codsit: number;
  situacao: string | null;
  minutos: number;
}
export interface LinhaBanco {
  data: string;
  banco: number;
  codsit: number;
  situacao: string | null;
  origem: string | null;
  minutos: number;
  acumulado: number;
}
export interface LinhaKyria {
  id: string;
  inicio: string;
  fim: string | null;
  minutos: number;
  chamado: string | null;
  titulo: string;
  time: string;
  area: string;
  origem: string;
  motivo: string | null;
}

export type Comprovante =
  | { tipo: "ponto"; linhas: LinhaPonto[] }
  | { tipo: "banco"; linhas: LinhaBanco[]; banco: { creditos: number; debitos: number; saldo: number; extras: number } }
  | { tipo: "kyria"; linhas: LinhaKyria[] };

const TITULOS: Record<TipoComprovante, string> = { ponto: "Horas trabalhadas", banco: "Banco de horas", kyria: "Horas Kyria" };
const ORIGEM_KYRIA: Record<string, string> = { automatic: "Automático", manual: "Manual" };

const dataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const fmtDataHora = (iso: string | null) => (iso ? dataHora.format(new Date(iso)) : "—");
// Data pura "AAAA-MM-DD": sem passar por Date, para o fuso não mudar o dia.
const fmtDia = (v: string) => v.split("-").reverse().join("/");
const fmtMin = (v: unknown) => fmtHorasMinutos(Number(v));

const mono = "font-mono text-[12.5px] tabular-nums text-foreground";
const texto = (v: string | null) => <span className="block truncate">{v ?? "—"}</span>;

function colunaData<T extends { data: string }>(): DefColuna<T> {
  return { nome: "data", titulo: "Data", fixa: true, largura: 110, classe: mono, render: (l) => fmtDia(l.data) };
}
function colunaMinutos<T extends { minutos: number }>(titulo: string): DefColuna<T> {
  return { nome: "minutos", titulo, direita: true, largura: 100, classe: mono, formatarValor: fmtMin, formatarResumo: fmtMin, render: (l) => fmtHorasMinutos(l.minutos) };
}
function colunaSituacao<T extends { codsit: number; situacao: string | null }>(): DefColuna<T>[] {
  return [
    { nome: "codsit", titulo: "Cód.", direita: true, largura: 70, classe: "font-mono text-[12.5px] tabular-nums text-muted", resumos: ["contagem"], render: (l) => l.codsit },
    { nome: "situacao", titulo: "Situação", largura: 240, classe: "text-sm text-foreground", texto: (l) => l.situacao, render: (l) => texto(l.situacao) },
  ];
}

const COLUNAS_PONTO: DefColuna<LinhaPonto>[] = [colunaData<LinhaPonto>(), ...colunaSituacao<LinhaPonto>(), colunaMinutos<LinhaPonto>("Horas")];

const COLUNAS_BANCO: DefColuna<LinhaBanco>[] = [
  colunaData<LinhaBanco>(),
  { nome: "banco", titulo: "Banco", direita: true, largura: 80, classe: "font-mono text-[12.5px] tabular-nums text-muted", resumos: ["contagem"], render: (l) => l.banco },
  ...colunaSituacao<LinhaBanco>(),
  { nome: "origem", titulo: "Origem", centro: true, largura: 80, classe: "font-mono text-[12.5px] text-muted", render: (l) => l.origem ?? "—" },
  {
    nome: "minutos",
    titulo: "Horas",
    direita: true,
    largura: 100,
    dica: "Crédito positivo, débito negativo",
    classe: mono,
    formatarValor: fmtMin,
    formatarResumo: fmtMin,
    render: (l) => <span className={l.minutos < 0 ? "text-destructive" : undefined}>{fmtHorasMinutos(l.minutos)}</span>,
  },
  { nome: "acumulado", titulo: "Acumulado no mês", direita: true, largura: 130, dica: "Soma dos movimentos do mês até esta linha, sem o saldo anterior", classe: mono, formatarValor: fmtMin, resumos: [], render: (l) => fmtHorasMinutos(l.acumulado) },
];

const COLUNAS_KYRIA: DefColuna<LinhaKyria>[] = [
  { nome: "inicio", titulo: "Início", fixa: true, largura: 130, classe: mono, render: (l) => fmtDataHora(l.inicio) },
  { nome: "fim", titulo: "Fim", largura: 130, classe: "font-mono text-[12.5px] tabular-nums text-muted", render: (l) => fmtDataHora(l.fim) },
  colunaMinutos<LinhaKyria>("Horas"),
  { nome: "chamado", titulo: "Chamado", largura: 110, classe: mono, render: (l) => l.chamado ?? "—" },
  { nome: "titulo", titulo: "Título", largura: 280, classe: "text-sm text-foreground", texto: (l) => l.titulo, render: (l) => texto(l.titulo) },
  { nome: "time", titulo: "Time", largura: 140, classe: "text-sm text-muted", texto: (l) => l.time, render: (l) => texto(l.time) },
  { nome: "area", titulo: "Área", largura: 200, classe: "text-sm text-muted", texto: (l) => l.area, render: (l) => texto(l.area) },
  { nome: "origem", titulo: "Apontamento", largura: 110, classe: "text-[12.5px] text-muted", formatarValor: (v) => ORIGEM_KYRIA[String(v)] ?? String(v), render: (l) => ORIGEM_KYRIA[l.origem] ?? l.origem },
  { nome: "motivo", titulo: "Motivo", largura: 220, classe: "text-[12.5px] text-muted", texto: (l) => l.motivo, render: (l) => texto(l.motivo) },
];

const LOCAIS_PONTO: ColunaLocal[] = [
  { nome: "data", tipo: "data", obrigatoria: true, utc: true },
  { nome: "codsit", tipo: "inteiro", obrigatoria: true },
  { nome: "situacao", tipo: "texto" },
  { nome: "minutos", tipo: "inteiro" },
];
const LOCAIS_BANCO: ColunaLocal[] = [...LOCAIS_PONTO, { nome: "banco", tipo: "inteiro", obrigatoria: true }, { nome: "origem", tipo: "texto" }, { nome: "acumulado", tipo: "inteiro" }];
const LOCAIS_KYRIA: ColunaLocal[] = [
  { nome: "inicio", tipo: "data", obrigatoria: true },
  { nome: "fim", tipo: "data" },
  { nome: "minutos", tipo: "decimal" },
  { nome: "chamado", tipo: "texto" },
  { nome: "titulo", tipo: "texto", obrigatoria: true },
  { nome: "time", tipo: "texto", obrigatoria: true },
  { nome: "area", tipo: "texto", obrigatoria: true },
  { nome: "origem", tipo: "texto", obrigatoria: true },
  { nome: "motivo", tipo: "texto" },
];

const somaDe = (linhas: { minutos: number }[]) => linhas.reduce((s, l) => s + l.minutos, 0);

/** Subtítulo do modal: quantos lançamentos e a soma; no banco, créditos, débitos, saldo e se entrou no cálculo. */
export function resumoDoComprovante(c: Comprovante): string {
  if (c.tipo === "banco") {
    const { creditos, debitos, saldo } = c.banco;
    const entrou = saldo > 0 ? "entrou como extra" : saldo < 0 ? "saldo negativo: não entrou no cálculo" : "saldo zerado: nada a somar";
    return `${c.linhas.length} lançamento(s) no mês · créditos ${fmtHorasMinutos(creditos)} · débitos ${fmtHorasMinutos(-debitos)} · saldo ${fmtHorasMinutos(saldo)} (${entrou})`;
  }
  const unidade = c.tipo === "kyria" ? "apontamento(s)" : "dia(s)";
  const quantidade = c.tipo === "kyria" ? c.linhas.length : new Set(c.linhas.map((l) => l.data)).size;
  return `${quantidade} ${unidade} · total ${fmtHorasMinutos(somaDe(c.linhas))}`;
}

/** A soma das linhas difere do número que estava na tela (a base mudou depois de a lista carregar)? Compara em minutos inteiros, como a tela mostra. */
export function divergeDaTela(c: Comprovante, minutosNaTela: number): boolean {
  const soma = c.tipo === "banco" ? c.banco.saldo : somaDe(c.linhas);
  return Math.round(soma) !== Math.round(minutosNaTela);
}

/** Tabela do comprovante (sem a busca): separada para o teste. */
export function TabelaComprovante({ comprovante }: { comprovante: Comprovante }) {
  if (comprovante.tipo === "ponto") {
    return (
      <TabelaLocal<LinhaPonto>
        key="ponto"
        chave="bonificacao.horas-kyria.comprovante-ponto"
        defs={COLUNAS_PONTO}
        colunas={LOCAIS_PONTO}
        linhas={comprovante.linhas}
        chaveLinha={(l) => `${l.data}-${l.codsit}`}
        paginacao={{ inicial: 50, rotulo: "lançamentos" }}
        vazio="Nenhuma hora trabalhada no ponto neste mês."
      />
    );
  }
  if (comprovante.tipo === "banco") {
    return (
      <TabelaLocal<LinhaBanco>
        key="banco"
        chave="bonificacao.horas-kyria.comprovante-banco"
        defs={COLUNAS_BANCO}
        colunas={LOCAIS_BANCO}
        linhas={comprovante.linhas}
        chaveLinha={(l, i) => `${l.data}-${l.banco}-${l.codsit}-${l.origem}-${i}`}
        paginacao={{ inicial: 50, rotulo: "lançamentos" }}
        vazio="Nenhum lançamento no banco de horas neste mês."
      />
    );
  }
  return (
    <TabelaLocal<LinhaKyria>
      key="kyria"
      chave="bonificacao.horas-kyria.comprovante-kyria"
      defs={COLUNAS_KYRIA}
      colunas={LOCAIS_KYRIA}
      linhas={comprovante.linhas}
      chaveLinha={(l) => l.id}
      paginacao={{ inicial: 25, rotulo: "apontamentos" }}
      vazio="Nenhum apontamento no Kyria neste mês."
    />
  );
}

export function ModalComprovanteHoras({ pedido, onFechar }: { pedido: PedidoDeComprovante; onFechar: () => void }) {
  const [comprovante, setComprovante] = useState<Comprovante | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let atual = true;
    setComprovante(null);
    setErro(null);
    const { tipo, competencia, codemp, codfor } = pedido;
    axios
      .get("/api/bonificacao/relatorios/horas-kyria/comprovante", { params: { tipo, competencia, codemp, codfor } })
      .then(({ data }) => atual && setComprovante(data as Comprovante))
      .catch((e) => atual && setErro(e.response?.data?.error ?? "Falha ao carregar o comprovante"));
    return () => {
      atual = false;
    };
  }, [pedido]);

  const subtitulo = useMemo(() => (comprovante ? resumoDoComprovante(comprovante) : undefined), [comprovante]);

  return (
    <Modal open onClose={onFechar} title={`${TITULOS[pedido.tipo]} · ${pedido.consultor} · ${fmtCompetencia(pedido.competencia)}`} subtitulo={subtitulo} className={pedido.tipo === "kyria" ? "max-w-6xl" : "max-w-4xl"}>
      {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}
      {!erro && !comprovante && <p className="text-sm text-muted">Carregando lançamentos...</p>}
      {comprovante && divergeDaTela(comprovante, pedido.minutosNaTela) && (
        <p className="mb-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
          A soma destes lançamentos não bate com o número da lista ({fmtHorasMinutos(pedido.minutosNaTela)}). Os dados podem ter sido sincronizados depois que a lista carregou: atualize a página.
        </p>
      )}
      {comprovante && <TabelaComprovante comprovante={comprovante} />}
    </Modal>
  );
}
