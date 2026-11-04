import { useEffect, useState } from "react";
import { regras, valorDoPeriodo } from "../ui/padroesFiltros/regras";
import { usePadroesFiltros } from "../ui/padroesFiltros/usePadroesFiltros";
import { usePadroesTela, type DefCampo } from "../ui/padroesFiltros/usePadroesTela";
import { aplicarPreset, atualizarFiltro, PRESETS, useFiltroRh, type FiltroRhEstado, type PresetPeriodo } from "./filtroStore";
import { buscarOpcoes, type OpcoesRh } from "./opcoesRh";

// Padrão de cada filtro do RH (estrela, 03/11/2026): UM padrão por usuário para as 10 telas de RH (o filtro já é compartilhado entre
// elas), salvo no servidor na tela "rh". Aplicado uma vez por sessão da página, antes da 1ª consulta de qualquer tela de RH (useRh).

export const TELA_RH = "rh";
export const CAMPOS_RH = ["periodo", "empresa", "filial", "tipcol", "ccu", "local", "cargo"];

/**
 * Os campos do filtro do RH para o padrão. Filial e centro de custo dependem da empresa: valem as opções da empresa que vai ficar
 * valendo (`empresaEfetiva`: a do padrão, se ela também vale, ou a atual).
 */
export function camposRh(f: FiltroRhEstado, opcoes: OpcoesRh | null, empresaEfetiva: number | null): Record<string, DefCampo> {
  const daEmpresa = <T extends { empresa?: number }>(lista: T[] | undefined) => lista?.filter((x) => empresaEfetiva == null || x.empresa === empresaEfetiva);
  return {
    periodo: {
      rotulo: "Período",
      atual: valorDoPeriodo(f),
      aplicar: (v: { preset: string; de?: string; ate?: string }) => {
        if (v.preset === "personalizado") atualizarFiltro({ preset: "personalizado", de: v.de!, ate: v.ate! });
        else aplicarPreset(v.preset as PresetPeriodo);
      },
      validar: regras.periodo(PRESETS.map((p) => p.valor)),
      semOpcoes: true,
      ordem: true,
    },
    empresa: { rotulo: "Empresa", atual: f.empresa, aplicar: (v: number | null) => atualizarFiltro({ empresa: v }), validar: regras.valorUnico("number", opcoes?.empresas.map((o) => o.valor), { nuloOk: true }) },
    filial: { rotulo: "Filial", atual: f.filial, aplicar: (v: number | null) => atualizarFiltro({ filial: v }), validar: regras.valorUnico("number", daEmpresa(opcoes?.filiais)?.map((o) => o.valor), { nuloOk: true }) },
    tipcol: { rotulo: "Tipo de colaborador", atual: f.tipcol, aplicar: (v: number[]) => atualizarFiltro({ tipcol: [...v].sort() }), validar: regras.lista("number", opcoes?.tiposDeColaborador.map((o) => o.valor)) },
    ccu: { rotulo: "Centro de custo", atual: f.ccu, aplicar: (v: string | null) => atualizarFiltro({ ccu: v }), validar: regras.valorUnico("string", daEmpresa(opcoes?.centrosDeCusto)?.map((o) => o.valor), { nuloOk: true }) },
    local: { rotulo: "Local de trabalho", atual: f.local, aplicar: (v: number | null) => atualizarFiltro({ local: v }), validar: regras.valorUnico("number", opcoes?.locais.map((o) => o.valor), { nuloOk: true }) },
    cargo: { rotulo: "Cargo", atual: f.cargo, aplicar: (v: string | null) => atualizarFiltro({ cargo: v }), validar: regras.valorUnico("string", opcoes?.cargos.map((o) => o.valor), { nuloOk: true }) },
  };
}

// O padrão vale uma vez por sessão da página (e por login): depois disso o recorte que a pessoa escolheu numa tela segue nas outras.
let aplicadoParaToken: string | null = null;
const tokenAtual = () => {
  try {
    return localStorage.getItem("token") ?? "";
  } catch {
    return "";
  }
};

/** Aplica o padrão do usuário no filtro do RH (uma vez por sessão) e diz quando as telas já podem consultar. Usado por useRh. */
export function useAplicarPadroesRh(): boolean {
  const f = useFiltroRh();
  const [opcoes, setOpcoes] = useState<OpcoesRh | null>(null);
  const [opcoesFalharam, setOpcoesFalharam] = useState(false);
  const { padroes } = usePadroesFiltros(TELA_RH);
  const [jaAplicado] = useState(() => aplicadoParaToken === tokenAtual());

  useEffect(() => {
    let vivo = true;
    buscarOpcoes().then(
      (o) => vivo && setOpcoes(o),
      () => vivo && setOpcoesFalharam(true)
    );
    return () => {
      vivo = false;
    };
  }, []);

  const empresaSalva = padroes && "empresa" in padroes ? regras.valorUnico("number", opcoes?.empresas.map((o) => o.valor), { nuloOk: true })(padroes.empresa) : null;
  const empresaEfetiva = empresaSalva?.ok ? empresaSalva.valor : f.empresa;

  const p = usePadroesTela({
    tela: TELA_RH,
    campos: camposRh(f, opcoes, empresaEfetiva),
    opcoesProntas: !!opcoes,
    opcoesFalharam,
    daUrl: jaAplicado ? CAMPOS_RH : [],
  });
  useEffect(() => {
    if (p.pronto) aplicadoParaToken = tokenAtual();
  }, [p.pronto]);
  return p.pronto;
}
