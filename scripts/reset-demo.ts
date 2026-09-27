// Between rehearsals: clean up fake buyers, undo every fix (resumes sequences,
// restores the planted problems) and rebaseline the gate. Same as /ready → Reset demo.
import { demoReset } from "@crash/core";
import { prisma } from "@crash/db";

demoReset()
  .then((r) => r.log.forEach((l) => console.log(`✓ ${l}`)))
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
