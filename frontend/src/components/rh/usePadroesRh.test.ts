import { describe, expect, it } from "vitest";
import { camposRh } from "./usePadroesRh";
import type { FiltroRhEstado } from "./filtroStore";
import type { OpcoesRh } from "./opcoesRh";

const F: FiltroRhEstado = { preset: "12m", de: "2025-11-01", ate: "2026-10-31", empresa: null, filial: null, tipcol: [], ccu: null, local: null, cargo: null };

const OPCOES: OpcoesRh = {
  empresas: [
    { valor: 1, rotulo: "Matriz" },
    { valor: 2, rotulo: "Filial SA" },
  ],
  filiais: [
    { valor: 1, rotulo: "Filial 1 da Matriz", empresa: 1 },
    { valor: 7, rotulo: "Filial 7 da SA", empresa: 2 },
  ],
  centrosDeCusto: [
    { valor: "100", rotulo: "Obra A", empresa: 1 },
    { valor: "200", rotulo: "Obra B", empresa: 2 },
  ],
  locais: [{ valor: 3, rotulo: "Canteiro" }],
  cargos: [{ valor: "1:ANA", rotulo: "Analista" }],
  tiposDeColaborador: [
    { valor: 1, rotulo: "Empregado" },
    { valor: 3, rotulo: "Terceiro" },
  ],
  dados: { primeiraAdmissao: null, ultimaApuracaoDePonto: null, ultimaCompetenciaDeFolha: null, ultimaSincronizacao: null },
};

describe("camposRh", () => {
  it("o período salva o preset relativo, ou as datas fixas se for personalizado", () => {
    expect(camposRh(F, OPCOES, null).periodo.atual).toEqual(["12m"]);
    expect(camposRh({ ...F, preset: "personalizado" }, OPCOES, null).periodo.atual).toEqual(["personalizado", "2025-11-01", "2026-10-31"]);
    const v = camposRh(F, OPCOES, null).periodo.validar;
    expect(v(["6m"])).toEqual({ ok: true, valor: { preset: "6m" } });
    expect(v(["mesAtual"])).toEqual({ ok: false }); // o RH não tem "Este mês"
  });

  it("empresa aceita 'Todas' (null) ou uma que existe", () => {
    const v = camposRh(F, OPCOES, null).empresa.validar;
    expect(v(null)).toEqual({ ok: true, valor: null });
    expect(v(2)).toEqual({ ok: true, valor: 2 });
    expect(v(9)).toEqual({ ok: false });
  });

  it("filial e centro de custo valem só para a empresa que vai ficar valendo", () => {
    // sem empresa: qualquer filial existente
    expect(camposRh(F, OPCOES, null).filial.validar(7)).toEqual({ ok: true, valor: 7 });
    // com a empresa 1 valendo: a filial 7 é da empresa 2
    expect(camposRh(F, OPCOES, 1).filial.validar(7)).toEqual({ ok: false });
    expect(camposRh(F, OPCOES, 1).filial.validar(1)).toEqual({ ok: true, valor: 1 });
    expect(camposRh(F, OPCOES, 2).ccu.validar("200")).toEqual({ ok: true, valor: "200" });
    expect(camposRh(F, OPCOES, 2).ccu.validar("100")).toEqual({ ok: false });
  });

  it("tipo de colaborador, local e cargo conferem as opções; antes de elas chegarem só o formato", () => {
    const c = camposRh(F, OPCOES, null);
    expect(c.tipcol.validar([1, 3])).toEqual({ ok: true, valor: [1, 3] });
    expect(c.tipcol.validar([5])).toEqual({ ok: false });
    expect(c.local.validar(3)).toEqual({ ok: true, valor: 3 });
    expect(c.cargo.validar("9:XX")).toEqual({ ok: false });
    expect(camposRh(F, null, null).cargo.validar("9:XX")).toEqual({ ok: true, valor: "9:XX" });
  });
});
