import axios from "axios";
import { useEffect, useState } from "react";
import { estaNoApp } from "../../lib/desktop";
import { Skeleton } from "../ui/Skeleton";
import { useToast } from "../ui/Toast";

// Seção "Janela flutuante" do Meu perfil: opções do CaxHub Desktop por usuário e os computadores
// onde ele está conectado. Só aparece pra quem tem consultor vinculado (o backend responde 403
// pra os demais e a seção some). Cada interruptor salva na hora, sem botão "Salvar".

interface Preferencias {
  abrirAoIniciar: boolean;
  sempreNoTopo: boolean;
  alertasJornada: boolean;
  frequenciaAvisoMin: number;
  modoInicial: "pilula" | "expandida";
}

interface Dispositivo {
  id: number;
  nome: string;
  criadoEm: string;
  ultimoUsoEm: string;
}

const URL_INSTALADOR = "/downloads/CaxHub-Desktop-Setup.exe";

// Frequência do aviso "no horário da jornada e sem atividade em execução"; 0 desliga.
const FREQUENCIAS_AVISO: { valor: number; rotulo: string }[] = [
  { valor: 0, rotulo: "Não avisar" },
  { valor: 5, rotulo: "A cada 5 minutos" },
  { valor: 10, rotulo: "A cada 10 minutos" },
  { valor: 15, rotulo: "A cada 15 minutos" },
  { valor: 20, rotulo: "A cada 20 minutos" },
  { valor: 30, rotulo: "A cada 30 minutos" },
  { valor: 45, rotulo: "A cada 45 minutos" },
  { valor: 60, rotulo: "A cada hora" },
  { valor: 120, rotulo: "A cada 2 horas" },
];

const OPCOES: { campo: "abrirAoIniciar" | "sempreNoTopo" | "alertasJornada"; titulo: string; ajuda: string }[] = [
  { campo: "abrirAoIniciar", titulo: "Abrir ao iniciar o Windows", ajuda: "A janela sobe sozinha quando você liga o computador." },
  { campo: "sempreNoTopo", titulo: "Sempre no topo", ajuda: "Fica por cima das outras janelas, para você nunca perder o tempo." },
  {
    campo: "alertasJornada",
    titulo: "Alertas de jornada",
    ajuda:
      "Notificação do Windows quando uma atividade em execução é parada fora da janela (no navegador, por exemplo), quando o expediente ou o teto de horas acabar e quando você está no horário de trabalho sem atividade em execução.",
  },
];

function formatarData(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function JanelaFlutuanteConfig() {
  const { mostrar } = useToast();
  const [prefs, setPrefs] = useState<Preferencias | null>(null);
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [semAcesso, setSemAcesso] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    Promise.all([axios.get("/api/desktop/preferencias"), axios.get("/api/desktop/dispositivos")])
      .then(([p, d]) => {
        if (cancelado) return;
        setPrefs(p.data);
        setDispositivos(d.data.dispositivos);
      })
      .catch((err) => {
        if (!cancelado && err.response?.status === 403) setSemAcesso(true);
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  async function alterar(patch: Partial<Preferencias>) {
    if (!prefs) return;
    const anterior = prefs;
    setPrefs({ ...prefs, ...patch });
    setSalvando(true);
    try {
      const { data } = await axios.put("/api/desktop/preferencias", patch);
      setPrefs(data);
    } catch (err: any) {
      setPrefs(anterior);
      mostrar(err.response?.data?.error ?? "Falha ao salvar a opção", "destructive");
    } finally {
      setSalvando(false);
    }
  }

  async function desconectar(id: number) {
    try {
      await axios.delete(`/api/desktop/dispositivos/${id}`);
      setDispositivos((atual) => atual.filter((d) => d.id !== id));
      mostrar("Computador desconectado", "success");
    } catch (err: any) {
      mostrar(err.response?.data?.error ?? "Falha ao desconectar", "destructive");
    }
  }

  if (semAcesso) return null;
  if (carregando) return <Skeleton className="h-64 rounded-lg" />;
  if (!prefs) return null;

  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h2 className="mb-1 font-display text-base font-semibold text-foreground">Janela flutuante (CaxHub Desktop)</h2>
      <p className="mb-4 text-sm text-muted">
        Uma janela compacta, sempre à vista, com o cronômetro da atividade em andamento e os botões Iniciar e Parar. Instale o
        CaxHub Desktop no seu computador para usar.
      </p>

      {!estaNoApp() && (
        <div className="mb-5">
          <a
            href={URL_INSTALADOR}
            download
            className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Baixar instalador para Windows
          </a>
          <p className="mt-2 text-xs text-muted">
            Na primeira vez o Windows pode mostrar "O Windows protegeu o computador": clique em "Mais informações" e depois em
            "Executar assim mesmo". Não precisa ser administrador.
          </p>
        </div>
      )}

      <div className="divide-y divide-border">
        {OPCOES.map((o) => (
          <label key={o.campo} className="flex cursor-pointer items-start gap-3 py-3">
            <input
              type="checkbox"
              checked={prefs[o.campo]}
              disabled={salvando}
              onChange={(e) => void alterar({ [o.campo]: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span>
              <span className="block text-sm font-medium text-foreground">{o.titulo}</span>
              <span className="block text-xs text-muted">{o.ajuda}</span>
            </span>
          </label>
        ))}
        <div className="flex items-center justify-between gap-3 py-3">
          <span>
            <span className={`block text-sm font-medium ${prefs.alertasJornada ? "text-foreground" : "text-muted"}`}>
              Avisar quando não houver atividade em execução
            </span>
            <span className="block text-xs text-muted">
              Só dentro do horário da sua jornada, e repete enquanto continuar sem atividade. A contagem recomeça sempre que
              você para ou inicia uma atividade.
            </span>
          </span>
          <select
            value={FREQUENCIAS_AVISO.some((f) => f.valor === prefs.frequenciaAvisoMin) ? prefs.frequenciaAvisoMin : 15}
            disabled={salvando || !prefs.alertasJornada}
            onChange={(e) => void alterar({ frequenciaAvisoMin: Number(e.target.value) })}
            className="flex-none rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {FREQUENCIAS_AVISO.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.rotulo}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between gap-3 py-3">
          <span>
            <span className="block text-sm font-medium text-foreground">Como a janela abre</span>
            <span className="block text-xs text-muted">Na primeira vez em cada computador. Depois ela lembra do último modo.</span>
          </span>
          <select
            value={prefs.modoInicial}
            disabled={salvando}
            onChange={(e) => void alterar({ modoInicial: e.target.value as Preferencias["modoInicial"] })}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="expandida">Expandida</option>
            <option value="pilula">Só o cronômetro</option>
          </select>
        </div>
      </div>

      <h3 className="mb-2 mt-5 text-sm font-medium text-foreground">Computadores conectados</h3>
      {dispositivos.length === 0 ? (
        <p className="text-xs text-muted">Nenhum computador conectado ainda.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {dispositivos.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm text-foreground">{d.nome}</span>
                <span className="block text-xs text-muted">Último uso: {formatarData(d.ultimoUsoEm)}</span>
              </span>
              <button
                type="button"
                onClick={() => void desconectar(d.id)}
                className="flex-none rounded-md border border-border px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Desconectar
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
