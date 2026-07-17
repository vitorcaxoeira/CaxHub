import axios from "axios";
import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";

interface Integrante {
  codusu: number;
  nome: string;
}

interface DepartamentoGerenciado {
  depexe: number;
  depexeLabel: string;
  integrantes: Integrante[];
}

interface MeuPerfil {
  consultor: { nome: string; depexe: number; depexeLabel: string } | null;
  departamentosGerenciados: DepartamentoGerenciado[];
}

export function Home() {
  const { user } = useAuth();
  const [perfil, setPerfil] = useState<MeuPerfil | null>(null);

  useEffect(() => {
    axios
      .get("/api/dashboard/meu-perfil")
      .then(({ data }) => setPerfil(data))
      .catch(() => setPerfil(null));
  }, []);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-surface p-8">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">CaxHub</p>
        <h1 className="mt-2 font-display text-2xl font-bold text-foreground">
          Bem-vindo{user ? `, ${user.nome}` : ""}
        </h1>
        {perfil?.consultor && (
          <p className="mt-1 text-sm text-muted">
            Você está cadastrado como consultor(a) em <span className="text-foreground">{perfil.consultor.depexeLabel}</span>.
          </p>
        )}
        <p className="mt-2 text-sm text-muted">Selecione uma opção no menu para começar.</p>
      </div>

      {perfil && perfil.departamentosGerenciados.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
            Departamentos que você gerencia
          </p>
          <div className="space-y-4">
            {perfil.departamentosGerenciados.map((dep) => (
              <div key={dep.depexe} className="rounded-md border border-border/60 p-4">
                <h3 className="text-sm font-semibold text-foreground">{dep.depexeLabel}</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {dep.integrantes.map((integrante) => (
                    <span
                      key={integrante.codusu}
                      className="rounded bg-muted/15 px-2 py-1 text-[12px] text-muted"
                    >
                      {integrante.nome}
                    </span>
                  ))}
                  {dep.integrantes.length === 0 && (
                    <span className="text-[12px] text-muted">Sem integrantes cadastrados.</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
