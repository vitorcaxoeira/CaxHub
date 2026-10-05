import axios from "axios";
import { useEffect, useState } from "react";
import { SelectBuscavel } from "../../components/ui/SelectBuscavel";
import { useToast } from "../../components/ui/Toast";

interface ConsultorOpcao {
  codemp: number;
  codfor: number;
  nome: string;
  depexeLabel: string | null;
}

interface DiaJornada {
  diaSemana: number;
  manhaInicio: number | null;
  manhaFim: number | null;
  tardeInicio: number | null;
  tardeFim: number | null;
  cadastrado: boolean;
}

// Mesmo teto do backend (MAX_DIAS_RETROATIVOS em domain/janelaRetroativa.ts).
const MAX_DIAS_RETROATIVOS = 30;

const NOMES_DIA =["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

// A jornada é guardada em MINUTOS desde a meia-noite (convenção de RatItem.horini) e o
// <input type="time"> fala "HH:MM" — estas duas funções são a fronteira entre os dois.
function paraInputHora(minutos: number | null): string {
  if (minutos == null) return "";
  return `${String(Math.trunc(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}

function paraMinutos(valor: string): number | null {
  if (!valor) return null;
  const [h, m] = valor.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

// Modelo mais comum, oferecido como atalho: preencher 5 dias × 4 campos na mão a cada
// consultor é o tipo de tarefa que faz o cadastro nunca sair do papel.
const PADRAO_COMERCIAL = { manhaInicio: 8 * 60, manhaFim: 12 * 60, tardeInicio: 13 * 60 + 30, tardeFim: 18 * 60 };

const CAMPOS: { chave: keyof Omit<DiaJornada, "diaSemana" | "cadastrado">; rotulo: string }[] = [
  { chave: "manhaInicio", rotulo: "Manhã de" },
  { chave: "manhaFim", rotulo: "até" },
  { chave: "tardeInicio", rotulo: "Tarde de" },
  { chave: "tardeFim", rotulo: "até" },
];

// Jornada de trabalho por consultor ("Meta diária" na tela). Existe pra alimentar a parada
// automática de execução: sem ela, um card esquecido "Em Andamento" na sexta à noite conta o
// fim de semana inteiro. Mantida pelo gestor do departamento pra qualquer um do time, e por
// qualquer consultor pra si mesmo — a rota recusa quem não é nem uma coisa nem outra.
export function Jornadas() {
  const toast = useToast();
  const [consultores, setConsultores] = useState<ConsultorOpcao[]>([]);
  const [codforSelecionado, setCodforSelecionado] = useState<number | null>(null);
  const [dias, setDias] = useState<DiaJornada[]>([]);
  const [loading, setLoading] = useState(true);
  const [carregandoDias, setCarregandoDias] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Janela de retroatividade dos pedidos de apontamento/ajuste. Texto, e não número, pra o campo
  // poder ficar vazio enquanto se digita; `diasRetroativosSalvo` é o que está gravado no servidor.
  const [diasRetroativos, setDiasRetroativos] = useState("0");
  const [diasRetroativosSalvo, setDiasRetroativosSalvo] = useState(0);
  const [podeEditarRetroativo, setPodeEditarRetroativo] = useState(false);
  const [salvandoRetroativo, setSalvandoRetroativo] = useState(false);

  useEffect(() => {
    axios
      .get("/api/jornadas/consultores")
      .then(({ data }) => {
        const lista: ConsultorOpcao[] = data.consultores;
        setConsultores(lista);
        // Consultor comum só vê a si mesmo nesta lista (acesso liberado só ao próprio
        // usuário) — sem escolha real a fazer, então já entra selecionado.
        if (lista.length === 1) setCodforSelecionado(lista[0].codfor);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar os consultores"))
      .finally(() => setLoading(false));
  }, []);

  const selecionado = consultores.find((c) => c.codfor === codforSelecionado) ?? null;

  useEffect(() => {
    if (!selecionado) {
      setDias([]);
      return;
    }
    setCarregandoDias(true);
    axios
      .get(`/api/jornadas/${selecionado.codemp}/${selecionado.codfor}`)
      .then(({ data }) => {
        setDias(data.dias);
        setDiasRetroativos(String(data.diasRetroativos ?? 0));
        setDiasRetroativosSalvo(data.diasRetroativos ?? 0);
        setPodeEditarRetroativo(data.podeEditarRetroativo === true);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar a jornada"))
      .finally(() => setCarregandoDias(false));
  }, [selecionado?.codemp, selecionado?.codfor]);

  function alterarCampo(diaSemana: number, chave: keyof Omit<DiaJornada, "diaSemana" | "cadastrado">, valor: string) {
    setDias((atual) => atual.map((d) => (d.diaSemana === diaSemana ? { ...d, [chave]: paraMinutos(valor) } : d)));
  }

  function aplicarPadraoComercial() {
    setDias((atual) =>
      atual.map((d) => (d.diaSemana >= 1 && d.diaSemana <= 5 ? { ...d, ...PADRAO_COMERCIAL } : { ...d, manhaInicio: null, manhaFim: null, tardeInicio: null, tardeFim: null }))
    );
  }

  function limparTudo() {
    setDias((atual) => atual.map((d) => ({ ...d, manhaInicio: null, manhaFim: null, tardeInicio: null, tardeFim: null })));
  }

  async function salvar() {
    if (!selecionado) return;
    setSalvando(true);
    setErro(null);
    try {
      await axios.put(`/api/jornadas/${selecionado.codemp}/${selecionado.codfor}`, { dias });
      toast.mostrar(`Jornada de ${selecionado.nome} salva.`, "success");
    } catch (err) {
      const mensagem = axios.isAxiosError(err) ? err.response?.data?.error : null;
      setErro(mensagem ?? "Falha ao salvar a jornada");
    } finally {
      setSalvando(false);
    }
  }

  async function salvarRetroativo() {
    if (!selecionado) return;
    const valor = Number(diasRetroativos);
    if (diasRetroativos.trim() === "" || !Number.isInteger(valor) || valor < 0 || valor > MAX_DIAS_RETROATIVOS) {
      setErro(`Informe um número inteiro de 0 a ${MAX_DIAS_RETROATIVOS} dias úteis.`);
      return;
    }
    setSalvandoRetroativo(true);
    setErro(null);
    try {
      await axios.put(`/api/jornadas/${selecionado.codemp}/${selecionado.codfor}/dias-retroativos`, { diasRetroativos: valor });
      setDiasRetroativosSalvo(valor);
      toast.mostrar(
        valor === 0
          ? `${selecionado.nome} só poderá pedir apontamento e ajuste para o dia de hoje.`
          : `${selecionado.nome} poderá pedir apontamento e ajuste até ${valor} ${valor === 1 ? "dia útil" : "dias úteis"} para trás.`,
        "success"
      );
    } catch (err) {
      const mensagem = axios.isAxiosError(err) ? err.response?.data?.error : null;
      setErro(mensagem ?? "Falha ao salvar os dias retroativos");
    } finally {
      setSalvandoRetroativo(false);
    }
  }

  const semJornada = dias.length > 0 && dias.every((d) => !d.cadastrado);

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Gestão de Projetos · Meta diária</p>
      <h1 className="mt-1 font-display text-2xl font-bold text-foreground">Meta diária</h1>
      <p className="mt-1 text-sm text-muted">
        Define até que horas uma atividade em andamento pode contar. Card esquecido em execução é parado automaticamente no
        fim do expediente do dia — quem não tem jornada aqui só é parado pelo teto de horas.
      </p>

      {erro && (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SelectBuscavel
          // O SelectBuscavel agrupa por `grupo` — aqui o departamento serve bem, porque é
          // como o gestor pensa o time dele.
          opcoes={consultores.map((c) => ({
            value: c.codfor,
            grupo: c.depexeLabel ?? "Sem departamento",
            rotulo: c.nome,
          }))}
          valor={codforSelecionado}
          onChange={setCodforSelecionado}
          placeholder={loading ? "Carregando consultores..." : "Escolha o consultor..."}
          textoVazio="Nenhum consultor nos departamentos que você gerencia"
          desabilitado={loading}
          className="w-72"
        />
        {selecionado && (
          <>
            <button
              onClick={aplicarPadraoComercial}
              className="rounded-md border border-border px-3 py-1.5 text-[12.5px] text-muted hover:bg-surface-2 hover:text-foreground"
            >
              Aplicar 8:00–12:00 / 13:30–18:00 (seg a sex)
            </button>
            <button
              onClick={limparTudo}
              className="rounded-md border border-border px-3 py-1.5 text-[12.5px] text-muted hover:bg-surface-2 hover:text-foreground"
            >
              Limpar
            </button>
          </>
        )}
      </div>

      {selecionado && semJornada && !carregandoDias && (
        <p className="mt-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">
          {selecionado.nome} ainda não tem jornada cadastrada — as atividades dele não são paradas por fim de expediente.
        </p>
      )}

      {selecionado && (
        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="whitespace-nowrap bg-surface-2 px-2.5 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Dia
                  </th>
                  {CAMPOS.map((c, i) => (
                    <th
                      key={c.chave}
                      className={`whitespace-nowrap bg-surface-2 px-2.5 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted ${
                        i === 2 ? "border-l border-border" : ""
                      }`}
                    >
                      {c.rotulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {carregandoDias && (
                  <tr>
                    <td colSpan={5} className="px-2.5 py-6 text-center text-sm text-muted">
                      Carregando...
                    </td>
                  </tr>
                )}
                {!carregandoDias &&
                  dias.map((dia) => (
                    <tr key={dia.diaSemana} className="border-t border-border/60">
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-sm text-foreground">{NOMES_DIA[dia.diaSemana]}</td>
                      {CAMPOS.map((campo, i) => (
                        <td key={campo.chave} className={`px-2.5 py-1.5 ${i === 2 ? "border-l border-border" : ""}`}>
                          <input
                            type="time"
                            value={paraInputHora(dia[campo.chave])}
                            onChange={(e) => alterarCampo(dia.diaSemana, campo.chave, e.target.value)}
                            className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2.5">
            {/* Dia com os quatro campos vazios não vira folga: ele deixa de ter jornada, e
                a parada por expediente não se aplica. É a mesma distinção que o backend faz
                ao não gravar linha nenhuma pra esse dia. */}
            <p className="text-[12px] text-muted">Dia com todos os campos vazios fica sem jornada — não é parado por expediente.</p>
            <button
              onClick={salvar}
              disabled={salvando}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {salvando ? "Salvando..." : "Salvar jornada"}
            </button>
          </div>
        </div>
      )}

      {/* Janela de retroatividade: por ordem da Diretoria o consultor só pede apontamento/ajuste
          para hoje; aqui o líder (ou o admin) abre uma exceção por consultor. O próprio consultor
          vê o valor, mas não edita — o backend recusa com 403. Botão próprio, independente do
          "Salvar jornada" acima: são duas configurações sem relação. */}
      {selecionado && !carregandoDias && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Apontamento retroativo</p>
          <p className="mt-1 text-sm text-muted">
            Dias úteis (seg a sex) antes de hoje em que {selecionado.nome} ainda pode pedir apontamento avulso ou ajuste de
            horário. <span className="text-foreground">0 = só o dia de hoje.</span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              type="number"
              min={0}
              max={MAX_DIAS_RETROATIVOS}
              step={1}
              value={diasRetroativos}
              onChange={(e) => setDiasRetroativos(e.target.value)}
              disabled={!podeEditarRetroativo}
              aria-label="Dias úteis retroativos permitidos"
              className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            />
            <span className="text-sm text-muted">dias úteis</span>
            {podeEditarRetroativo && (
              <button
                onClick={salvarRetroativo}
                disabled={salvandoRetroativo || diasRetroativos === String(diasRetroativosSalvo)}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {salvandoRetroativo ? "Salvando..." : "Salvar"}
              </button>
            )}
          </div>
          {!podeEditarRetroativo && (
            <p className="mt-2 text-[12px] text-muted">
              Só o líder do seu departamento ou um administrador podem alterar este valor.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
