import assert from "node:assert/strict";
import { test } from "node:test";
import { agruparTimesEAreas } from "./bonificacaoTimes";

test("agrupa por usuário, time e área, somando o time e ordenando do maior para o menor", () => {
  const r = agruparTimesEAreas([
    { codusu: 1, time: "SUPORTE TI", area: "(sem área)", minutos: 10.5 },
    { codusu: 1, time: "SUPORTE TI", area: "ERP | Gestão Empresarial", minutos: 100.25 },
    { codusu: 1, time: "SUPORTE ERP", area: "ERP | Gestão Empresarial", minutos: 200 },
    { codusu: 2, time: "SUPORTE TI", area: "(sem área)", minutos: 5 },
  ]);
  assert.deepEqual(r.get(1), [
    { time: "SUPORTE ERP", minutos: 200, porArea: [{ area: "ERP | Gestão Empresarial", minutos: 200 }] },
    {
      time: "SUPORTE TI",
      minutos: 110.75,
      porArea: [
        { area: "ERP | Gestão Empresarial", minutos: 100.25 },
        { area: "(sem área)", minutos: 10.5 },
      ],
    },
  ]);
  assert.equal(r.get(2)![0].minutos, 5);
  assert.equal(r.get(3), undefined);
});
