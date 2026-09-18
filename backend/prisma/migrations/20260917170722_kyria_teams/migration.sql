-- CreateTable
CREATE TABLE "kyria_teams" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "appearance" JSONB,
    "parent_team_id" TEXT,
    "status" TEXT NOT NULL,
    "sincronizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyria_teams_pkey" PRIMARY KEY ("id")
);
