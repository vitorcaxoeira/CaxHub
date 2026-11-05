-- Valores do pedido espelhados do Senior (E120PED.VlrBse / VlrBpr, 05/11/2026): soma dos itens de serviços e de produtos.
ALTER TABLE "pedidos" ADD COLUMN "vlrbse" DECIMAL(15,2),
ADD COLUMN "vlrbpr" DECIMAL(15,2);
