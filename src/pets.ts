import miaomiaoManifest from "./assets/pet/pet.json";
import miaomiaoSpritesheet from "./assets/pet/spritesheet.webp";

export type PetState =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

export type PetRow = {
  state: PetState;
  row: number;
  frames: number;
};

export type PetManifest = {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string;
  atlas: {
    cellWidth: number;
    cellHeight: number;
    columns: number;
    rows: number;
  };
  animations: PetRow[];
};

export type RawPetManifest = Partial<PetManifest> & {
  display_name?: unknown;
};

export type PetDefinition = {
  id: string;
  manifest: PetManifest;
  spritesheetUrl: string;
  origin: "bundled" | "local";
};

export type StoredLocalPet = {
  id: string;
  manifest: RawPetManifest;
  spritesheetDataUrl: string;
};

const DEFAULT_ATLAS = {
  cellWidth: 192,
  cellHeight: 208,
  columns: 8,
  rows: 9
};

const DEFAULT_ANIMATIONS: PetRow[] = [
  { state: "idle", row: 0, frames: 6 },
  { state: "running-right", row: 1, frames: 8 },
  { state: "running-left", row: 2, frames: 8 },
  { state: "waving", row: 3, frames: 4 },
  { state: "jumping", row: 4, frames: 5 },
  { state: "failed", row: 5, frames: 8 },
  { state: "waiting", row: 6, frames: 6 },
  { state: "running", row: 7, frames: 6 },
  { state: "review", row: 8, frames: 6 }
];

export const BUNDLED_PETS: PetDefinition[] = [
  {
    id: "miaomiao",
    manifest: normalizePetManifest(miaomiaoManifest as RawPetManifest),
    spritesheetUrl: miaomiaoSpritesheet,
    origin: "bundled"
  }
];

export const PET_STORAGE_KEY = "aipet:selected-pet";
export const PET_BROADCAST_CHANNEL = "aipet-pet";
export const CUSTOM_PETS_STORAGE_KEY = "aipet:custom-pets";
export const DEEPSEEK_KEY_STORAGE = "aipet:deepseek-api-key";
export const DEEPSEEK_MODEL_STORAGE = "aipet:deepseek-model";
export const DEEPSEEK_BASE_URL_STORAGE = "aipet:deepseek-base-url";
export const PERSONA_STORAGE = "aipet:pet-persona";

function hasUsableSpriteData(value: unknown): value is string {
  return typeof value === "string" && /^data:image\/(png|webp);base64,/i.test(value);
}

function sanitizeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "local-pet";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStoredLocalPets(strict = false): StoredLocalPet[] {
  const raw = localStorage.getItem(CUSTOM_PETS_STORAGE_KEY);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error("本地宠物数据格式不正确。");
    }

    return parsed.filter((pet): pet is StoredLocalPet => {
      return (
        isObject(pet) &&
        typeof pet.id === "string" &&
        isObject(pet.manifest) &&
        hasUsableSpriteData(pet.spritesheetDataUrl)
      );
    });
  } catch (error) {
    if (strict) {
      throw error;
    }

    console.warn("本地宠物数据读取失败。", error);
    return [];
  }
}

export function normalizePetManifest(input: RawPetManifest): PetManifest {
  const snakeName = typeof input.display_name === "string" ? input.display_name.trim() : "";
  const fallbackName = snakeName || "本地宠物";
  const idSource = typeof input.id === "string" && input.id.trim() ? input.id.trim() : fallbackName;
  const displayName =
    typeof input.displayName === "string" && input.displayName.trim()
      ? input.displayName.trim()
      : fallbackName;
  const description =
    typeof input.description === "string" && input.description.trim()
      ? input.description.trim()
      : "一个从本地导入的桌宠。";
  const atlas = isObject(input.atlas) ? input.atlas : {};

  return {
    id: sanitizeId(idSource),
    displayName,
    description,
    spritesheetPath:
      typeof input.spritesheetPath === "string" && input.spritesheetPath.trim()
        ? input.spritesheetPath.trim()
        : "spritesheet.webp",
    atlas: {
      ...DEFAULT_ATLAS,
      ...atlas
    },
    animations: Array.isArray(input.animations) && input.animations.length > 0 ? input.animations : DEFAULT_ANIMATIONS
  };
}

export function loadLocalPets(): PetDefinition[] {
  return readStoredLocalPets().map((pet) => {
    const manifest = normalizePetManifest(pet.manifest);

    return {
      id: pet.id || `local:${manifest.id}`,
      manifest,
      spritesheetUrl: pet.spritesheetDataUrl,
      origin: "local" as const
    };
  });
}

export function getAllPets() {
  return [...BUNDLED_PETS, ...loadLocalPets()];
}

export function saveLocalPet(pet: StoredLocalPet) {
  if (!hasUsableSpriteData(pet.spritesheetDataUrl)) {
    throw new Error("宠物 spritesheet 必须是 PNG 或 WebP 图片。");
  }

  const manifest = normalizePetManifest(pet.manifest);
  const id = pet.id || `local:${manifest.id}`;
  const existing = readStoredLocalPets(true).filter((item) => item.id !== id);
  const next: StoredLocalPet[] = [
    ...existing,
    {
      id,
      manifest,
      spritesheetDataUrl: pet.spritesheetDataUrl
    }
  ];

  localStorage.setItem(CUSTOM_PETS_STORAGE_KEY, JSON.stringify(next));
}

export function deleteLocalPet(id: string) {
  const next = readStoredLocalPets(true).filter((item) => item.id !== id);
  localStorage.setItem(CUSTOM_PETS_STORAGE_KEY, JSON.stringify(next));
}

export function getStoredPetId() {
  return localStorage.getItem(PET_STORAGE_KEY) || BUNDLED_PETS[0].id;
}

export function getPetById(id: string): PetDefinition | null {
  const pets = getAllPets();

  return pets.find((pet) => pet.id === id) ?? pets[0] ?? null;
}
