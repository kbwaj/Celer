const STORAGE_KEY = "targetLanguage";
const DEFAULT_LANGUAGE = "es";

const languageSelect = document.getElementById("language");

chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULT_LANGUAGE }, (result) => {
  languageSelect.value = result[STORAGE_KEY] || DEFAULT_LANGUAGE;
});

languageSelect.addEventListener("change", () => {
  chrome.storage.sync.set({ [STORAGE_KEY]: languageSelect.value });
});
