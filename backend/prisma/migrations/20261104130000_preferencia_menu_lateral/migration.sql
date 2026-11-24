-- Preferência de tela: o menu lateral abre aberto ou recolhido (04/11/2026, pedido do Vitor; estrela ao lado do botão de mostrar/esconder o
-- menu). Quem nunca escolheu fica com "aberto", como sempre foi. Valores = MENUS_LATERAL em src/domain/preferenciasTela.ts.
ALTER TABLE "preferencias_tela" ADD COLUMN "menuLateral" VARCHAR(10) NOT NULL DEFAULT 'aberto';

ALTER TABLE "preferencias_tela" ADD CONSTRAINT "preferencias_tela_menuLateral_check"
  CHECK ("menuLateral" IN ('aberto', 'recolhido'));
