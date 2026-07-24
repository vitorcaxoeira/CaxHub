// EstruturaAtividade.nome é VarChar(200) (ver prisma/schema.prisma), mas os nomes vêm de
// campos bem mais largos do Senior (PropostaItem.despro é VarChar(2000)) ou de texto
// digitado livremente no modal de alocação — sem truncar antes de gravar, o Postgres
// rejeita o insert com "value too long for type character varying".
export const NOME_ESTRUTURA_MAX_LENGTH = 200;

export function truncarNomeEstrutura(nome: string): string {
  return nome.length > NOME_ESTRUTURA_MAX_LENGTH ? `${nome.slice(0, NOME_ESTRUTURA_MAX_LENGTH - 3)}...` : nome;
}
