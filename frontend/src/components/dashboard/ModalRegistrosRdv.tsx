import { Modal } from "../ui/Modal";
import type { GrupoRdv, ItemRdvEmRat, ItemTituloRdv } from "../../hooks/useRdvConsultor";

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dataFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

function formatarData(iso: string | null): string {
  return iso ? dataFormatter.format(new Date(`${iso}T00:00:00Z`)) : "—";
}

const th = "px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted";
const thDireita = `${th} text-right`;

// O que o modal mostra: as despesas de RAT ainda não aprovada, ou uma faixa de títulos a
// pagar em aberto (vencidos / este mês / próximos meses).
export type SelecaoRdv =
  | { tipo: "rdv"; titulo: string; grupo: GrupoRdv<ItemRdvEmRat> }
  | { tipo: "titulos"; titulo: string; grupo: GrupoRdv<ItemTituloRdv> };

function Cabecalho({ quantidade, rotulo, total }: { quantidade: number; rotulo: string; total: number }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <p className="text-[12.5px] text-muted">
        {quantidade} {rotulo}
        {quantidade === 1 ? "" : "s"}
      </p>
      <p className="font-mono text-sm font-semibold tabular-nums text-foreground">Total: {moeda.format(total)}</p>
    </div>
  );
}

function TabelaRdv({ grupo }: { grupo: GrupoRdv<ItemRdvEmRat> }) {
  return (
    <>
      <Cabecalho quantidade={grupo.itens.length} rotulo="despesa" total={grupo.total} />
      <div className="overflow-x-auto rounded-md border border-border/60">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-surface-2">
              <th className={th}>RAT</th>
              <th className={th}>Situação</th>
              <th className={th}>Data</th>
              <th className={th}>Descrição</th>
              <th className={th}>Tipo</th>
              <th className={thDireita}>Qtd</th>
              <th className={thDireita}>Vlr unit.</th>
              <th className={thDireita}>Total</th>
            </tr>
          </thead>
          <tbody>
            {grupo.itens.map((d) => (
              <tr key={d.id} className="border-t border-border/60">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-foreground">{d.numrat}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{d.sitratLabel}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted">{formatarData(d.datemi ?? d.datemiRat)}</td>
                <td className="max-w-[320px] truncate px-3 py-2 text-xs text-foreground" title={d.desrdv ?? undefined}>
                  {d.desrdv ?? "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{d.tipdesLabel}</td>
                <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-muted">{d.qtdrdv ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-muted">{moeda.format(d.vlrunt)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-foreground">{moeda.format(d.vlrtot)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TabelaTitulos({ grupo }: { grupo: GrupoRdv<ItemTituloRdv> }) {
  return (
    <>
      <Cabecalho quantidade={grupo.itens.length} rotulo="título" total={grupo.total} />
      <div className="overflow-x-auto rounded-md border border-border/60">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-surface-2">
              <th className={th}>Título</th>
              <th className={th}>Filial</th>
              <th className={th}>Emissão</th>
              <th className={th}>Vencimento</th>
              <th className={th}>Observação</th>
              <th className={thDireita}>Valor original</th>
              <th className={thDireita}>Em aberto</th>
            </tr>
          </thead>
          <tbody>
            {grupo.itens.map((t) => (
              <tr key={`${t.codemp}-${t.codfil}-${t.numtit}`} className="border-t border-border/60">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-foreground">{t.numtit}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted">{t.codfil}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted">{formatarData(t.datemi)}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-foreground">{formatarData(t.vctpro)}</td>
                <td className="max-w-[280px] truncate px-3 py-2 text-xs text-muted" title={t.obstcp ?? undefined}>
                  {t.obstcp ?? "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-muted">{moeda.format(t.vlrori)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-foreground">{moeda.format(t.vlrabe)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function ModalRegistrosRdv({ selecao, subtitulo, onClose }: { selecao: SelecaoRdv; subtitulo?: string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={selecao.titulo} subtitulo={subtitulo} className="max-w-4xl">
      {selecao.tipo === "rdv" ? <TabelaRdv grupo={selecao.grupo} /> : <TabelaTitulos grupo={selecao.grupo} />}
    </Modal>
  );
}
