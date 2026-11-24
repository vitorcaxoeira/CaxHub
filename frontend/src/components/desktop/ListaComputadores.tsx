// Lista de computadores com o CaxHub Desktop conectado: nome, último uso e "Desconectar". Mesma
// aparência no Meu perfil (o próprio usuário) e no modal da tela de Usuários (o administrador).

export interface ComputadorConectado {
  id: number;
  nome: string;
  ultimoUsoEm: string;
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function ListaComputadores({
  computadores,
  onDesconectar,
  desabilitado = false,
}: {
  computadores: ComputadorConectado[];
  onDesconectar: (id: number) => void;
  desabilitado?: boolean;
}) {
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {computadores.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="min-w-0">
            <span className="block truncate text-sm text-foreground">{c.nome}</span>
            <span className="block text-xs text-muted">Último uso: {formatarData(c.ultimoUsoEm)}</span>
          </span>
          <button
            type="button"
            onClick={() => onDesconectar(c.id)}
            disabled={desabilitado}
            className="flex-none rounded-md border border-border px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            Desconectar
          </button>
        </li>
      ))}
    </ul>
  );
}
