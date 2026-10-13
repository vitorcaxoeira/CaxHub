// Garante que as execuções de uma mesma fila rodem uma de cada vez, na ordem em que foram pedidas.
//
// Achado real (13/10/2026): o "Confirmar Todos" e o cron de 15 min disparam a varredura da fila de
// envio ao Senior quase juntos. As duas liam a mesma lista de pendências e enviavam o mesmo
// apontamento duas vezes (97 pares duplicados em 3 ocorrências). Além da duplicata, a fila depende
// da ordem: o 2º item de uma RAT nova só pode sair depois do write-back do 1º, senão o Senior abre
// uma RAT por item. Por isso a solução é serializar a varredura, não só reservar cada pendência.
//
// Uma falha numa execução não trava as seguintes: cada chamador recebe o resultado (ou o erro) da
// sua própria tarefa.
export function criarFilaUnica(): <T>(tarefa: () => Promise<T>) => Promise<T> {
  let cauda: Promise<unknown> = Promise.resolve();
  return <T>(tarefa: () => Promise<T>): Promise<T> => {
    const execucao = cauda.then(tarefa);
    cauda = execucao.catch(() => undefined);
    return execucao;
  };
}
