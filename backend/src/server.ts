import "dotenv/config";
import express from "express";
import { authRouter } from "./auth/routes";
import { dashboardRouter } from "./routes/dashboard";
import { financeiroRouter } from "./routes/financeiro";
import { projetosRouter } from "./routes/projetos";
import { usersRouter } from "./routes/users";
import { scheduleEmpresaSync } from "./sync/empresaSync";
import { scheduleFilialSync } from "./sync/filialSync";
import { scheduleClienteSync } from "./sync/clienteSync";
import { scheduleTipoTituloSync } from "./sync/tipoTituloSync";
import { scheduleTituloReceberSync } from "./sync/tituloReceberSync";
import { scheduleMovimentoTituloReceberSync } from "./sync/movimentoTituloReceberSync";
import { scheduleRepresentanteSync } from "./sync/representanteSync";
import { scheduleCentroCustoSync } from "./sync/centroCustoSync";
import { scheduleMovimentoContaSync } from "./sync/movimentoContaSync";
import { scheduleNaturezaFinanceiraSync } from "./sync/naturezaFinanceiraSync";
import { schedulePortadorSync } from "./sync/portadorSync";
import { scheduleMoedaSync } from "./sync/moedaSync";
import { scheduleTransacaoSync } from "./sync/transacaoSync";
import { schedulePropostaSync } from "./sync/propostaSync";
import { schedulePropostaItemSync } from "./sync/propostaItemSync";
import { scheduleConsultorSync } from "./sync/consultorSync";

const app = express();
app.use(express.json());

app.use("/auth", authRouter);
app.use("/dashboard", dashboardRouter);
app.use("/financeiro", financeiroRouter);
app.use("/projetos", projetosRouter);
app.use("/users", usersRouter);

const port = process.env.PORT ? Number(process.env.PORT) : 3001;

app.listen(port, () => {
  console.log(`CaxHub backend rodando na porta ${port}`);
  scheduleEmpresaSync();
  scheduleFilialSync();
  scheduleClienteSync();
  scheduleTipoTituloSync();
  scheduleTituloReceberSync();
  scheduleMovimentoTituloReceberSync();
  scheduleRepresentanteSync();
  scheduleCentroCustoSync();
  scheduleMovimentoContaSync();
  scheduleNaturezaFinanceiraSync();
  schedulePortadorSync();
  scheduleMoedaSync();
  scheduleTransacaoSync();
  schedulePropostaSync();
  schedulePropostaItemSync();
  scheduleConsultorSync();
});
