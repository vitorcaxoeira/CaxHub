import { Router } from "express";
import { requireAuth } from "../auth/middleware";

export const dashboardRouter = Router();

dashboardRouter.get("/ping", requireAuth, (req, res) => {
  res.json({ ok: true, message: "Dashboard API online" });
});
