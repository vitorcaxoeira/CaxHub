import axios from "axios";
import { useEffect, useState } from "react";
import { ListaComputadores, ComputadorConectado } from "../desktop/ListaComputadores";
import { Modal } from "../ui/Modal";
import { Skeleton } from "../ui/Skeleton";

// Modal da tela de Usuários: os computadores com o CaxHub Desktop conectado de UM usuário, com a
// mesma lista do Meu perfil. O administrador pode desconectar (PC perdido, colaborador que saiu):
// o app daquele computador volta pro login na próxima troca de token.
//
// `onAlterado` devolve quantos sobraram, pra tela pai atualizar a coluna e o KPI sem recarregar a
// lista inteira. Quando o último é desconectado o modal fecha sozinho: não há mais o que mostrar.
export function ModalComputadoresUsuario({
  usuario,
  onFechar,
  onAlterado,
}: {
  usuario: { id: number; nome: string };
  onFechar: () => void;
  onAlterado: (restantes: number) => void;
}) {
  const [computadores, setComputadores] = useState<ComputadorConectado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [desconectando, setDesconectando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    axios
      .get(`/api/users/${usuario.id}/desktop`)
      .then(({ data }) => !cancelado && setComputadores(data.dispositivos))
      .catch((err) => !cancelado && setErro(err.response?.data?.error ?? "Falha ao carregar os computadores"));
    return () => {
      cancelado = true;
    };
  }, [usuario.id]);

  async function desconectar(id: number) {
    setDesconectando(true);
    setErro(null);
    try {
      await axios.delete(`/api/users/${usuario.id}/desktop/${id}`);
      const restantes = (computadores ?? []).filter((c) => c.id !== id);
      setComputadores(restantes);
      onAlterado(restantes.length);
      if (restantes.length === 0) onFechar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao desconectar o computador");
    } finally {
      setDesconectando(false);
    }
  }

  return (
    <Modal open onClose={onFechar} title="Computadores conectados" subtitulo={usuario.nome}>
      <div className="p-4">
        {erro && (
          <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {erro}
          </p>
        )}
        {computadores === null && !erro && <Skeleton className="h-14 w-full rounded-md" />}
        {computadores !== null && computadores.length > 0 && (
          <ListaComputadores computadores={computadores} onDesconectar={(id) => void desconectar(id)} desabilitado={desconectando} />
        )}
        {computadores !== null && computadores.length === 0 && (
          <p className="text-sm text-muted">Nenhum computador conectado.</p>
        )}
      </div>
    </Modal>
  );
}
