import { useEffect, useRef, useState, type ReactNode } from "react";
import { useToast } from "../Toast";
import { BotaoPadraoFiltro } from "./BotaoPadraoFiltro";
import { estadoPadrao, type Validador } from "./regras";
import { usePadroesFiltros } from "./usePadroesFiltros";

/** Um filtro da tela que pode ter padrão salvo. O nome (chave em `campos`) é ESTÁVEL; o rótulo é o que aparece na estrela e nos avisos. */
export interface DefCampo {
  rotulo: string;
  /** Valor atual, no formato em que é salvo (o mesmo que `validar` aceita). */
  atual: unknown;
  /** Recebe o valor JÁ validado e põe no estado da tela. */
  aplicar: (valor: never) => void;
  validar: Validador;
  /** A validação não depende das opções do filtro (texto, booleano, período...): aplica sem esperar as opções chegarem. */
  semOpcoes?: boolean;
  /** A ordem do valor importa (par/tupla); por padrão a ordem de uma lista não conta. */
  ordem?: boolean;
  /** Nome do parâmetro na URL, quando difere do nome do campo (telas com estado na URL). */
  urlKey?: string;
}

interface Opcoes {
  /** Chave da tela nas preferências, estável (ex.: "suprimentos.acompanhamento-compra"). */
  tela: string;
  campos: Record<string, DefCampo>;
  /** As opções dos filtros já chegaram (os validadores com lista de existentes precisam delas). */
  opcoesProntas?: boolean;
  /** As opções falharam: os padrões que dependem delas não são aplicados (sem aviso), a tela abre como sempre abriu. */
  opcoesFalharam?: boolean;
  /** Campos que vieram explícitos na URL no 1º render (link, F5): a URL vale mais que o padrão salvo. */
  daUrl?: readonly string[];
  /** Só entrega a estrela de cada campo: não aplica padrão nem avisa (quem aplica é outra instância do hook, ex.: RH). */
  soEstrela?: boolean;
}

/**
 * Padrão de cada filtro de uma tela (03/11/2026): lê os padrões do usuário, aplica UMA vez os que ainda valem (antes da 1ª consulta:
 * a tela só consulta quando `pronto`) e entrega a estrela de cada campo. Padrão que não vale mais com as opções de hoje não é forçado
 * nem apagado: o filtro abre como abriria sem ele e um aviso discreto diz qual ficou de fora.
 */
export function usePadroesTela({ tela, campos, opcoesProntas = true, opcoesFalharam = false, daUrl = [], soEstrela = false }: Opcoes) {
  const { mostrar } = useToast();
  const { padroes, falhou, salvando, salvar, remover } = usePadroesFiltros(tela);
  const [pronto, setPronto] = useState(false);
  const camposRef = useRef(campos);
  camposRef.current = campos;
  const daUrlRef = useRef(new Set(daUrl));

  useEffect(() => {
    if (pronto || padroes === null) return;
    if (soEstrela) {
      setPronto(true);
      return;
    }
    const defs = camposRef.current;
    const aplicaveis = Object.keys(padroes).filter((c) => c in defs && !daUrlRef.current.has(c));
    if (aplicaveis.some((c) => !defs[c].semOpcoes) && !opcoesProntas && !opcoesFalharam) return;
    const recusados: string[] = [];
    for (const c of aplicaveis) {
      const def = defs[c];
      if (!def.semOpcoes && !opcoesProntas) continue;
      const r = def.validar(padroes[c]);
      if (r.ok) def.aplicar(r.valor as never);
      else recusados.push(def.rotulo);
    }
    if (recusados.length) mostrar(`Padrão de ${recusados.join(", ")} não está mais disponível e não foi aplicado`, "warning");
    if (falhou) mostrar("Não foi possível carregar os padrões dos filtros", "warning");
    setPronto(true);
  }, [padroes, opcoesProntas, opcoesFalharam, pronto, falhou, mostrar]);

  const estrela = (campo: string): ReactNode => {
    const def = campos[campo];
    if (!def) return null;
    return (
      <BotaoPadraoFiltro
        nome={def.rotulo}
        estado={estadoPadrao(padroes?.[campo], def.atual, def.ordem)}
        salvando={!!salvando[campo]}
        onSalvar={() => salvar(campo, def.atual)}
        onRemover={() => remover(campo)}
      />
    );
  };

  /**
   * Telas com estado na URL: "Todos" não vai para a URL, então um campo com padrão salvo e valor vazio iria sem parâmetro e o F5 traria o
   * padrão de volta. Aqui ele vai como `campo=` (vazio), que conta como explícito. Altera `params` e o devolve.
   */
  const marcarUrl = (params: Record<string, string>): Record<string, string> => {
    if (!padroes) return params;
    for (const [c, def] of Object.entries(campos)) {
      const chave = def.urlKey ?? c;
      if (c in padroes && !(chave in params)) params[chave] = "";
    }
    return params;
  };

  /** O campo tem padrão salvo? (para telas que só precisam saber isso) */
  const temPadrao = (campo: string) => !!padroes && campo in padroes;

  return { pronto, padroes, estrela, marcarUrl, temPadrao };
}
