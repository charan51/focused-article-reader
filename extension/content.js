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

// Split text into sentences
function splitIntoSentences(text) {
  return text.match(/[^.!?]+[.!?]+/g) || [text];
}

// Inject UI toolbar and reader container
function injectUI() {
  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.id = 'reader-toolbar';
  toolbar.innerHTML = `
    <button id="play-pause">Play</button>
    <input type="range" id="speed-slider" min="0.5" max="2" step="0.5" value="1">
    <span id="speed-display">1x</span>
    <button id="summarize">Summarize</button>
  `;
  document.body.appendChild(toolbar);

  // Reader container for highlighting
  const readerContainer = document.createElement('div');
  readerContainer.id = 'reader-container';
  document.body.appendChild(readerContainer);

  return { toolbar, readerContainer };
}

// Handle TTS and highlighting
function setupTTSAndHighlighting(articleText) {
  const sentences = splitIntoSentences(articleText);
  const readerContainer = document.getElementById('reader-container');
  let currentSentenceIndex = 0;
  let isPlaying = false;
  const synth = window.speechSynthesis;

  // Populate reader container with sentences
  readerContainer.innerHTML = sentences
    .map((sentence, index) => `<span class="reader-sentence" data-index="${index}">${sentence}</span>`)
    .join(' ');

  const playPauseButton = document.getElementById('play-pause');
  const speedSlider = document.getElementById('speed-slider');
  const speedDisplay = document.getElementById('speed-display');

  // Load saved speed
  chrome.storage.sync.get(['speed'], (result) => {
    const speed = result.speed || 1;
    speedSlider.value = speed;
    speedDisplay.textContent = `${speed}x`;
  });

  // Update speed
  speedSlider.addEventListener('input', () => {
    const speed = speedSlider.value;
    speedDisplay.textContent = `${speed}x`;
    chrome.storage.sync.set({ speed: speed });
    if (isPlaying) {
      synth.cancel(); // Restart with new speed
      playNextSentence();
    }
  });

  // Play/pause toggle
  playPauseButton.addEventListener('click', () => {
    if (isPlaying) {
      synth.pause();
      playPauseButton.textContent = 'Resume';
      isPlaying = false;
    } else {
      if (synth.paused) {
        synth.resume();
        playPauseButton.textContent = 'Pause';
        isPlaying = true;
      } else {
        readerContainer.style.display = 'block';
        playNextSentence();
      }
    }
  });

  function playNextSentence() {
    if (currentSentenceIndex >= sentences.length) {
      resetTTS();
      return;
    }

    chrome.storage.sync.get(['speed'], (result) => {
      const speed = parseFloat(result.speed) || 1;
      const utterance = new SpeechSynthesisUtterance(sentences[currentSentenceIndex]);
      utterance.rate = speed;

      // Highlight current sentence
      const sentenceSpans = readerContainer.querySelectorAll('.reader-sentence');
      sentenceSpans.forEach(span => span.classList.remove('highlighted'));
      const currentSpan = readerContainer.querySelector(`.reader-sentence[data-index="${currentSentenceIndex}"]`);
      if (currentSpan) {
        currentSpan.classList.add('highlighted');
        currentSpan.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      // Move to next sentence when done
      utterance.onend = () => {
        currentSentenceIndex++;
        playNextSentence();
      };

      synth.speak(utterance);
      playPauseButton.textContent = 'Pause';
      isPlaying = true;
    });
  }

  function resetTTS() {
    synth.cancel();
    currentSentenceIndex = 0;
    playPauseButton.textContent = 'Play';
    isPlaying = false;
    readerContainer.style.display = 'none';
    const sentenceSpans = readerContainer.querySelectorAll('.reader-sentence');
    sentenceSpans.forEach(span => span.classList.remove('highlighted'));
  }
}

// Run on page load
const articleData = extractArticle();
if (articleData) {
  console.log("Article text:", articleData.textContent);
  const { toolbar, readerContainer } = injectUI();
  setupTTSAndHighlighting(articleData.textContent);
}