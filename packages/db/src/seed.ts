// Seeded defaults (§19): test library, fix modes, settings. Idempotent.
import { DEFAULT_MODES, DEFAULT_SETTINGS, TEST_DEFS } from "@crash/shared";
import { prisma } from "./index";

export async function seedDefaults() {
  for (const t of TEST_DEFS) {
    await prisma.testDefinition.upsert({
      where: { id: t.id },
      create: { id: t.id, name: t.name, area: t.area, weight: t.weight, tier: t.tier, enabled: t.enabled },
      update: { name: t.name, area: t.area, tier: t.tier },
    });
  }
  for (const [action, mode] of Object.entries(DEFAULT_MODES)) {
    await prisma.fixModeSetting.upsert({
      where: { action: action as keyof typeof DEFAULT_MODES },
      create: { action: action as keyof typeof DEFAULT_MODES, mode },
      update: {},
    });
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: {} });
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seedDefaults()
    .then(() => console.log("Seeded test library, fix modes and settings."))
    .finally(() => prisma.$disconnect());
}
