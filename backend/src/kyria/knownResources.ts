// Lista estática dos 9 endpoints GET de coleção oficialmente documentados pra integração
// externa (ver [[api-kyria]] no segundo cérebro / comentário em client.ts) — usada só como
// atalho na tela de Mapeamento de Campos, pra não obrigar o admin a digitar o caminho toda
// vez. `/tickets/{id}` fica de fora (precisa de um ID real, não só `limit=1`) — coberto pelo
// campo de caminho customizado da tela. `openApiSchemaName` foi conferido contra o
// `components.schemas` real do OpenAPI (18/09/2026) — usado só pra sugerir tipo/nullable/enum
// no preview, nunca decide nada sozinho.
export interface KyriaKnownResource {
  path: string;
  displayName: string;
  openApiSchemaName?: string;
}

export const KYRIA_KNOWN_RESOURCES: KyriaKnownResource[] = [
  { path: "/teams", displayName: "Times", openApiSchemaName: "Team" },
  { path: "/tickets", displayName: "Tickets", openApiSchemaName: "Ticket" },
  { path: "/customers", displayName: "Clientes", openApiSchemaName: "Customer" },
  { path: "/projects", displayName: "Projetos", openApiSchemaName: "Project" },
  { path: "/ticket-statuses", displayName: "Status de Ticket", openApiSchemaName: "TicketStatus" },
  { path: "/ticket-fields", displayName: "Campos de Ticket", openApiSchemaName: "TicketField" },
  { path: "/label-groups", displayName: "Grupos de Etiqueta", openApiSchemaName: "LabelGroup" },
  { path: "/labels", displayName: "Etiquetas", openApiSchemaName: "Label" },
  { path: "/members", displayName: "Membros", openApiSchemaName: "Member" },
];
