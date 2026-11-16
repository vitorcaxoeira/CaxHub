import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardProgressoMeta, type MetaPeriodoDto } from "./CardProgressoMeta";

const html = (el: JSX.Element) => renderToStaticMarkup(el).replace(/ /g, " ");

const base: MetaPeriodoDto = {
  jornadaMinutos: 178 * 60 + 30,
  feriasMinutos: 68 * 60,
  folgaMinutos: 0,
  metaMinutos: 110 * 60 + 30,
  diasComJornada: 21,
  diasFerias: 8,
  diasFolgaInteira: 0,
  metaAteHojeMinutos: 93 * 60 + 30,
  realizadoAteHojeMinutos: 34 * 60 + 5,
  diasComMetaRestantes: 5,
  semJornadaMinutos: 0,
};

describe("CardProgressoMeta", () => {
  it("mostra a conta da meta, o realizado sobre a meta do período e o ritmo atrasado", () => {
    const out = html(<CardProgressoMeta meta={base} totalMinutos={34 * 60 + 5} rotuloPeriodo="Nov/2026" />);
    expect(out).toContain("Progresso da meta · Nov/2026");
    expect(out).toContain("34:05");
    expect(out).toContain("110:30 h");
    expect(out).toContain("31%");
    expect(out).toContain("Jornada (21 dias)");
    expect(out).toContain("− Férias (8 dias)");
    expect(out).toContain("− 68:00 h");
    expect(out).toContain("= Meta do período");
    expect(out).toContain("esperado até hoje, 93:30 h");
    expect(out).toContain("59:25 h abaixo do esperado");
    expect(out).toContain("Faltam 76:25 h");
    expect(out).toContain("5 dias com meta restantes");
    expect(out).not.toContain("− Folgas");
    expect(out).not.toContain("Fim de semana");
    // detalhes abertos por padrão, com o botão de recolher
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain("Meta do período · detalhes");
  });

  it("folgas aparecem com os dias inteiros e o fim de semana trabalhado é informado à parte", () => {
    const out = html(
      <CardProgressoMeta
        meta={{ ...base, feriasMinutos: 0, folgaMinutos: 8 * 60 + 30, diasFerias: 0, diasFolgaInteira: 1, metaMinutos: 170 * 60, semJornadaMinutos: 150 }}
        totalMinutos={100 * 60}
        rotuloPeriodo="Nov/2026"
      />,
    );
    expect(out).toContain("− Folgas (1 dia inteiros)");
    expect(out).toContain("− 08:30 h");
    expect(out).toContain("Fim de semana / dia sem jornada");
    expect(out).toContain("02:30 h");
    expect(out).not.toContain("− Férias");
  });

  it("adiantado: ritmo positivo e meta cumprida", () => {
    const out = html(
      <CardProgressoMeta meta={{ ...base, realizadoAteHojeMinutos: 100 * 60, diasComMetaRestantes: 0 }} totalMinutos={120 * 60} rotuloPeriodo="Nov/2026" />,
    );
    expect(out).toContain("adiantado até hoje");
    expect(out).toContain("Meta do período cumprida");
    expect(out).toContain("109%");
  });

  it("sem férias nem folgas avisa que não há dedução", () => {
    const out = html(
      <CardProgressoMeta meta={{ ...base, feriasMinutos: 0, diasFerias: 0, jornadaMinutos: base.metaMinutos }} totalMinutos={60} rotuloPeriodo="Nov/2026" />,
    );
    expect(out).toContain("Sem férias nem folgas no período.");
  });

  it("sem jornada e período todo em férias mostram a mensagem certa", () => {
    const semJornada = html(<CardProgressoMeta meta={{ ...base, diasComJornada: 0, jornadaMinutos: 0, metaMinutos: 0, feriasMinutos: 0 }} totalMinutos={0} rotuloPeriodo="Nov/2026" />);
    expect(semJornada).toContain("Sem jornada cadastrada");
    const tudoFerias = html(<CardProgressoMeta meta={{ ...base, metaMinutos: 0, metaAteHojeMinutos: 0 }} totalMinutos={0} rotuloPeriodo="Nov/2026" />);
    expect(tudoFerias).toContain("Período todo em férias ou folga");
    expect(tudoFerias).toContain("Jornada (21 dias)");
  });
});
