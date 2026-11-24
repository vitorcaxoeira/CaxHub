-- CreateTable
CREATE TABLE "kyria_customer_hours" (
    "competencia" DATE NOT NULL,
    "customer_id" TEXT NOT NULL,
    "group_type" VARCHAR(32),
    "group_name" VARCHAR(255),
    "minutes" DECIMAL(12,2),
    "sincronizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyria_customer_hours_pkey" PRIMARY KEY ("competencia","customer_id")
);

-- AddForeignKey
ALTER TABLE "kyria_customer_hours" ADD CONSTRAINT "kyria_customer_hours_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "kyria_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
