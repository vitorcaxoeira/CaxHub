-- CreateEnum
CREATE TYPE "KyriaMemberRole" AS ENUM ('attendant', 'manager', 'requester', 'participant', 'admin', 'service_manager', 'customer_request_manager');

-- CreateTable
CREATE TABLE "kyria_members" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "KyriaStatus" NOT NULL,
    "role" "KyriaMemberRole" NOT NULL,
    "codusu" INTEGER,
    "sincronizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyria_members_pkey" PRIMARY KEY ("id")
);
