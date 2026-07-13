# CaxHub

Dashboard web que sincroniza dados de uma API SOAP legada para um Postgres local e os exibe em um frontend React, com autenticação e permissões por papel (RBAC).

## Arquitetura

- **backend/**: Node.js + TypeScript + Express + Prisma. Expõe a API REST, sincroniza dados da API SOAP para o Postgres e cuida de autenticação/RBAC.
- **frontend/**: React + Vite + TypeScript. Dashboard consumindo a API REST do backend.
- **deploy/**: configuração de Nginx para servir o frontend e fazer proxy do backend.
- **docker-compose.yml**: sobe `db` (Postgres), `backend` e `frontend` juntos.

## Rodando localmente

```bash
cp backend/.env.example backend/.env   # preencher com credenciais reais
docker compose up --build
```

- Frontend: http://localhost (porta 80, via Nginx)
- Backend: http://localhost:3001

## Deploy na VPS (Hostinger)

1. `git pull` no servidor.
2. Criar/atualizar `backend/.env` com as credenciais de produção (nunca commitar esse arquivo).
3. `docker compose up -d --build`.
4. Configurar HTTPS com Certbot apontando para o Nginx (fora do escopo deste scaffold inicial).

## Banco de dados / Prisma

Este scaffold ainda não tem uma migration versionada (`prisma/migrations`) porque foi gerado sem um Postgres local disponível para rodar `prisma migrate dev`. No container do backend, o `db push` aplica o schema diretamente no banco na subida.

Assim que tiver o ambiente com Docker rodando, gere a primeira migration de verdade:

```bash
cd backend
docker compose up -d db   # sobe só o banco
npx prisma migrate dev --name init
```

Depois disso, trocar o `CMD` do `backend/Dockerfile` de `prisma db push` para `prisma migrate deploy`.

## Notas de integração

- A API SOAP recebe o SQL a ser executado e devolve JSON encapsulado em um envelope SOAP. O módulo `backend/src/soap` faz essa chamada e o parse da resposta.
- As queries reais de cada tela/relatório do dashboard ainda serão adicionadas — hoje o job de sincronização (`backend/src/sync`) tem apenas um exemplo placeholder.
