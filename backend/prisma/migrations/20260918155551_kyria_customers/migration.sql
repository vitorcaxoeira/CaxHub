-- CreateTable
CREATE TABLE "kyria_customers" (
    "id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "status" "KyriaStatus" NOT NULL,
    "domain_url" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "codcli" INTEGER,
    "sincronizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyria_customers_pkey" PRIMARY KEY ("id")
);
