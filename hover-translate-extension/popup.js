const STORAGE_KEY = "targetLanguage";
const DEFAULT_LANGUAGE = "es";
const ENABLED_KEY = "translationEnabled";
const DEFAULT_ENABLED = true;

const languageSelect = document.getElementById("language");
const toggleButton = document.getElementById("toggleTranslation");
const statusText = document.getElementById("statusText");

function renderEnabledState(enabled) {
  statusText.textContent = enabled ? "Status: Running" : "Status: Paused";
  toggleButton.textContent = enabled ? "Pause" : "Run";
}

chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULT_LANGUAGE, [ENABLED_KEY]: DEFAULT_ENABLED }, (result) => {
  languageSelect.value = result[STORAGE_KEY] || DEFAULT_LANGUAGE;
  renderEnabledState(result[ENABLED_KEY] ?? DEFAULT_ENABLED);
});

languageSelect.addEventListener("change", () => {
  chrome.storage.sync.set({ [STORAGE_KEY]: languageSelect.value });
});

toggleButton.addEventListener("click", () => {
  chrome.storage.sync.get({ [ENABLED_KEY]: DEFAULT_ENABLED }, (result) => {
    const nextEnabled = !(result[ENABLED_KEY] ?? DEFAULT_ENABLED);
    chrome.storage.sync.set({ [ENABLED_KEY]: nextEnabled }, () => {
      renderEnabledState(nextEnabled);
    });
  });
});
