export {};
const port = chrome.runtime.connect( {name: 'devtools'});

chrome.devtools.panels.create(
  "WebXR",
  "/icons/icon128.png",
  "/src/app/panel.html"
);