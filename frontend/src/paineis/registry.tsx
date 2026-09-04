import { ComponentType } from "react";
import { PainelAtividadesSetor } from "./projetos/PainelAtividadesSetor";
import { PainelHorasMeta } from "./projetos/PainelHorasMeta";
import { PainelEmExecucao } from "./projetos/PainelEmExecucao";

// ---------------------------------------------------------------------------
// Registry id -> componente — GENÉRICO no mecanismo (mapa + fallback), ESPECÍFICO
// do CaxHub na lista de entradas. A fonte da verdade sobre nome/descrição/filtros
// de cada painel é o backend (domain/painelCatalogo.ts, servido por
// GET /painel-tv/catalogo); aqui só decide QUAL componente renderiza cada id.
// ---------------------------------------------------------------------------

export interface PainelProps {
  dados: unknown;
}

// Durante um deploy o bundle da TV pode ficar desatualizado por alguns segundos e
// receber um painelId que ele ainda não conhece (painel novo configurado antes do
// deploy do frontend terminar) — cai aqui, nunca em `undefined`, que derrubaria a
// árvore inteira num telão de recepção. O motor de rotação segue normalmente pro
// próximo painel no timer seguinte.
function PainelIndisponivel() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background">
      <p className="font-mono text-3xl text-muted">Painel indisponível — atualizando...</p>
    </div>
  );
}

const REGISTRY: Record<string, ComponentType<PainelProps>> = {
  "projetos-atividades-setor": PainelAtividadesSetor,
  "projetos-horas-meta": PainelHorasMeta,
  "projetos-em-execucao": PainelEmExecucao,
};

export function componentePara(painelId: string): ComponentType<PainelProps> {
  return REGISTRY[painelId] ?? PainelIndisponivel;
}
