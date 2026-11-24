import { useEffect, useState, type ReactNode } from "react";
import { SelectFiltro } from "../ui/ControlesFiltro";
import { PRESETS_PERIODO, PeriodoEstado, PresetPeriodo } from "../../utils/periodo";

const campo =
  "rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Tempo sem mexer nas datas para o período digitado valer, quando a pessoa não sai do campo. */
const ESPERA_DIGITACAO_MS = 2000;

interface SeletorPeriodoProps {
  periodo: PeriodoEstado;
  /** Rótulo do intervalo, ex.: "Recebido entre" (aparece antes das datas). */
  rotuloDatas: string;
  /** Chamado a cada mudança de período (as telas usam pra voltar pra página 1). */
  onAlterar?: () => void;
  /** Botão no canto do campo de período (a estrela de padrão do filtro): salva o preset, ou as datas se for "Personalizado". */
  acessorio?: ReactNode;
}

/**
 * O período digitado pode valer? As duas datas completas e o início antes do fim. O campo de data muda a cada tecla (o ano passa por
 * "0002", "0020", "0202"…): ano antes de 1900 é digitação em andamento, não avisa.
 */
export function avaliarDatasDigitadas(de: string, ate: string): { valido: boolean; aviso: string | null } {
  const completa = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number(d.slice(0, 4)) >= 1900;
  if (!completa(de) || !completa(ate)) return { valido: false, aviso: null };
  if (ate < de) return { valido: false, aviso: "A data final não pode ser anterior à inicial" };
  return { valido: true, aviso: null };
}

/** O que muda no período ao aplicar as datas digitadas (null: nada a aplicar, ou ainda inválidas). */
export function mudancaDasDatas(digitado: { de: string; ate: string }, atual: { de: string; ate: string }): { de?: string; ate?: string } | null {
  if (!avaliarDatasDigitadas(digitado.de, digitado.ate).valido) return null;
  if (digitado.de === atual.de && digitado.ate === atual.ate) return null;
  return { ...(digitado.de !== atual.de && { de: digitado.de }), ...(digitado.ate !== atual.ate && { ate: digitado.ate }) };
}

// Campo "Período" com presets + De/Até, na nomenclatura do RH. As datas ficam sempre preenchidas.
//
// As datas digitadas só viram o período (e a tela só busca) quando a pessoa termina (28/10/2026): ao sair das duas datas, ao teclar
// Enter ou depois de 2 s sem mexer. Antes, cada campo alterado (dia, Tab, mês, Tab, ano) já era uma data válida e disparava uma busca;
// no Consumo da Prevale isso esgotava as conexões do banco e o cliente via "Erro ao consultar os dados do Plannix". O atalho de período
// continua valendo na hora.
export function SeletorPeriodo({ periodo, rotuloDatas, onAlterar, acessorio }: SeletorPeriodoProps) {
  const [digitado, setDigitado] = useState({ de: periodo.de, ate: periodo.ate });
  // O período mudou de fora (atalho, link de outra tela, ou as datas aplicadas): os campos acompanham.
  useEffect(() => setDigitado({ de: periodo.de, ate: periodo.ate }), [periodo.de, periodo.ate]);

  const aplicar = () => {
    const mudanca = mudancaDasDatas(digitado, periodo);
    if (!mudanca) return;
    if (mudanca.de) periodo.alterarDe(mudanca.de);
    if (mudanca.ate) periodo.alterarAte(mudanca.ate);
    onAlterar?.();
  };

  // 2 s sem mexer: vale mesmo sem sair do campo.
  useEffect(() => {
    if (!mudancaDasDatas(digitado, periodo)) return;
    const espera = setTimeout(aplicar, ESPERA_DIGITACAO_MS);
    return () => clearTimeout(espera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digitado.de, digitado.ate, periodo.de, periodo.ate]);

  const aviso = avaliarDatasDigitadas(digitado.de, digitado.ate).aviso;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted">Período:</span>
        <SelectFiltro
          aria-label="Período"
          className="w-48"
          acessorio={acessorio}
          value={periodo.preset}
          onChange={(e) => {
            periodo.aplicarPreset(e.target.value as PresetPeriodo);
            onAlterar?.();
          }}
        >
          {PRESETS_PERIODO.map((p) => (
            <option key={p.valor} value={p.valor}>
              {p.rotulo}
            </option>
          ))}
        </SelectFiltro>
      </div>
      <div
        className="flex flex-wrap items-center gap-2"
        // Sair das duas datas aplica; ir de uma data para a outra (Tab) não.
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) aplicar();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") aplicar();
        }}
      >
        <span className="text-sm text-muted">{rotuloDatas}:</span>
        <input
          type="date"
          className={campo}
          value={digitado.de}
          max={digitado.ate}
          aria-invalid={!!aviso}
          onChange={(e) => setDigitado((d) => ({ ...d, de: e.target.value }))}
        />
        <span className="text-sm text-muted">até</span>
        <input
          type="date"
          className={campo}
          value={digitado.ate}
          min={digitado.de}
          aria-invalid={!!aviso}
          onChange={(e) => setDigitado((d) => ({ ...d, ate: e.target.value }))}
        />
      </div>
      {aviso && <span className="text-[12px] text-destructive">{aviso}</span>}
    </div>
  );
}
