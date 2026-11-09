import { describe, expect, it } from "vitest";
import { formatHoraDoDia, horarioDoItem, lerAtividade, LOCAIS_ATIVIDADES, rotuloItem, situacaoIntegracaoItem, type ItemAtividade } from "./atividadesRat";

const base: ItemAtividade = {
  seqite: 3,
  itemDescricao: "Migração de prefeituras",
  horini: 590,
  horfim: 660,
  confirmadoNoSenior: false,
  removidoEmSenior: null,
  envioStatus: null,
  envioErro: null,
  edicaoStatus: null,
};

describe("rotuloItem", () => {
  it("prefixa a sequência; sem sequência só a descrição; sem descrição um traço", () => {
    expect(rotuloItem(base)).toBe("3 - Migração de prefeituras");
    expect(rotuloItem({ seqite: null, itemDescricao: "Só texto" })).toBe("Só texto");
    expect(rotuloItem({ seqite: 2, itemDescricao: null })).toBe("2 - —");
  });
});

describe("horarioDoItem", () => {
  it("formata HH:MM–HH:MM e devolve null sem as duas horas", () => {
    expect(formatHoraDoDia(5)).toBe("00:05");
    expect(horarioDoItem(base)).toBe("09:50–11:00");
    expect(horarioDoItem({ horini: 590, horfim: null })).toBeNull();
    expect(horarioDoItem({ horini: null, horfim: null })).toBeNull();
  });
  it("a ordem textual é a cronológica", () => {
    const a = horarioDoItem({ horini: 540, horfim: 600 })!;
    const b = horarioDoItem({ horini: 725, horfim: 800 })!;
    expect(a < b).toBe(true);
  });
});

describe("situacaoIntegracaoItem (mesma precedência de AcaoIntegracao)", () => {
  it("cada estado, na ordem", () => {
    expect(situacaoIntegracaoItem({ ...base, removidoEmSenior: "2026-11-01", confirmadoNoSenior: true })).toBe("Excluído no Senior");
    expect(situacaoIntegracaoItem({ ...base, confirmadoNoSenior: true, edicaoStatus: "enviando" })).toBe("Alterando no Senior");
    expect(situacaoIntegracaoItem({ ...base, confirmadoNoSenior: true, edicaoStatus: "falha" })).toBe("Falha ao alterar");
    expect(situacaoIntegracaoItem({ ...base, confirmadoNoSenior: true })).toBe("Registrado");
    expect(situacaoIntegracaoItem({ ...base, envioStatus: "enviando" })).toBe("Integrando");
    expect(situacaoIntegracaoItem({ ...base, envioStatus: "pendente" })).toBe("Integrando");
    expect(situacaoIntegracaoItem({ ...base, envioStatus: "pendente", envioErro: "recusado" })).toBe("Falha no envio");
    expect(situacaoIntegracaoItem({ ...base, envioStatus: "bloqueado", envioErro: "recusado" })).toBe("Falha no envio");
    expect(situacaoIntegracaoItem(base)).toBe("Não enviado");
  });
  it("alteração pendente só conta quando o item já está registrado", () => {
    expect(situacaoIntegracaoItem({ ...base, edicaoStatus: "falha" })).toBe("Não enviado");
  });
});

describe("lerAtividade", () => {
  it("colunas derivadas vêm das funções; as demais, do campo da linha", () => {
    const linha = { ...base, sessaoId: 1895, codser: "FT021" } as ItemAtividade;
    expect(lerAtividade(linha, "item")).toBe("3 - Migração de prefeituras");
    expect(lerAtividade(linha, "horario")).toBe("09:50–11:00");
    expect(lerAtividade(linha, "integracao")).toBe("Não enviado");
    expect(lerAtividade(linha, "sessaoId")).toBe(1895);
    expect(lerAtividade(linha, "codser")).toBe("FT021");
  });
  it("toda coluna do filtro tem tipo declarado e nome único", () => {
    const nomes = LOCAIS_ATIVIDADES.map((c) => c.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
    expect(nomes).toEqual(["atividadeId", "sessaoId", "codser", "item", "datati", "horario", "duracaoMinutos", "desati", "integracao"]);
  });
});
