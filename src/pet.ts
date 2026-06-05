import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ANIMATION_SETTINGS_STORAGE,
  CLICK_ACTION_STATES,
  DEEPSEEK_BASE_URL_STORAGE,
  DEEPSEEK_KEY_STORAGE,
  DEEPSEEK_MODEL_STORAGE,
  getPetById,
  getStoredPetId,
  loadAnimationSettings,
  PERSONA_STORAGE,
  PET_BROADCAST_CHANNEL,
  PET_SCALE_STORAGE,
  PET_STORAGE_KEY,
  type AnimationSettings,
  type PetDefinition,
  type PetManifest,
  type PetRow,
  type PetState
} from "./pets";
import "./styles.css";

type PetChatMessage = { role: "user" | "assistant"; content: string };

const CHAT_HISTORY_STORAGE = "aipet:chat-history";
const CHAT_HISTORY_LIMIT = 10;

const pet = document.querySelector<HTMLCanvasElement>("#pet");
const chatArea = document.querySelector<HTMLElement>("#chat-area");
const bubbleList = document.querySelector<HTMLElement>("#bubble-list");
const chatForm = document.querySelector<HTMLFormElement>("#pet-chat-form");
const chatInput = document.querySelector<HTMLInputElement>("#pet-chat-input");
const chatSend = document.querySelector<HTMLButtonElement>("#pet-chat-send");
const closeChatButton = document.querySelector<HTMLButtonElement>("#close-chat");

if (!pet || !chatArea || !bubbleList || !chatForm || !chatInput || !chatSend || !closeChatButton) {
  throw new Error("Pet surface was not found.");
}

const petElement = pet;
const chatAreaElement = chatArea;
const bubbleListElement = bubbleList;
const chatFormElement = chatForm;
const chatInputElement = chatInput;
const chatSendElement = chatSend;
const closeChatElement = closeChatButton;
const context = petElement.getContext("2d");

if (!context) {
  throw new Error("Pet canvas context was not available.");
}

const canvasContext = context;
const petChannel = new BroadcastChannel(PET_BROADCAST_CHANNEL);
let activePet: PetDefinition | null = null;
let manifest: PetManifest | null = null;
let spritesheet: HTMLImageElement | null = null;
let currentFrame = 0;
let currentState: PetRow | null = null;
let spriteLoadToken = 0;
let animationTimer: ReturnType<typeof window.setInterval> | undefined;
let returnToIdleTimer: ReturnType<typeof window.setTimeout> | undefined;
let dragTimer: ReturnType<typeof window.setTimeout> | undefined;
let isDragging = false;
let pointerIsDown = false;
let pointerStartX = 0;
let pointerStartY = 0;
let chatHistory: PetChatMessage[] = loadChatHistory();
let petScale = parseFloat(localStorage.getItem(PET_SCALE_STORAGE) || "1.0");
let animationSettings = loadAnimationSettings();

function loadChatHistory(): PetChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_STORAGE);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((message): message is PetChatMessage => {
        return (
          typeof message === "object" &&
          message !== null &&
          ("role" in message && (message.role === "user" || message.role === "assistant")) &&
          ("content" in message && typeof message.content === "string")
        );
      })
      .slice(-CHAT_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function persistChatHistory() {
  localStorage.setItem(CHAT_HISTORY_STORAGE, JSON.stringify(chatHistory.slice(-CHAT_HISTORY_LIMIT)));
}

function clearAnimationTimer() {
  if (animationTimer !== undefined) {
    window.clearInterval(animationTimer);
    animationTimer = undefined;
  }
}

function clearReturnTimer() {
  if (returnToIdleTimer !== undefined) {
    window.clearTimeout(returnToIdleTimer);
    returnToIdleTimer = undefined;
  }
}

function clearDragTimer() {
  if (dragTimer !== undefined) {
    window.clearTimeout(dragTimer);
    dragTimer = undefined;
  }
}

function getAnimation(state: PetState): PetRow | null {
  if (!manifest) {
    return null;
  }

  return manifest.animations.find((row) => row.state === state) ?? manifest.animations[0] ?? null;
}

function getStateSettings(state: PetState) {
  return animationSettings.states[state] ?? {};
}

function getFrameCount(animation: PetRow | null) {
  if (!animation || !manifest) {
    return 1;
  }

  const configuredFrames = getStateSettings(animation.state).frames ?? animation.frames;
  const maxFrames = Math.max(1, manifest.atlas.columns);

  return Math.min(maxFrames, Math.max(1, Math.round(configuredFrames)));
}

function getFrameInterval(animation: PetRow | null) {
  if (!animation) {
    return animationSettings.frameIntervalMs;
  }

  const speed = getStateSettings(animation.state).speed ?? 1;
  const safeSpeed = Math.min(4, Math.max(0.25, speed));

  return Math.max(30, Math.round(animationSettings.frameIntervalMs / safeSpeed));
}

function getPlaybackDuration(animation: PetRow | null, fallbackLoops: number) {
  const loops = animation ? getStateSettings(animation.state).loops ?? fallbackLoops : fallbackLoops;
  const duration = getFrameCount(animation) * getFrameInterval(animation) * Math.max(1, loops);

  return Math.max(animationSettings.minActionMs, duration);
}

function applyAnimationSettings(nextSettings: AnimationSettings) {
  animationSettings = nextSettings;
  currentFrame = 0;
  startAnimation();

  if (!animationSettings.aiChatEnabled && !chatAreaElement.hidden) {
    void setChatOpen(false);
  }
}

function resizeCanvas() {
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.round(192 * petScale);
  const height = Math.round(208 * petScale);

  petElement.width = Math.round(width * pixelRatio);
  petElement.height = Math.round(height * pixelRatio);
  petElement.style.width = `${width}px`;
  petElement.style.height = `${height}px`;
  canvasContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  renderFrame();
}

function setState(state: PetState, restart = false) {
  const next = getAnimation(state);

  if (!next) {
    return;
  }

  if (next.state === currentState?.state && !restart) {
    return;
  }

  currentState = next;
  currentFrame = 0;
  renderFrame();
  startAnimation();
}

function getAvailableClickStates(includeIdle = true) {
  const availableStates = new Set(manifest?.animations.map((animation) => animation.state) ?? CLICK_ACTION_STATES);
  return CLICK_ACTION_STATES.filter((state) => availableStates.has(state) && (includeIdle || state !== "idle"));
}

function playAction(state: PetState, fallbackLoops: number) {
  const animation = getAnimation(state);

  if (!animation) {
    return false;
  }

  clearReturnTimer();
  setState(state, true);
  returnToIdleTimer = window.setTimeout(
    () => setState("idle"),
    getPlaybackDuration(animation, fallbackLoops)
  );

  return true;
}

function playPose() {
  const poses = getAvailableClickStates(false);
  const fallback = getAvailableClickStates(true)[0] ?? "idle";
  const next =
    animationSettings.clickAction === "random"
      ? poses[Math.floor(Math.random() * poses.length)] ?? fallback
      : animationSettings.clickAction;

  playAction(next, animationSettings.clickPoseLoops);
}

async function setChatOpen(open: boolean) {
  chatAreaElement.hidden = !open;

  if (!open) {
    bubbleListElement.replaceChildren();
    chatInputElement.value = "";
    chatSendElement.disabled = false;
    setState("idle");
  }

  await invoke("set_pet_chat_mode", { expanded: open, scale: petScale });
  resizeCanvas();

  if (open) {
    chatInputElement.focus();
  }
}

function addBubble(role: "user" | "assistant", content: string, className?: string) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role}${className ? ` ${className}` : ""}`;
  bubble.textContent = content;

  // Remove thinking placeholder if it exists
  const thinking = bubbleListElement.querySelector(".chat-bubble.thinking");
  if (thinking && role === "assistant" && !className) {
    thinking.remove();
  }

  bubbleListElement.append(bubble);
  bubbleListElement.scrollTop = bubbleListElement.scrollHeight;

  return bubble;
}

async function openChat() {
  if (!activePet) {
    return;
  }

  playPose();
  if (!animationSettings.aiChatEnabled) {
    return;
  }

  await setChatOpen(true);
}

const STATE_EXPLANATIONS: Record<string, string> = {
  waving: "用于打招呼、感谢、赞同、表达友好或开心。",
  jumping: "用于极度兴奋、雀跃、欢呼、高能或逗趣。",
  failed: "用于伤心、委屈、两眼汪汪擦眼泪哭泣、遇到挫折或道歉。",
  waiting: "用于好奇、期待、倾听、询问主人或求关注撒娇。",
  review: "用于认真解释、学术点头、严谨分析或讲道理。",
  idle: "用于平常、冷静、普通的陈述或闲聊。",
  "running-right": "用于向右走动、被拖动或从左往右移动。",
  "running-left": "用于向左走动、被拖动或从右往左移动。",
  running: "用于走动、忙碌、正在思考或处理数据。"
};

async function sendPetMessage() {
  if (!animationSettings.aiChatEnabled) {
    await setChatOpen(false);
    return;
  }

  if (!manifest) {
    addBubble("assistant", "请先在设置里导入一个本地宠物。");
    return;
  }

  const content = chatInputElement.value.trim();

  if (!content) {
    return;
  }

  const apiKey = localStorage.getItem(DEEPSEEK_KEY_STORAGE) || "";
  const baseUrl = localStorage.getItem(DEEPSEEK_BASE_URL_STORAGE) || "https://api.deepseek.com";
  const model = localStorage.getItem(DEEPSEEK_MODEL_STORAGE) || "deepseek-v4-flash";

  let systemPrompt =
    localStorage.getItem(PERSONA_STORAGE) ||
    `你是 ${manifest.displayName}，一个温暖、活泼的桌面宠物伙伴。用用户的语言回复，回答要短，像从宠物嘴里说出来的一句话。`;

  // 动态根据当前活跃宠物的实际动作列表构建 AI 动作提示词，实现完全的去硬编码与高可扩展性
  const availableStates = manifest.animations.map((a) => a.state).join(", ");

  let actionDescriptions = "";
  for (const anim of manifest.animations) {
    const desc = STATE_EXPLANATIONS[anim.state];
    if (desc) {
      actionDescriptions += `- [${anim.state}]：${desc}\n`;
    }
  }

  systemPrompt += `\n\n【重要！动作与表情指令】
请根据你当前回复的语境与情绪，在回复的最开头选择一个符合当前情绪的动作标签输出（必须用中括号括起来，例如 [waving]）。
你当前支持的动作标签仅限于：[${availableStates}]。
动作情绪参考建议：
${actionDescriptions}
格式要求：选择一个最贴切的动作标签放在回复的最前面，然后加一个空格，接着写你要对主人说的话。例如："[waving] 嗨！主人你好呀！" 或 "[failed] 唔，对不起主人..."。请确保中括号内拼写完全一致，且只输出一个标签，后面接正常回复。`;

  if (!apiKey) {
    addBubble("assistant", "先在设置里填写 DeepSeek API Key，我就能聊天了。");
    return;
  }

  chatInputElement.value = "";
  chatSendElement.disabled = true;
  addBubble("user", content);
  const thinkingBubble = addBubble("assistant", "我想一下...", "thinking");
  setState("running");

  const userMessage: PetChatMessage = { role: "user", content };
  chatHistory = [...chatHistory, userMessage].slice(-CHAT_HISTORY_LIMIT);
  persistChatHistory();

  try {
    const reply = await invoke<string>("deepseek_chat", {
      request: {
        apiKey,
        baseUrl,
        model,
        systemPrompt,
        messages: chatHistory
      }
    });

    let parsedAction: PetState = "review";
    let cleanReply = reply.trim();

    // 正则解析动作标签
    const actionMatch = cleanReply.match(/^\[([a-z-]+)\]\s*(.*)/is);
    if (actionMatch) {
      const tag = actionMatch[1].toLowerCase() as PetState;
      const isValidState = manifest.animations.some((a) => a.state === tag);
      if (isValidState) {
        parsedAction = tag;
        cleanReply = actionMatch[2].trim();
      }
    }

    // 保存清洗后的文本，避免历史语境受到动作标签污染
    const assistantMessage: PetChatMessage = { role: "assistant", content: cleanReply };
    chatHistory = [...chatHistory, assistantMessage].slice(-CHAT_HISTORY_LIMIT);
    persistChatHistory();

    thinkingBubble.remove();
    addBubble("assistant", cleanReply);

    // 播放 AI 选择的对应动作，并根据动作序列帧长度自适应计算播放周期
    playAction(parsedAction, animationSettings.responseActionLoops);
  } catch (error) {
    thinkingBubble.remove();
    addBubble("assistant", error instanceof Error ? error.message : String(error));
    setState("failed");
  } finally {
    chatSendElement.disabled = false;
  }
}

function renderFrame() {
  if (!manifest || !currentState || !spritesheet || !spritesheet.complete || spritesheet.naturalWidth === 0) {
    return;
  }

  currentFrame = currentFrame % getFrameCount(currentState);
  const x = currentFrame * manifest.atlas.cellWidth;
  const y = currentState.row * manifest.atlas.cellHeight;
  const width = petElement.width / (window.devicePixelRatio || 1);
  const height = petElement.height / (window.devicePixelRatio || 1);

  canvasContext.clearRect(0, 0, width, height);

  try {
    canvasContext.drawImage(
      spritesheet,
      x,
      y,
      manifest.atlas.cellWidth,
      manifest.atlas.cellHeight,
      0,
      0,
      width,
      height
    );
  } catch {
    clearAnimationTimer();
    addBubble("assistant", "这个宠物的 spritesheet 尺寸和 pet.json 不匹配。");
  }

  petElement.dataset.state = currentState.state;
}

function startAnimation() {
  clearAnimationTimer();
  if (currentState?.state === "idle" && !animationSettings.idlePlays) {
    currentFrame = 0;
    renderFrame();
    return;
  }
  animationTimer = window.setInterval(() => {
    const frames = getFrameCount(currentState);
    currentFrame = (currentFrame + 1) % frames;
    renderFrame();
  }, getFrameInterval(currentState));
}

function clearActivePet() {
  activePet = null;
  manifest = null;
  spritesheet = null;
  currentState = null;
  currentFrame = 0;
  spriteLoadToken += 1;
  clearAnimationTimer();
  clearReturnTimer();
  clearDragTimer();
  canvasContext.clearRect(0, 0, petElement.width, petElement.height);
  petElement.hidden = true;
  petElement.title = "请在设置里加载本地宠物";
  localStorage.removeItem(PET_STORAGE_KEY);
  void setChatOpen(false);
}

function loadPet(petDefinition: PetDefinition) {
  activePet = petDefinition;
  manifest = activePet.manifest;
  currentFrame = 0;
  currentState = getAnimation("idle");
  spritesheet = null;
  petElement.hidden = false;
  petElement.title = manifest.displayName;
  localStorage.setItem(PET_STORAGE_KEY, activePet.id);

  const token = ++spriteLoadToken;
  const nextImage = new Image();

  nextImage.addEventListener("load", () => {
    if (token !== spriteLoadToken) {
      return;
    }

    spritesheet = nextImage;
    resizeCanvas();
    renderFrame();
    startAnimation();
  });

  nextImage.addEventListener("error", () => {
    if (token !== spriteLoadToken) {
      return;
    }

    clearAnimationTimer();
    spritesheet = null;
    petElement.hidden = true;
    addBubble("assistant", "这个宠物图片加载失败，请在设置里删除后重新导入。");
  });

  nextImage.src = activePet.spritesheetUrl;
}

function switchPet(petId: string) {
  const nextPet = getPetById(petId);

  if (!nextPet) {
    clearActivePet();
    return;
  }

  if (activePet?.id === nextPet.id) {
    return;
  }

  void setChatOpen(false);
  loadPet(nextPet);
}

function beginDrag() {
  if (!pointerIsDown || isDragging || !activePet) {
    return;
  }

  isDragging = true;
  clearDragTimer();
  setState("running-right");
  void getCurrentWindow()
    .startDragging()
    .finally(() => {
      pointerIsDown = false;
      setState("idle");
      window.setTimeout(() => {
        isDragging = false;
      }, animationSettings.dragReleaseDelayMs);
    });
}

window.addEventListener("resize", resizeCanvas);

petElement.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !activePet) {
    return;
  }

  pointerIsDown = true;
  isDragging = false;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  petElement.setPointerCapture(event.pointerId);
  dragTimer = window.setTimeout(beginDrag, animationSettings.dragStartDelayMs);
});

petElement.addEventListener("pointermove", (event) => {
  if (!pointerIsDown || isDragging || (event.buttons & 1) !== 1) {
    return;
  }

  const distance = Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY);

  if (distance > 6) {
    beginDrag();
  }
});

petElement.addEventListener("pointerup", (event) => {
  clearDragTimer();
  pointerIsDown = false;
  petElement.releasePointerCapture(event.pointerId);

  if (isDragging) {
    setState("idle");
    window.setTimeout(() => {
      isDragging = false;
    }, animationSettings.dragReleaseDelayMs);
    return;
  }

  void openChat();
});

petElement.addEventListener("pointercancel", () => {
  clearDragTimer();
  pointerIsDown = false;
  isDragging = false;
  setState("idle");
});

window.addEventListener("storage", (event) => {
  if (event.key === PET_STORAGE_KEY) {
    switchPet(event.newValue || "");
  }

  if (event.key === ANIMATION_SETTINGS_STORAGE) {
    applyAnimationSettings(loadAnimationSettings());
  }
});

petChannel.addEventListener("message", (event: MessageEvent<{
  petId?: string;
  deletedPetId?: string;
  settingsUpdated?: boolean;
  animationSettingsUpdated?: boolean;
  animationSettings?: AnimationSettings;
  previewAction?: PetState;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  persona?: string;
}>) => {
  if (event.data.deletedPetId && event.data.deletedPetId === activePet?.id) {
    switchPet("");
    return;
  }

  if (event.data.petId !== undefined) {
    switchPet(event.data.petId);
  }

  if (event.data.previewAction) {
    playAction(event.data.previewAction, animationSettings.clickPoseLoops);
  }

  if (event.data.settingsUpdated) {
    // Explicitly write the updated settings to this webview's localStorage to bypass WebView2's out-of-sync localStorage
    if (event.data.apiKey !== undefined) {
      if (event.data.apiKey) {
        localStorage.setItem(DEEPSEEK_KEY_STORAGE, event.data.apiKey);
      } else {
        localStorage.removeItem(DEEPSEEK_KEY_STORAGE);
      }
    }
    if (event.data.baseUrl !== undefined) {
      localStorage.setItem(DEEPSEEK_BASE_URL_STORAGE, event.data.baseUrl);
    }
    if (event.data.model !== undefined) {
      localStorage.setItem(DEEPSEEK_MODEL_STORAGE, event.data.model);
    }
    if (event.data.persona !== undefined) {
      localStorage.setItem(PERSONA_STORAGE, event.data.persona);
    }

    // Clear chat history in memory and localStorage so the new settings/persona apply instantly
    chatHistory = [];
    localStorage.removeItem("aipet:chat-history");
    bubbleListElement.replaceChildren();
  }

  if (event.data.animationSettingsUpdated) {
    if (event.data.animationSettings) {
      localStorage.setItem(ANIMATION_SETTINGS_STORAGE, JSON.stringify(event.data.animationSettings));
    }

    applyAnimationSettings(loadAnimationSettings());
  }
});

window.addEventListener("beforeunload", () => {
  petChannel.close();
});

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !chatAreaElement.hidden) {
    void setChatOpen(false);
  }
});

closeChatElement.addEventListener("click", () => {
  void setChatOpen(false);
});

chatFormElement.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendPetMessage();
});

function updatePetScale(newScale: number) {
  petScale = Math.min(2.0, Math.max(0.5, newScale));
  localStorage.setItem(PET_SCALE_STORAGE, String(petScale));
  document.documentElement.style.setProperty("--pet-scale", String(petScale));

  void invoke("set_pet_chat_mode", {
    expanded: !chatAreaElement.hidden,
    scale: petScale
  }).then(() => {
    resizeCanvas();
  });
}

petElement.addEventListener("wheel", (event) => {
  event.preventDefault();
  const zoomFactor = event.deltaY < 0 ? 0.05 : -0.05;
  updatePetScale(petScale + zoomFactor);
}, { passive: false });

chatAreaElement.hidden = true;
updatePetScale(petScale);

const initialPet = getPetById(getStoredPetId());

if (initialPet) {
  loadPet(initialPet);
} else {
  clearActivePet();
}
