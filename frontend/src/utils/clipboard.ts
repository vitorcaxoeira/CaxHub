// Copia pra área de transferência com fallback — a Clipboard API
// (`navigator.clipboard`) só existe em CONTEXTO SEGURO (HTTPS, ou http://localhost). A VPS
// hoje serve tudo em `listen 80` puro, sem TLS (ver deploy/nginx.conf), acessada por IP —
// `http://179.197.67.226:8080` não é contexto seguro pra nenhum navegador. Sem este
// fallback, `navigator.clipboard` vem `undefined` lá e o botão de copiar simplesmente não
// faz nada, embora funcione em desenvolvimento (`localhost` é uma das exceções).
//
// O fallback é o truque clássico de antes da Clipboard API existir, e é o que bibliotecas
// como clipboard.js ainda usam pra esse caso: um <textarea> fora da tela, selecionado, e
// `document.execCommand("copy")` — API antiga, não mais recomendada como primeira escolha,
// mas sem exigência de contexto seguro e ainda suportada em todo navegador relevante.
export async function copiarParaAreaDeTransferencia(texto: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      // Cai no fallback abaixo — contexto seguro não garante que o clipboard funcione
      // (ex.: permissão negada).
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = texto;
  // Fora da tela, mas ainda focável — execCommand("copy") exige seleção real.
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let copiou = false;
  try {
    copiou = document.execCommand("copy");
  } catch {
    copiou = false;
  }
  document.body.removeChild(textarea);
  return copiou;
}
