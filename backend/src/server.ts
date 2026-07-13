import "dotenv/config";
import express from "express";
import { authRouter } from "./auth/routes";
import { dashboardRouter } from "./routes/dashboard";
import { scheduleEmpresaSync } from "./sync/empresaSync";
import { scheduleFilialSync } from "./sync/filialSync";
import { scheduleClienteSync } from "./sync/clienteSync";

const app = express();
app.use(express.json());

app.use("/auth", authRouter);
app.use("/dashboard", dashboardRouter);

const port = process.env.PORT ? Number(process.env.PORT) : 3001;

app.listen(port, () => {
  console.log(`CaxHub backend rodando na porta ${port}`);
  scheduleEmpresaSync();
  scheduleFilialSync();
  scheduleClienteSync();
});
