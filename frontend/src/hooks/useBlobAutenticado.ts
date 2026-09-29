import axios from "axios";
import { useEffect, useState } from "react";

// Arquivos enviados (fotos do 5S, comprovantes de despesa) só saem por rota autenticada, então
// <img src> puro não funciona: busca o blob com o header de autorização (axios global) e devolve
// um objectURL, revogado ao desmontar ou trocar de URL. `null` = não buscar (ou ainda carregando).
export function useBlobAutenticado(url: string | null): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let criado: string | null = null;
    let cancelado = false;
    axios
      .get(url, { responseType: "blob" })
      .then(({ data }) => {
        if (cancelado) return;
        criado = URL.createObjectURL(data);
        setObjectUrl(criado);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
      if (criado) URL.revokeObjectURL(criado);
      setObjectUrl(null);
    };
  }, [url]);
  return objectUrl;
}
