console.log("Focused Article Reader: Content script loaded.");

// Extract article content using Readability
function extractArticle() {
  const documentClone = document.cloneNode(true);
  const reader = new Readability(documentClone);
  const article = reader.parse();
  if (article && article.textContent) {
    console.log("Extracted article:", article.title);
    return {
      title: article.title,
      textContent: article.textContent,
      content: article.content
    };
  }
  console.error("No article content found.");
  return null;
}

// Inject UI toolbar
function injectToolbar() {
  const toolbar = document.createElement('div');
  toolbar.id = 'reader-toolbar';
  toolbar.innerHTML = `
    <button id="play-pause">Play</button>
    <input type="range" id="speed-slider" min="0.5" max="2" step="0.5" value="1">
    <span id="speed-display">1x</span>
    <button id="summarize">Summarize</button>
  `;
  document.body.appendChild(toolbar);

  // Update speed display
  const speedSlider = document.getElementById('speed-slider');
  const speedDisplay = document.getElementById('speed-display');
  speedSlider.addEventListener('input', () => {
    const speed = speedSlider.value;
    speedDisplay.textContent = `${speed}x`;
    // Store preference
    chrome.storage.sync.set({ speed: speed });
  });
}

// Run on page load
const articleData = extractArticle();
if (articleData) {
  console.log("Article text:", articleData.textContent);
  injectToolbar();
}