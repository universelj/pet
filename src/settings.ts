import {
  DEEPSEEK_BASE_URL_STORAGE,
  DEEPSEEK_KEY_STORAGE,
  DEEPSEEK_MODEL_STORAGE,
  deleteLocalPet,
  getAllPets,
  getPetById,
  getStoredPetId,
  normalizePetManifest,
  PERSONA_STORAGE,
  PET_BROADCAST_CHANNEL,
  PET_STORAGE_KEY,
  saveLocalPet,
  type PetDefinition,
  type RawPetManifest
} from "./pets";
import "./settings.css";

function requireElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Settings element was not found: ${selector}`);
  }

  return element;
}

const listElement = requireElement<HTMLElement>("#pet-list");
const importFolderButton = requireElement<HTMLButtonElement>("#import-folder");
const folderChooser = requireElement<HTMLInputElement>("#folder-input");
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab"));
const petsPanelElement = requireElement<HTMLElement>("#pets-panel");
const chatPanelElement = requireElement<HTMLElement>("#chat-panel");
const apiKeyElement = requireElement<HTMLInputElement>("#api-key");
const rememberKeyElement = requireElement<HTMLInputElement>("#remember-key");
const modelElement = requireElement<HTMLInputElement>("#model");
const baseUrlElement = requireElement<HTMLInputElement>("#base-url");
const personaElement = requireElement<HTMLTextAreaElement>("#persona");
const petChannel = new BroadcastChannel(PET_BROADCAST_CHANNEL);
let selectedPetId = getPetById(getStoredPetId())?.id ?? "";

function hydrateChatSettings() {
  const savedKey = localStorage.getItem(DEEPSEEK_KEY_STORAGE);
  const savedModel = localStorage.getItem(DEEPSEEK_MODEL_STORAGE);
  const savedBaseUrl = localStorage.getItem(DEEPSEEK_BASE_URL_STORAGE);
  const savedPersona = localStorage.getItem(PERSONA_STORAGE);

  if (savedKey) {
    apiKeyElement.value = savedKey;
    rememberKeyElement.checked = true;
  }

  if (savedModel) {
    modelElement.value = savedModel;
  }

  if (savedBaseUrl) {
    baseUrlElement.value = savedBaseUrl;
  }

  if (savedPersona) {
    personaElement.value = savedPersona;
  }
}

function persistChatSettings() {
  localStorage.setItem(DEEPSEEK_MODEL_STORAGE, modelElement.value.trim() || "deepseek-v4-flash");
  localStorage.setItem(DEEPSEEK_BASE_URL_STORAGE, baseUrlElement.value.trim() || "https://api.deepseek.com");
  localStorage.setItem(PERSONA_STORAGE, personaElement.value.trim());

  if (rememberKeyElement.checked) {
    localStorage.setItem(DEEPSEEK_KEY_STORAGE, apiKeyElement.value.trim());
  } else {
    localStorage.removeItem(DEEPSEEK_KEY_STORAGE);
  }
}

function drawPreview(canvas: HTMLCanvasElement, pet: PetDefinition) {
  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  const pixelRatio = window.devicePixelRatio || 1;
  const width = 96;
  const height = 104;
  const image = new Image();

  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  image.addEventListener("load", () => {
    context.clearRect(0, 0, width, height);
    context.drawImage(
      image,
      0,
      0,
      pet.manifest.atlas.cellWidth,
      pet.manifest.atlas.cellHeight,
      0,
      0,
      width,
      height
    );
  });
  image.addEventListener("error", () => {
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#edf1f7";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#667085";
    context.font = "12px sans-serif";
    context.textAlign = "center";
    context.fillText("加载失败", width / 2, height / 2);
  });
  image.src = pet.spritesheetUrl;
}

function persistSelectedPet(petId: string) {
  selectedPetId = petId;

  if (selectedPetId) {
    localStorage.setItem(PET_STORAGE_KEY, selectedPetId);
  } else {
    localStorage.removeItem(PET_STORAGE_KEY);
  }
}

function selectPet(petId: string) {
  const nextPet = getPetById(petId);

  persistSelectedPet(nextPet?.id ?? "");
  petChannel.postMessage({ petId: selectedPetId });
  render();
}

function renderEmptyState() {
  const empty = document.createElement("section");
  const title = document.createElement("strong");
  const body = document.createElement("p");

  empty.className = "empty-pets";
  title.textContent = "还没有本地宠物";
  body.textContent = "点击右上角“加载文件夹”，选择包含 pet.json 和 spritesheet.webp 的文件夹。";
  empty.append(title, body);
  listElement.append(empty);
}

function deletePet(pet: PetDefinition) {
  const confirmed = window.confirm(`删除宠物“${pet.manifest.displayName}”？`);

  if (!confirmed) {
    return;
  }

  const deletedSelectedPet = selectedPetId === pet.id;
  deleteLocalPet(pet.id);

  if (deletedSelectedPet) {
    const fallbackPet = getPetById("");
    persistSelectedPet(fallbackPet?.id ?? "");
    petChannel.postMessage({ deletedPetId: pet.id, petId: selectedPetId });
  } else {
    petChannel.postMessage({ deletedPetId: pet.id });
  }

  render();
}

function renderPetOption(pet: PetDefinition) {
  const item = document.createElement("article");
  const preview = document.createElement("canvas");
  const text = document.createElement("span");
  const name = document.createElement("strong");
  const description = document.createElement("small");
  const actions = document.createElement("div");
  const deleteButton = document.createElement("button");

  item.className = "pet-option";
  item.dataset.selected = String(pet.id === selectedPetId);
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.setAttribute("aria-label", `选择 ${pet.manifest.displayName}`);
  name.textContent = pet.manifest.displayName;
  description.textContent =
    pet.origin === "bundled"
      ? `${pet.manifest.description} 内置`
      : `${pet.manifest.description} 本地`;
  text.append(name, description);
  actions.className = "pet-actions";
  if (pet.origin === "local") {
    deleteButton.type = "button";
    deleteButton.className = "delete-pet";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deletePet(pet);
    });
    actions.append(deleteButton);
  }
  item.append(preview, text, actions);
  item.addEventListener("click", () => selectPet(pet.id));
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectPet(pet.id);
    }
  });
  listElement.append(item);
  drawPreview(preview, pet);
}

function render() {
  const pets = getAllPets();

  if (selectedPetId && !pets.some((pet) => pet.id === selectedPetId)) {
    persistSelectedPet(pets[0]?.id ?? "");
  }

  listElement.replaceChildren();

  if (pets.length === 0) {
    renderEmptyState();
    return;
  }

  for (const pet of pets) {
    renderPetOption(pet);
  }
}

function setTab(tab: "pets" | "chat") {
  for (const button of tabs) {
    button.dataset.active = String(button.dataset.tab === tab);
  }

  petsPanelElement.hidden = tab !== "pets";
  chatPanelElement.hidden = tab !== "chat";
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

async function importPetFolder(files: FileList | null) {
  const fileArray = Array.from(files || []);
  const manifestFile = fileArray.find((file) => file.name.toLowerCase() === "pet.json");
  const spriteFile = fileArray.find((file) => /^spritesheet\.(webp|png)$/i.test(file.name));

  if (!manifestFile || !spriteFile) {
    window.alert("请选择包含 pet.json 和 spritesheet.webp 或 spritesheet.png 的文件夹。");
    return;
  }

  try {
    const manifest = JSON.parse(await manifestFile.text()) as RawPetManifest;
    const normalizedManifest = normalizePetManifest(manifest);
    const spritesheetDataUrl = await readFileAsDataUrl(spriteFile);
    const id = `local:${normalizedManifest.id}`;

    saveLocalPet({
      id,
      manifest: normalizedManifest,
      spritesheetDataUrl
    });
    selectPet(id);
    folderChooser.value = "";
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
}

for (const button of tabs) {
  button.addEventListener("click", () => setTab(button.dataset.tab === "chat" ? "chat" : "pets"));
}

importFolderButton.addEventListener("click", () => folderChooser.click());
folderChooser.setAttribute("webkitdirectory", "");
folderChooser.addEventListener("change", () => void importPetFolder(folderChooser.files));

for (const element of [modelElement, baseUrlElement, personaElement, rememberKeyElement]) {
  element.addEventListener("change", persistChatSettings);
}

personaElement.addEventListener("input", persistChatSettings);
apiKeyElement.addEventListener("change", persistChatSettings);
window.addEventListener("beforeunload", () => {
  petChannel.close();
});

hydrateChatSettings();
setTab("pets");
render();
