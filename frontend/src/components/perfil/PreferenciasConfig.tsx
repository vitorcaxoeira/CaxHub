import { useVisaoPadraoAtividades } from "../../hooks/useVisaoPadraoAtividades";
import { ROTULO_VISAO, VISOES_ATIVIDADES, VisaoAtividades } from "../../lib/atividadesVisao";

// Perfil › Preferências: como as telas abrem para o usuário. Grava ao mudar (PUT /api/perfil/preferencias).
export function PreferenciasConfig() {
  const { padrao, salvar, salvando } = useVisaoPadraoAtividades();
  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h2 className="mb-1 font-display text-base font-semibold text-foreground">Preferências</h2>
      <p className="mb-4 text-sm text-muted">Como as telas abrem para você.</p>
      <div className="flex items-center justify-between gap-3 border-t border-border py-3">
        <label htmlFor="pref-atividades-visao">
          <span className="block text-sm font-medium text-foreground">Atividades abre em</span>
          <span className="block text-xs text-muted">Também dá para escolher pela estrela ao lado das abas da tela.</span>
        </label>
        <select
          id="pref-atividades-visao"
          value={padrao}
          disabled={salvando}
          onChange={(e) => void salvar(e.target.value as VisaoAtividades)}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {VISOES_ATIVIDADES.map((v) => (
            <option key={v} value={v}>
              {ROTULO_VISAO[v]}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
