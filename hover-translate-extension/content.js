const STORAGE_KEY = "targetLanguage";
const DEFAULT_LANGUAGE = "es";
const PERSISTED_CACHE_KEY = "translationCacheV1";
const MIN_TEXT_LENGTH = 8;
const HOVER_DELAY_MS = 180;
const REQUEST_DEBOUNCE_MS = 100;
const LOADING_TOOLTIP_DELAY_MS = 140;
const MAX_PERSISTED_CACHE_ENTRIES = 250;
const TOOLTIP_OFFSET_X = 14;
const TOOLTIP_OFFSET_Y = 18;

const translationCache = new Map();
const inFlightTranslations = new Map();
let targetLanguage = DEFAULT_LANGUAGE;
let hoverTimer = null;
let requestTimer = null;
let loadingTimer = null;
let lastSentence = "";
let mouseX = 0;
let mouseY = 0;

const tooltip = document.createElement("div");
tooltip.className = "hover-translate-tooltip";
document.documentElement.appendChild(tooltip);

chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULT_LANGUAGE }, (result) => {
  targetLanguage = result[STORAGE_KEY] || DEFAULT_LANGUAGE;
});

chrome.storage.local.get({ [PERSISTED_CACHE_KEY]: {} }, (result) => {
  const persisted = result[PERSISTED_CACHE_KEY];
  if (!persisted || typeof persisted !== "object") {
    return;
  }

  for (const [cacheKey, value] of Object.entries(persisted)) {
    if (!value || typeof value.text !== "string") {
      continue;
    }
    translationCache.set(cacheKey, value.text);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes[STORAGE_KEY]) {
    return;
  }
  targetLanguage = changes[STORAGE_KEY].newValue || DEFAULT_LANGUAGE;
  hideTooltip();
});

function hideTooltip() {
  if (loadingTimer) {
    clearTimeout(loadingTimer);
    loadingTimer = null;
  }
  tooltip.classList.remove("show");
  tooltip.textContent = "";
}

function positionTooltip(x, y) {
  const margin = 10;
  const tooltipRect = tooltip.getBoundingClientRect();
  const maxX = window.innerWidth - tooltipRect.width - margin;
  const maxY = window.innerHeight - tooltipRect.height - margin;
  const clampedX = Math.min(Math.max(margin, x + TOOLTIP_OFFSET_X), Math.max(margin, maxX));
  const clampedY = Math.min(Math.max(margin, y + TOOLTIP_OFFSET_Y), Math.max(margin, maxY));

  tooltip.style.left = `${clampedX}px`;
  tooltip.style.top = `${clampedY}px`;
}

function isIgnoredElement(element) {
  if (!element) {
    return true;
  }
  const tag = element.tagName;
  if (!tag) {
    return false;
  }
  return /^(INPUT|TEXTAREA|SELECT|BUTTON|CODE|PRE|NOSCRIPT|SCRIPT|STYLE)$/i.test(tag);
}

function getCaretContextFromPoint(x, y) {
  if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    if (!range) {
      return null;
    }
    return { node: range.startContainer, offset: range.startOffset };
  }

  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (!pos) {
      return null;
    }
    return { node: pos.offsetNode, offset: pos.offset };
  }

  return null;
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function extractSentenceFromText(fullText, index) {
  if (!fullText) {
    return "";
  }

  const separators = /[.!?。！？\n]/;
  let start = Math.max(0, Math.min(index, fullText.length - 1));
  let end = start;

  while (start > 0 && !separators.test(fullText[start - 1])) {
    start -= 1;
  }
  while (end < fullText.length && !separators.test(fullText[end])) {
    end += 1;
  }

  return normalizeText(fullText.slice(start, end));
}

function getHoveredSentence(x, y) {
  const hoveredElement = document.elementFromPoint(x, y);
  if (!hoveredElement || isIgnoredElement(hoveredElement) || tooltip.contains(hoveredElement)) {
    return "";
  }

  const caret = getCaretContextFromPoint(x, y);
  if (!caret || !caret.node || caret.node.nodeType !== Node.TEXT_NODE) {
    return "";
  }

  const textNode = caret.node;
  const text = textNode.nodeValue || "";
  if (!text.trim()) {
    return "";
  }

  const sentence = extractSentenceFromText(text, caret.offset);
  if (sentence.length < MIN_TEXT_LENGTH) {
    return "";
  }

  return sentence;
}

async function translate(text, language) {
  const cacheKey = `${language}::${text}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  if (inFlightTranslations.has(cacheKey)) {
    return inFlightTranslations.get(cacheKey);
  }

  const url =
    "https://translate.googleapis.com/translate_a/single" +
    `?client=gtx&sl=auto&tl=${encodeURIComponent(language)}&dt=t&q=${encodeURIComponent(text)}`;

  const translationPromise = (async () => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Translate request failed with ${response.status}`);
    }

    const data = await response.json();
    const translated = Array.isArray(data?.[0])
      ? data[0]
          .map((chunk) => (Array.isArray(chunk) ? chunk[0] : ""))
          .join("")
          .trim()
      : "";

    if (!translated) {
      throw new Error("No translation returned");
    }

    translationCache.set(cacheKey, translated);
    persistTranslationCache(cacheKey, translated);
    return translated;
  })();

  inFlightTranslations.set(cacheKey, translationPromise);
  try {
    return await translationPromise;
  } finally {
    inFlightTranslations.delete(cacheKey);
  }
}

function persistTranslationCache(cacheKey, text) {
  chrome.storage.local.get({ [PERSISTED_CACHE_KEY]: {} }, (result) => {
    const persisted = result[PERSISTED_CACHE_KEY];
    const next = persisted && typeof persisted === "object" ? { ...persisted } : {};
    next[cacheKey] = { text, t: Date.now() };

    const entries = Object.entries(next);
    if (entries.length > MAX_PERSISTED_CACHE_ENTRIES) {
      entries.sort((a, b) => (a[1]?.t || 0) - (b[1]?.t || 0));
      const excess = entries.length - MAX_PERSISTED_CACHE_ENTRIES;
      for (let i = 0; i < excess; i += 1) {
        delete next[entries[i][0]];
      }
    }

    chrome.storage.local.set({ [PERSISTED_CACHE_KEY]: next });
  });
}

function getCachedTranslation(text, language) {
  const cacheKey = `${language}::${text}`;
  return translationCache.get(cacheKey) || "";
}

function showLoadingTooltip(x, y) {
  if (loadingTimer) {
    clearTimeout(loadingTimer);
  }
  loadingTimer = setTimeout(() => {
    showTooltip("Translating...", x, y);
  }, LOADING_TOOLTIP_DELAY_MS);
}

function showTooltip(text, x, y) {
  tooltip.textContent = text;
  positionTooltip(x, y);
  tooltip.classList.add("show");
}

function queueTranslation(sentence) {
  if (requestTimer) {
    clearTimeout(requestTimer);
  }

  requestTimer = setTimeout(async () => {
    try {
      const translated = await translate(sentence, targetLanguage);
      if (lastSentence === sentence) {
        showTooltip(translated, mouseX, mouseY);
      }
    } catch (_) {
      hideTooltip();
    }
  }, REQUEST_DEBOUNCE_MS);
}

document.addEventListener(
  "mousemove",
  (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;

    if (hoverTimer) {
      clearTimeout(hoverTimer);
    }

    hoverTimer = setTimeout(() => {
      const sentence = getHoveredSentence(mouseX, mouseY);

      if (!sentence) {
        lastSentence = "";
        hideTooltip();
        return;
      }

      if (sentence === lastSentence && tooltip.textContent) {
        positionTooltip(mouseX, mouseY);
        return;
      }

      lastSentence = sentence;
      const cachedTranslation = getCachedTranslation(sentence, targetLanguage);
      if (cachedTranslation) {
        showTooltip(cachedTranslation, mouseX, mouseY);
        return;
      }

      showLoadingTooltip(mouseX, mouseY);
      queueTranslation(sentence);
    }, HOVER_DELAY_MS);
  },
  { passive: true }
);

document.addEventListener("scroll", hideTooltip, { passive: true });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideTooltip();
  }
});
