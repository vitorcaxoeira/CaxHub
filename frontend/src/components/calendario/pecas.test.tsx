import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DiaCalendario, RespostaCalendario } from "../../lib/feriasCalendario";
import { GradeDoMes } from "./pecas";

const dia = (data: string, diaSemana: number, extra: Partial<DiaCalendario> = {}): DiaCalendario => ({
  data,
  diaSemana,
  baseMinutos: diaSemana === 0 || diaSemana === 6 ? 0 : 510,
  metaMinutos: diaSemana === 0 || diaSemana === 6 ? 0 : 510,
  apontadoMinutos: 0,
  ferias: false,
  gozoId: null,
  ausencias: [],
  ...extra,
});

// 01/11/2026 é domingo.
const DADOS: RespostaCalendario = {
  consultor: { codemp: 1, codfor: 350, nome: "Micael Miranda", depexe: 8 },
  ano: 2026,
  mes: 11,
  dias: [
    dia("2026-11-01", 0),
    dia("2026-11-02", 1, { metaMinutos: 0, ferias: true, gozoId: 1 }),
    dia("2026-11-03", 2, { ausencias: [{ id: 7, diaInteiro: false, inicioMin: 840, fimMin: 960, motivo: "Médico", descontaFerias: false }], metaMinutos: 390 }),
    dia("2026-11-04", 3, { apontadoMinutos: 480 }),
  ],
  totais: { metaMinutos: 900, abonadoFeriasMinutos: 510, abonadoFolgaMinutos: 120, apontadoMinutos: 480 },
  saldos: [],
  permissoes: { editarFolgas: true, lancarFerias: false, proprio: false },
};

describe("GradeDoMes", () => {
  it("mostra férias, folga parcial com o horário, feriado e as horas apontadas", () => {
    const out = renderToStaticMarkup(<GradeDoMes dados={DADOS} loading={false} feriados={{ "2026-11-02": "Finados" }} onDia={() => undefined} />);
    expect(out).toContain("Férias");
    expect(out).toContain("Folga 14:00–16:00");
    expect(out).toContain("Finados");
    expect(out).toContain("08:00 h");
    expect(out).toContain("meta 08:30 h");
    expect(out).toContain("Dom");
  });

  it("modo compacto (Home) não mostra meta nem o nome do feriado, só a bolinha com a dica", () => {
    const out = renderToStaticMarkup(<GradeDoMes dados={DADOS} loading={false} feriados={{ "2026-11-02": "Finados" }} onDia={() => undefined} compacto />);
    expect(out).not.toContain("meta 08:30 h");
    expect(out).toContain('aria-label="Finados"');
    expect(out).not.toContain(">Finados<");
    expect(out).toContain("Férias");
  });

  it("sem dados (carregando ou sem consultor) renderiza só o cabeçalho, sem quebrar", () => {
    const out = renderToStaticMarkup(<GradeDoMes dados={null} loading onDia={() => undefined} feriados={{}} />);
    expect(out).toContain("Sáb");
    expect(out).not.toContain("Férias");
  });
});
