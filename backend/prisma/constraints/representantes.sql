ALTER TABLE "representantes" ADD CONSTRAINT "chk_representantes_tiprep" CHECK ("tiprep" IN ('J', 'F'));
ALTER TABLE "representantes" ADD CONSTRAINT "chk_representantes_sitrep" CHECK ("sitrep" IN ('A', 'I'));
