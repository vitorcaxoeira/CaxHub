import axios from "axios";
import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/ui/Toast";

// Menu lateral padrão do usuário logado (04/11/2026): "aberto" ou "recolhido" (faixa de ícones). Vem com o usuário (/auth/me) e é gravado
// em PUT /api/perfil/preferencias (backend/src/domain/preferenciasTela.ts, CHECK no banco). Usado pelo AppShell (como o menu abre e para
// onde volta depois de escolher uma tela) e pela estrela ao lado do botão de mostrar/esconder o menu.
export type MenuLateral = "aberto" | "recolhido";

export const ROTULO_MENU: Record<MenuLateral, string> = { aberto: "aberto", recolhido: "recolhido" };

export function menuLateralDe(v: unknown): MenuLateral {
  return v === "recolhido" ? "recolhido" : "aberto";
}

export function useMenuLateralPadrao() {
  const { user, atualizarUsuario } = useAuth();
  const { mostrar } = useToast();
  const [salvando, setSalvando] = useState(false);
  const padrao = menuLateralDe(user?.preferencias?.menuLateral);

  async function salvar(menu: MenuLateral): Promise<boolean> {
    if (salvando) return false;
    setSalvando(true);
    try {
      const { data } = await axios.put("/api/perfil/preferencias", { menuLateral: menu });
      atualizarUsuario({ preferencias: data.preferencias });
      mostrar(`O menu lateral vai abrir sempre ${ROTULO_MENU[menu]}`, "success");
      return true;
    } catch (err: any) {
      mostrar(err.response?.data?.error ?? "Não foi possível salvar a preferência", "destructive");
      return false;
    } finally {
      setSalvando(false);
    }
  }

  return { padrao, salvar, salvando };
}
