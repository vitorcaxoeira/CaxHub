import { useEffect, useState } from "react";

export function useDebouncedValue<T>(valor: T, atrasoMs: number): T {
  const [debounced, setDebounced] = useState(valor);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(valor), atrasoMs);
    return () => clearTimeout(timeout);
  }, [valor, atrasoMs]);

  return debounced;
}
