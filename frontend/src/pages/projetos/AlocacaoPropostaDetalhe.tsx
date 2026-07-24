import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";

// Página só resolve o modo de alocação da proposta e redireciona pro cronograma (EAP) —
// modo "estrutura" é o único que existe pra proposta viva a partir de agora (ver
// resolverModoAlocacao em backend/src/routes/alocacao.ts e a migração de dado em
// backend/prisma/migrarLegadoParaEstrutura.ts, que converteu todo o legado "por item").
// Rota mantida (em vez de apontar direto pro cronograma na navegação) só por segurança:
// se um dia sobrar alguma proposta com PropostaModoAlocacao="item" sem ter passado pela
// migração, cai aqui e mostra um aviso em vez de silenciosamente não fazer nada.
export function AlocacaoPropostaDetalhe() {
  const { codemp, codpro } = useParams<{ codemp: string; codpro: string }>();
  const navigate = useNavigate();
  const [modo, setModo] = useState<"item" | "estrutura" | null | "carregando">("carregando");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    axios
      .get(`/api/alocacao/propostas/${codemp}/${codpro}/modo`)
      .then(({ data }) => setModo(data.modo))
      .catch((err) => {
        setErro(err.response?.data?.error ?? "Falha ao carregar a proposta");
        setModo(null);
      });
  }, [codemp, codpro]);

  useEffect(() => {
    if (modo === "estrutura") {
      navigate(`/projetos/alocacao/${codemp}/${codpro}/cronograma`, { replace: true });
    }
  }, [modo, codemp, codpro, navigate]);

  return (
    <div>
      <button onClick={() => navigate(-1)} className="text-sm text-primary hover:underline">
        ← Voltar pra lista de propostas
      </button>

      {erro && (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {modo === "item" && (
        <p className="mt-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">
          Esta proposta ainda está no modo de alocação antigo ("por item"), que não é mais
          suportado por esta tela — fale com o time técnico pra migrá-la pro modo estrutura.
        </p>
      )}

      {(modo === "carregando" || modo === "estrutura") && (
        <p className="mt-4 text-sm text-muted">Carregando...</p>
      )}
    </div>
  );
}
