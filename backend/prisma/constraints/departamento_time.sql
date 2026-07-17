ALTER TABLE "departamento_time" ADD CONSTRAINT "chk_departamento_time_depexe" CHECK ("depexe" IN ('00', '01', '02', '03', '04', '05', '06', '08', '09', '10', '11', '12', '13'));
ALTER TABLE "departamento_time" ADD CONSTRAINT "chk_departamento_time_sitreg" CHECK ("sitreg" IN ('A', 'I'));
