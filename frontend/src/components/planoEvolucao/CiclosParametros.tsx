import axios from "axios";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { CicloDto, CiclosResposta, dataBr, rotuloStatusCiclo } from "../../lib/planoEvolucao";
import { Cartao, Chip, Vazio } from "../eficiencia/comum";

const campo =
  "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
const botaoSecundario =
  "rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const botaoPrimario =
  "rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

interface Form {
  metaEficienciaGlobal: string;
  departamentosArea: number[];
  amostraMinimaHoras: string;
  definicaoOnline: "A" | "B";
  notaMinimaEficienciaIndividual: string;
  naoApuradoQuebraSequencia: boolean;
  certificacoesExigidas: string;
  atividadesElegiveisClientes: string;
  corteEvidencias: string;
  apuracaoAte: string;
  devolutivaEm: string;
  contestacaoAte: string;
  indicadores: { chave: string; peso: string; meta: string; ativo: boolean }[];
}

const doCiclo = (c: CicloDto): Form => ({
  metaEficienciaGlobal: c.metaEficienciaGlobal != null ? String(c.metaEficienciaGlobal) : "",
  departamentosArea: c.departamentosArea,
  amostraMinimaHoras: String(c.amostraMinimaHoras),
  definicaoOnline: c.definicaoOnline,
  notaMinimaEficienciaIndividual: String(c.notaMinimaEficienciaIndividual),
  naoApuradoQuebraSequencia: c.naoApuradoQuebraSequencia,
  certificacoesExigidas: c.certificacoesExigidas ?? "",
  atividadesElegiveisClientes: c.atividadesElegiveisClientes ?? "",
  corteEvidencias: c.corteEvidencias,
  apuracaoAte: c.apuracaoAte,
  devolutivaEm: c.devolutivaEm,
  contestacaoAte: c.contestacaoAte,
  indicadores: c.indicadores.map((i) => ({ chave: i.chave, peso: String(i.peso), meta: i.meta != null ? String(i.meta) : "", ativo: i.ativo })),
});

const toneDoStatus = { rascunho: "warn", publicado: "ok", encerrado: "off" } as const;

// Ciclos e parâmetros do item 12 do regulamento. Só o administrador edita; o gestor lê. Ciclo publicado fica TRAVADO (o regulamento proíbe
// mudar parâmetro com o ciclo em andamento), então a tela mostra só leitura e o servidor também recusa a edição.
export function CiclosParametros({ dados, podeEditar, selecionadoId, onSelecionar, onMudou }: { dados: CiclosResposta; podeEditar: boolean; selecionadoId: number | null; onSelecionar: (id: number) => void; onMudou: () => void }) {
  const { mostrar } = useToast();
  const ciclo = dados.ciclos.find((c) => c.id === selecionadoId) ?? dados.ciclos[0] ?? null;
  const [form, setForm] = useState<Form | null>(ciclo ? doCiclo(ciclo) : null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmaPublicar, setConfirmaPublicar] = useState(false);
  const [novo, setNovo] = useState<string>("");

  // Recarrega o formulário quando troca de ciclo ou o servidor devolve outra versão.
  useEffect(() => {
    setForm(ciclo ? doCiclo(ciclo) : null);
    setErro(null);
  }, [ciclo]);

  const existentes = useMemo(() => new Set(dados.ciclos.map((c) => `${c.ano}-${c.semestre}`)), [dados.ciclos]);
  const opcoesNovo = useMemo(() => {
    const lista: { valor: string; rotulo: string }[] = [];
    for (let ano = 2026; ano <= 2032; ano++) {
      for (const semestre of [1, 2]) {
        if (ano === 2026 && semestre === 1) continue;
        if (existentes.has(`${ano}-${semestre}`)) continue;
        lista.push({ valor: `${ano}-${semestre}`, rotulo: `${semestre}º semestre de ${ano}${ano < 2027 ? " (ensaio)" : ""}` });
      }
    }
    return lista;
  }, [existentes]);

  async function criar() {
    if (!novo) return;
    const [ano, semestre] = novo.split("-").map(Number);
    setSalvando(true);
    try {
      const { data } = await axios.post<CicloDto>("/api/plano-evolucao/ciclos", { ano, semestre });
      mostrar("Ciclo criado em rascunho.", "success");
      setNovo("");
      onMudou();
      onSelecionar(data.id);
    } catch (e) {
      mostrar(axios.isAxiosError(e) ? e.response?.data?.error ?? "Não foi possível criar o ciclo." : "Não foi possível criar o ciclo.", "destructive");
    } finally {
      setSalvando(false);
    }
  }

  const corpo = (f: Form) => ({
    metaEficienciaGlobal: f.metaEficienciaGlobal.trim() === "" ? null : f.metaEficienciaGlobal,
    departamentosArea: f.departamentosArea,
    amostraMinimaHoras: f.amostraMinimaHoras,
    definicaoOnline: f.definicaoOnline,
    notaMinimaEficienciaIndividual: f.notaMinimaEficienciaIndividual,
    naoApuradoQuebraSequencia: f.naoApuradoQuebraSequencia,
    certificacoesExigidas: f.certificacoesExigidas.trim() || null,
    atividadesElegiveisClientes: f.atividadesElegiveisClientes.trim() || null,
    corteEvidencias: f.corteEvidencias,
    apuracaoAte: f.apuracaoAte,
    devolutivaEm: f.devolutivaEm,
    contestacaoAte: f.contestacaoAte,
    indicadores: f.indicadores.map((i) => ({ chave: i.chave, peso: i.peso, meta: i.meta.trim() === "" ? null : i.meta, ativo: i.ativo })),
  });

  async function salvar(e?: FormEvent): Promise<boolean> {
    e?.preventDefault();
    if (!ciclo || !form) return false;
    setSalvando(true);
    setErro(null);
    try {
      await axios.put(`/api/plano-evolucao/ciclos/${ciclo.id}`, corpo(form));
      mostrar("Parâmetros salvos.", "success");
      onMudou();
      return true;
    } catch (e2) {
      setErro(axios.isAxiosError(e2) ? e2.response?.data?.error ?? "Não foi possível salvar." : "Não foi possível salvar.");
      return false;
    } finally {
      setSalvando(false);
    }
  }

  async function publicar() {
    if (!ciclo) return;
    setConfirmaPublicar(false);
    if (!(await salvar())) return;
    setSalvando(true);
    try {
      await axios.post(`/api/plano-evolucao/ciclos/${ciclo.id}/publicar`);
      mostrar("Ciclo publicado: os parâmetros estão travados.", "success");
      onMudou();
    } catch (e) {
      setErro(axios.isAxiosError(e) ? e.response?.data?.error ?? "Não foi possível publicar." : "Não foi possível publicar.");
    } finally {
      setSalvando(false);
    }
  }

  const alterarIndicador = (chave: string, parte: Partial<Form["indicadores"][number]>) =>
    setForm((f) => (f ? { ...f, indicadores: f.indicadores.map((i) => (i.chave === chave ? { ...i, ...parte } : i)) } : f));
  const somaPesos = form ? form.indicadores.filter((i) => i.ativo).reduce((t, i) => t + (Number(i.peso) || 0), 0) : 0;
  const editavel = podeEditar && ciclo?.editavel === true;

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <div className="space-y-3">
        <Cartao titulo="Ciclos" className="p-4">
          {dados.ciclos.length === 0 ? (
            <Vazio>Nenhum ciclo ainda.</Vazio>
          ) : (
            <ul className="space-y-1.5">
              {dados.ciclos.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelecionar(c.id)}
                    aria-pressed={ciclo?.id === c.id}
                    className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      ciclo?.id === c.id ? "border-primary bg-surface-2" : "border-border hover:bg-surface-2"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium text-foreground">{c.rotulo}</span>
                      <span className="block text-[11.5px] text-muted">{dataBr(c.inicio)} a {dataBr(c.fim)}</span>
                    </span>
                    <Chip tom={toneDoStatus[c.status]}>{rotuloStatusCiclo[c.status]}</Chip>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {podeEditar && (
            <div className="mt-4 border-t border-border pt-4">
              <label htmlFor="novo-ciclo" className="mb-1 block text-[12.5px] font-medium text-foreground">Novo ciclo</label>
              <select id="novo-ciclo" value={novo} onChange={(e) => setNovo(e.target.value)} className={campo}>
                <option value="">Escolha o semestre…</option>
                {opcoesNovo.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.rotulo}
                  </option>
                ))}
              </select>
              <button type="button" onClick={criar} disabled={!novo || salvando} className={`${botaoPrimario} mt-2 w-full`}>
                Criar em rascunho
              </button>
            </div>
          )}
        </Cartao>
      </div>

      {!ciclo || !form ? (
        <Cartao>
          <Vazio>Crie o primeiro ciclo para definir a meta, os indicadores e a área.</Vazio>
        </Cartao>
      ) : (
        <form onSubmit={salvar} className="min-w-0 space-y-5">
          <Cartao titulo={ciclo.rotulo} nota={`${dataBr(ciclo.inicio)} a ${dataBr(ciclo.fim)}`} acao={<Chip tom={toneDoStatus[ciclo.status]}>{rotuloStatusCiclo[ciclo.status]}</Chip>}>
            {!ciclo.editavel && (
              <p className="mb-4 rounded-md border border-border bg-surface-2/60 px-3 py-2 text-[13px] text-muted" role="status">
                <b className="text-foreground">Parâmetros travados.</b> O regulamento não permite mudar meta, indicadores ou área com o ciclo em andamento. Mudanças valem a partir do ciclo seguinte.
              </p>
            )}
            {ciclo.editavel && !podeEditar && <p className="mb-4 text-[13px] text-muted">Só o administrador edita os parâmetros do ciclo.</p>}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="meta-global" className="mb-1 block text-[13px] font-medium text-foreground">Meta da eficiência global da área (%)</label>
                <input id="meta-global" inputMode="decimal" value={form.metaEficienciaGlobal} onChange={(e) => setForm({ ...form, metaEficienciaGlobal: e.target.value })} disabled={!editavel} placeholder="ex.: 75" className={campo} />
                <p className="mt-1 text-[11.5px] text-muted">Horas dentro do orçado do item ÷ horas executadas, na área toda. Tem teto de 100%.</p>
              </div>
              <div>
                <label htmlFor="amostra" className="mb-1 block text-[13px] font-medium text-foreground">Amostra mínima por consultor (horas)</label>
                <input id="amostra" inputMode="numeric" value={form.amostraMinimaHoras} onChange={(e) => setForm({ ...form, amostraMinimaHoras: e.target.value })} disabled={!editavel} className={campo} />
                <p className="mt-1 text-[11.5px] text-muted">Abaixo disso o indicador fica "sem base" e não reprova ninguém.</p>
              </div>
              <div>
                <label htmlFor="nota-min" className="mb-1 block text-[13px] font-medium text-foreground">Nota mínima da eficiência individual (%)</label>
                <input id="nota-min" inputMode="numeric" value={form.notaMinimaEficienciaIndividual} onChange={(e) => setForm({ ...form, notaMinimaEficienciaIndividual: e.target.value })} disabled={!editavel} className={campo} />
                <p className="mt-1 text-[11.5px] text-muted">% dos pesos dos indicadores que o consultor precisa atingir (100 = todos).</p>
              </div>
              <fieldset disabled={!editavel}>
                <legend className="mb-1 block text-[13px] font-medium text-foreground">O que conta como apontamento online</legend>
                {(["A", "B"] as const).map((d) => (
                  <label key={d} className="mb-1 flex cursor-pointer items-start gap-2 text-[13px] text-foreground">
                    <input type="radio" name="online" checked={form.definicaoOnline === d} onChange={() => setForm({ ...form, definicaoOnline: d })} className="mt-1 accent-primary" />
                    <span>
                      <b>{d}</b>: {d === "A" ? "só o Start/Stop ao vivo (é o que o regulamento diz)" : "Start/Stop ao vivo e lançamento no Senior registrado no mesmo dia"}
                    </span>
                  </label>
                ))}
              </fieldset>
            </div>

            <fieldset className="mt-4" disabled={!editavel}>
              <legend className="mb-1 text-[13px] font-medium text-foreground">Departamentos que formam a área</legend>
              <p className="mb-2 text-[11.5px] text-muted">Conta o departamento do ITEM da proposta (não o do consultor).</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {dados.departamentos.map((d) => (
                  <label key={d.valor} className="flex cursor-pointer items-center gap-1.5 text-[13px] text-foreground">
                    <input
                      type="checkbox"
                      checked={form.departamentosArea.includes(d.valor)}
                      onChange={() => setForm({ ...form, departamentosArea: form.departamentosArea.includes(d.valor) ? form.departamentosArea.filter((x) => x !== d.valor) : [...form.departamentosArea, d.valor] })}
                      className="h-4 w-4 accent-primary"
                    />
                    {d.rotulo}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="mt-4 flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
              <input type="checkbox" checked={form.naoApuradoQuebraSequencia} disabled={!editavel} onChange={(e) => setForm({ ...form, naoApuradoQuebraSequencia: e.target.checked })} className="h-4 w-4 accent-primary" />
              Ciclo "não apurado" (contrato inativo ou ciclo incompleto) quebra a sequência dos 10 ciclos
            </label>
            <p className="mt-1 text-[11.5px] text-muted">O regulamento só diz que o ciclo "não conta". Padrão: não quebra.</p>
          </Cartao>

          <Cartao titulo="Indicadores da eficiência operacional" nota={`pesos ativos somam ${somaPesos}${somaPesos === 100 ? "" : " (precisam somar 100)"}`}>
            <TabelaIndicadores ciclo={ciclo} form={form} editavel={editavel} alterar={alterarIndicador} />
            <p className="mt-3 text-[12px] text-muted">
              Os automáticos o CaxHub calcula (meta em %). Os manuais o gestor lança na apuração. Cumprimento de cronogramas fica desativado: a data prevista de fim está preenchida em menos de 1% das atividades.
            </p>
          </Cartao>

          <Cartao titulo="Calendário e textos do ciclo">
            <div className="grid gap-4 sm:grid-cols-4">
              {(
                [
                  ["corteEvidencias", "Corte de evidências"],
                  ["apuracaoAte", "Apuração até"],
                  ["devolutivaEm", "Devolutiva em"],
                  ["contestacaoAte", "Contestação até"],
                ] as const
              ).map(([chave, rotulo]) => (
                <div key={chave}>
                  <label htmlFor={chave} className="mb-1 block text-[13px] font-medium text-foreground">{rotulo}</label>
                  <input id={chave} type="date" value={form[chave]} onChange={(e) => setForm({ ...form, [chave]: e.target.value })} disabled={!editavel} className={campo} />
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="cert" className="mb-1 block text-[13px] font-medium text-foreground">Certificações exigidas no ciclo</label>
                <textarea id="cert" rows={3} maxLength={1000} value={form.certificacoesExigidas} onChange={(e) => setForm({ ...form, certificacoesExigidas: e.target.value })} disabled={!editavel} className={`${campo} resize-y`} />
              </div>
              <div>
                <label htmlFor="elegiveis" className="mb-1 block text-[13px] font-medium text-foreground">Atividades elegíveis à avaliação de clientes</label>
                <textarea id="elegiveis" rows={3} maxLength={1000} value={form.atividadesElegiveisClientes} onChange={(e) => setForm({ ...form, atividadesElegiveisClientes: e.target.value })} disabled={!editavel} className={`${campo} resize-y`} />
              </div>
            </div>
          </Cartao>

          {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{erro}</p>}
          {editavel && ciclo.pendenciasPublicacao.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-[13px] text-foreground" role="status">
              <b>Para publicar falta:</b>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {ciclo.pendenciasPublicacao.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <p className="mt-1 text-[12px] text-muted">Salve as alterações para atualizar esta lista.</p>
            </div>
          )}
          {editavel && (
            <div className="flex flex-wrap justify-end gap-2">
              <button type="submit" disabled={salvando} className={botaoSecundario}>
                Salvar rascunho
              </button>
              <button type="button" onClick={() => setConfirmaPublicar(true)} disabled={salvando} className={botaoPrimario}>
                Publicar e travar…
              </button>
            </div>
          )}
        </form>
      )}

      <Modal open={confirmaPublicar} onClose={() => setConfirmaPublicar(false)} title="Publicar o ciclo?" subtitulo={ciclo?.rotulo}>
        <div className="space-y-4 text-sm text-foreground">
          <p>
            Ao publicar, <b>meta, indicadores, pesos, área e calendário ficam travados</b> até o fim do ciclo, como manda o regulamento. Não dá para desfazer.
          </p>
          <p className="text-muted">As alterações do formulário são salvas antes de publicar. Se faltar algum parâmetro, o servidor avisa o que é.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmaPublicar(false)} className={botaoSecundario}>
              Cancelar
            </button>
            <button type="button" onClick={publicar} className={botaoPrimario}>
              Publicar e travar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function TabelaIndicadores({ ciclo, form, editavel, alterar }: { ciclo: CicloDto; form: Form; editavel: boolean; alterar: (chave: string, parte: Partial<Form["indicadores"][number]>) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left font-mono text-[10.5px] uppercase tracking-wider text-muted">
            <th className="px-2 py-2 font-medium">Ativo</th>
            <th className="px-2 py-2 font-medium">Indicador</th>
            <th className="px-2 py-2 font-medium">Tipo</th>
            <th className="w-24 px-2 py-2 font-medium">Peso</th>
            <th className="w-28 px-2 py-2 font-medium">Meta (%)</th>
          </tr>
        </thead>
        <tbody>
          {ciclo.indicadores.map((def) => {
            const i = form.indicadores.find((x) => x.chave === def.chave)!;
            return (
              <tr key={def.chave} className={`border-t border-border/60 align-top ${i.ativo ? "" : "opacity-60"}`}>
                <td className="px-2 py-2">
                  <input type="checkbox" checked={i.ativo} disabled={!editavel} onChange={(e) => alterar(def.chave, { ativo: e.target.checked })} aria-label={`Ativar ${def.rotulo}`} className="h-4 w-4 accent-primary" />
                </td>
                <td className="px-2 py-2">
                  <span className="block font-medium text-foreground">{def.rotulo}</span>
                  <span className="block max-w-[420px] text-[11.5px] text-muted">{def.descricao}</span>
                </td>
                <td className="px-2 py-2 text-[12.5px] text-muted">{def.tipo === "automatico" ? "automático" : "manual"}</td>
                <td className="px-2 py-2">
                  <input inputMode="numeric" value={i.peso} disabled={!editavel || !i.ativo} onChange={(e) => alterar(def.chave, { peso: e.target.value })} aria-label={`Peso de ${def.rotulo}`} className={campo} />
                </td>
                <td className="px-2 py-2">
                  {def.tipo === "automatico" ? (
                    <input inputMode="decimal" value={i.meta} disabled={!editavel || !i.ativo} onChange={(e) => alterar(def.chave, { meta: e.target.value })} aria-label={`Meta de ${def.rotulo}`} className={campo} />
                  ) : (
                    <span className="text-[12px] text-muted">lançado pelo gestor</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
