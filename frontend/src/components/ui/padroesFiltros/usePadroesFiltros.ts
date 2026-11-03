import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "../Toast";

type Padroes = Record<string, unknown>;
type Todos = Record<string, Padroes>;

// Cache de módulo: os padrões do usuário vêm numa leitura só (GET /perfil/filtros) e as telas seguintes abrem sem esperar. A chave é o
// token: outro login na mesma aba lê de novo. Falha não fica no cache (a próxima tela tenta outra vez).
let cache: { token: string; dados: Todos | null; promessa: Promise<Todos> } | null = null;

const tokenAtual = () => {
  try {
    return localStorage.getItem("token") ?? "";
  } catch {
    return "";
  }
};

function carregarTodos(): Promise<Todos> {
  const token = tokenAtual();
  if (cache && cache.token === token) return cache.promessa;
  const promessa = axios.get("/api/perfil/filtros").then(({ data }) => (data?.padroes ?? {}) as Todos);
  const entrada = { token, dados: null as Todos | null, promessa };
  cache = entrada;
  promessa.then(
    (dados) => {
      entrada.dados = dados;
    },
    () => {
      if (cache === entrada) cache = null;
    }
  );
  return promessa;
}

function atualizarCache(tela: string, mudar: (p: Padroes) => Padroes) {
  if (cache?.dados) cache.dados[tela] = mudar(cache.dados[tela] ?? {});
}

/**
 * Padrões dos filtros do usuário numa tela (03/11/2026). `padroes` é null enquanto carrega; se a leitura falhar fica {} (a tela abre como
 * sempre abriu) e `falhou` avisa. Cada salvar/remover mexe em UM campo e só troca o estado local depois que o servidor confirmou.
 */
export function usePadroesFiltros(tela: string) {
  const { mostrar } = useToast();
  const [padroes, setPadroes] = useState<Padroes | null>(() => {
    const pronto = cache && cache.token === tokenAtual() ? cache.dados : null;
    return pronto ? (pronto[tela] ?? {}) : null;
  });
  const [falhou, setFalhou] = useState(false);
  const [salvando, setSalvando] = useState<Record<string, boolean>>({});
  const emCurso = useRef(new Set<string>());
  const url = `/api/perfil/filtros/${tela}`;

  useEffect(() => {
    if (padroes !== null) return;
    let vivo = true;
    carregarTodos().then(
      (todos) => vivo && setPadroes(todos[tela] ?? {}),
      () => {
        if (!vivo) return;
        setPadroes({});
        setFalhou(true);
      }
    );
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tela]);

  const executar = useCallback(
    (campo: string, acao: () => Promise<void>, erro: string) => {
      // Trava duplo clique: o ref responde na hora, o estado só no próximo render.
      if (emCurso.current.has(campo)) return;
      emCurso.current.add(campo);
      setSalvando((s) => ({ ...s, [campo]: true }));
      acao()
        .catch(() => mostrar(erro, "destructive"))
        .finally(() => {
          emCurso.current.delete(campo);
          setSalvando((s) => ({ ...s, [campo]: false }));
        });
    },
    [mostrar]
  );

  const salvar = useCallback(
    (campo: string, valor: unknown) =>
      executar(
        campo,
        async () => {
          const { data } = await axios.put(`${url}/${campo}`, { valor });
          setPadroes((p) => ({ ...p, [campo]: data.valor }));
          atualizarCache(tela, (p) => ({ ...p, [campo]: data.valor }));
          mostrar("Padrão deste filtro salvo", "success");
        },
        "Não foi possível salvar o padrão. Tente novamente"
      ),
    [executar, mostrar, tela, url]
  );

  const remover = useCallback(
    (campo: string) =>
      executar(
        campo,
        async () => {
          await axios.delete(`${url}/${campo}`);
          const sem = (p: Padroes) => {
            const resto = { ...p };
            delete resto[campo];
            return resto;
          };
          setPadroes((p) => sem(p ?? {}));
          atualizarCache(tela, sem);
          mostrar("Padrão deste filtro removido", "success");
        },
        "Não foi possível remover o padrão. Tente novamente"
      ),
    [executar, mostrar, tela, url]
  );

  return { padroes, falhou, salvando, salvar, remover };
}
