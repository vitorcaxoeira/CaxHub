import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DESTINOS, ModalDeteccaoEmMassa, situacaoDaVarredura, tabelasDoFiltro, type TabelaDeteccao } from "./ModalDeteccaoEmMassa";

const base: TabelaDeteccao = { jobName: "a", displayName: "Situações do Ponto", tabelaSenior: "R066SIT", tabelaLocal: "hcm_situacao_ponto", varreduraModo: "desligada", varreduraDisponivel: true, ultimaVarredura: null, bloqueioVarredura: null };
const JOBS: TabelaDeteccao[] = [
  base,
  { ...base, jobName: "b", displayName: "Lançamentos do Banco de Horas", tabelaSenior: "R011LAN", tabelaLocal: "hcm_lancamentos_bh", varreduraModo: "simular", ultimaVarredura: { modo: "simular", detectados: 332, em: "2026-11-24T07:02:00.000Z" } },
  { ...base, jobName: "c", displayName: "Cargos", tabelaSenior: "R024CAR", tabelaLocal: "hcm_cargos", varreduraModo: "marcar" },
  { ...base, jobName: "d", displayName: "Sem detecção", varreduraDisponivel: false },
];

describe("detecção de exclusão em massa", () => {
  it("cada filtro traz só as tabelas do modo, sem as que não têm detecção", () => {
    expect(tabelasDoFiltro(JOBS, "desligada").map((j) => j.jobName)).toEqual(["a"]);
    expect(tabelasDoFiltro(JOBS, "simular").map((j) => j.jobName)).toEqual(["b"]);
  });

  it("a busca ignora acento e maiúsculas e olha descrição e nomes das tabelas", () => {
    expect(tabelasDoFiltro(JOBS, "desligada", "situacoes")).toHaveLength(1);
    expect(tabelasDoFiltro(JOBS, "simular", "r011lan")).toHaveLength(1);
    expect(tabelasDoFiltro(JOBS, "simular", "cargos")).toHaveLength(0);
  });

  it("Desligada só vai para Simular; Marcar só é oferecido para quem está Simulando", () => {
    expect(DESTINOS.desligada.map((d) => d.modo)).toEqual(["simular"]);
    expect(DESTINOS.simular.map((d) => d.modo)).toEqual(["desligada", "marcar"]);
  });

  it("situação da varredura: simulado, nunca varrida (alerta só em Simular) e barrada", () => {
    expect(situacaoDaVarredura(JOBS[1])).toEqual({ texto: expect.stringContaining("332 sumiriam (simulado)"), alerta: false });
    expect(situacaoDaVarredura(base)).toEqual({ texto: "ainda não varreu", alerta: false });
    expect(situacaoDaVarredura({ ...base, varreduraModo: "simular" }).alerta).toBe(true);
    expect(situacaoDaVarredura({ ...JOBS[1], bloqueioVarredura: { motivo: "teto", candidatos: 1500 } })).toEqual({ texto: "última varredura barrada (1.500 candidatos)", alerta: true });
  });

  it("o modal abre em Desligadas, com a contagem dos filtros, nada selecionado e o botão desabilitado", () => {
    const out = renderToStaticMarkup(<ModalDeteccaoEmMassa api="/api/sync-hcm" jobs={JOBS} onFechar={() => undefined} onAplicado={() => undefined} />);
    expect(out).toContain("Desligadas (1)");
    expect(out).toContain("Simulando (1)");
    expect(out).toContain("1 já em Marcar · 1 sem detecção disponível");
    expect(out).toContain("Situações do Ponto");
    expect(out).not.toContain("Lançamentos do Banco de Horas");
    expect(out).toContain("0 de 1 selecionada(s)");
    expect(out).toContain("Passar para Simular");
    expect(out).not.toContain("Ligar Marcar");
  });
});
