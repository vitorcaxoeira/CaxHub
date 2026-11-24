import axios from "axios";
import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/ui/Toast";
import { ROTULO_VISAO, VisaoAtividades, visaoPadraoDe } from "../lib/atividadesVisao";

// Visão padrão de Atividades do usuário logado (vem com o usuário, de /auth/me) e a gravação dela em PUT /api/perfil/preferencias.
// Usado pela estrela ao lado das abas e por Perfil › Preferências.
export function useVisaoPadraoAtividades() {
  const { user, atualizarUsuario } = useAuth();
  const { mostrar } = useToast();
  const [salvando, setSalvando] = useState(false);
  const padrao = visaoPadraoDe(user?.preferencias?.atividadesVisao);

  async function salvar(visao: VisaoAtividades): Promise<boolean> {
    if (salvando) return false;
    setSalvando(true);
    try {
      const { data } = await axios.put("/api/perfil/preferencias", { atividadesVisao: visao });
      atualizarUsuario({ preferencias: data.preferencias });
      mostrar(`Atividades vai abrir em ${ROTULO_VISAO[visao]}`, "success");
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
