console.log("Focused Article Reader: Content script loaded.");

// Utility to wrap chrome.storage.sync.get/set in Promises
function getStorage(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get([key], (result) => {
      if (chrome.runtime.lastError) {
        console.error("getStorage error:", chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
      } else {
        resolve(result[key]);
      }
    });
  });
}

function setStorage(data) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(data, () => {
      if (chrome.runtime.lastError) {
        console.error("setStorage error:", chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

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
  const toolbar = document.createElement('div');
  toolbar.id = 'reader-toolbar';
  toolbar.innerHTML = `
    <div class="flex gap-2">
      <button id="play-pause">Play</button>
      <button id="stop">Stop</button>
    </div>
    <div class="flex gap-2 items-center">
      <input type="range" id="speed-slider" min="0.5" max="2" step="0.5" value="1">
      <span id="speed-display">1x</span>
    </div>
    <select id="voice-select" class="p-2 border rounded"></select>
  `;
  document.body.appendChild(toolbar);

  const readerContainer = document.createElement('div');
  readerContainer.id = 'reader-container';
  document.body.appendChild(readerContainer);

  return { toolbar, readerContainer };
}

// Handle TTS, highlighting, mouse selection, hover, voice selection, and stop/pause
async function setupTTSAndHighlighting(articleData) {
  const articleText = articleData.textContent;
  const sentences = splitIntoSentences(articleText);
  const readerContainer = document.getElementById('reader-container');
  let currentSentenceIndex = 0;
  let playbackMode = "idle"; // "idle", "article", "selection", "hover"
  let isPaused = false;
  let isScriptActive = true;
  const synth = window.speechSynthesis;

  // Detect script termination
  window.addEventListener('unload', () => {
    isScriptActive = false;
    synth.cancel();
  });

  // Populate reader container with sentences
  readerContainer.innerHTML = sentences
    .map((sentence, index) => `<span class="reader-sentence" data-index="${index}">${sentence}</span>`)
    .join(' ');

  const playPauseButton = document.getElementById('play-pause');
  const stopButton = document.getElementById('stop');
  const speedSlider = document.getElementById('speed-slider');
  const speedDisplay = document.getElementById('speed-display');
  const voiceSelect = document.getElementById('voice-select');

  // Populate voice selection dropdown
  function populateVoices() {
    const voices = synth.getVoices();
    voiceSelect.innerHTML = voices
      .map((voice, index) => `<option value="${index}">${voice.name} (${voice.lang})</option>`)
      .join('');
  }
  populateVoices();
  synth.onvoiceschanged = populateVoices;

  // Load saved speed and voice
  try {
    const speed = (await getStorage('speed')) || 1;
    const savedVoiceIndex = (await getStorage('voiceIndex')) || 0;
    speedSlider.value = speed;
    speedDisplay.textContent = `${speed}x`;
    voiceSelect.value = savedVoiceIndex;
  } catch (error) {
    console.error("Error loading settings:", error);
  }

  // Update speed
  speedSlider.addEventListener('input', async () => {
    if (!isScriptActive) return;
    const speed = speedSlider.value;
    speedDisplay.textContent = `${speed}x`;
    try {
      await setStorage({ speed: speed });
      if (playbackMode !== "idle") {
        synth.cancel();
        if (playbackMode === "article") playNextSentence();
        else if (playbackMode === "selection") readSelection();
        else if (playbackMode === "hover") readHoveredParagraph();
      }
    } catch (error) {
      console.error("Error saving speed:", error);
    }
  });

  // Update voice
  voiceSelect.addEventListener('change', async () => {
    if (!isScriptActive) return;
    const voiceIndex = voiceSelect.value;
    try {
      await setStorage({ voiceIndex: voiceIndex });
      if (playbackMode !== "idle") {
        synth.cancel();
        if (playbackMode === "article") playNextSentence();
        else if (playbackMode === "selection") readSelection();
        else if (playbackMode === "hover") readHoveredParagraph();
      }
    } catch (error) {
      console.error("Error saving voice:", error);
    }
  });

  // Play/pause toggle for article
  playPauseButton.addEventListener('click', () => {
    if (!isScriptActive) return;
    console.log("Play/Pause clicked. Current mode:", playbackMode, "Paused:", isPaused);

    if (playbackMode === "article" && !isPaused) {
      synth.pause();
      isPaused = true;
      playPauseButton.textContent = 'Resume';
      console.log("Paused article playback");
    } else if (playbackMode === "article" && isPaused) {
      synth.resume();
      isPaused = false;
      playPauseButton.textContent = 'Pause';
      console.log("Resumed article playback");
    } else {
      synth.cancel();
      playbackMode = "article";
      isPaused = false;
      clearHoverHighlight();
      clearSelectionHighlight();
      readerContainer.style.display = 'block';
      playNextSentence();
    }
  });

  // Stop button
  stopButton.addEventListener('click', () => {
    if (!isScriptActive) return;
    console.log("Stop clicked. Current mode:", playbackMode);
    resetTTS();
  });

  async function playNextSentence() {
    if (!isScriptActive || playbackMode !== "article" || currentSentenceIndex >= sentences.length) {
      resetTTS();
      return;
    }

    try {
      const speed = parseFloat(await getStorage('speed')) || 1;
      const voiceIndex = parseInt(await getStorage('voiceIndex')) || 0;
      const voices = synth.getVoices();
      const utterance = new SpeechSynthesisUtterance(sentences[currentSentenceIndex]);
      utterance.rate = speed;
      if (voices[voiceIndex]) utterance.voice = voices[voiceIndex];

      const sentenceSpans = readerContainer.querySelectorAll('.reader-sentence');
      sentenceSpans.forEach(span => span.classList.remove('highlighted'));
      const currentSpan = readerContainer.querySelector(`.reader-sentence[data-index="${currentSentenceIndex}"]`);
      if (currentSpan) {
        currentSpan.classList.add('highlighted');
        currentSpan.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      utterance.onend = () => {
        if (!isScriptActive || playbackMode !== "article") return;
        currentSentenceIndex++;
        playNextSentence();
      };

      synth.speak(utterance);
      playPauseButton.textContent = 'Pause';
      console.log("Playing sentence:", currentSentenceIndex);
    } catch (error) {
      console.error("Error in playNextSentence:", error);
    }
  }

  function resetTTS() {
    synth.cancel();
    currentSentenceIndex = 0;
    playbackMode = "idle";
    isPaused = false;
    playPauseButton.textContent = 'Play';
    readerContainer.style.display = 'none';
    const sentenceSpans = readerContainer.querySelectorAll('.reader-sentence');
    sentenceSpans.forEach(span => span.classList.remove('highlighted'));
    clearSelectionHighlight();
    clearHoverHighlight();
    console.log("TTS reset. Mode:", playbackMode);
  }

  // Mouse selection reading
  let selectionRange = null;
  document.addEventListener('mouseup', () => {
    if (!isScriptActive) return;
    const selection = window.getSelection();
    if (selection.toString().trim() !== '') {
      synth.cancel();
      playbackMode = "selection";
      isPaused = false;
      clearHoverHighlight();
      playPauseButton.textContent = 'Play';
      readerContainer.style.display = 'none';
      const sentenceSpans = readerContainer.querySelectorAll('.reader-sentence');
      sentenceSpans.forEach(span => span.classList.remove('highlighted'));

      selectionRange = selection.getRangeAt(0);
      readSelection();
    }
  });

  async function readSelection() {
    if (!isScriptActive || !selectionRange || playbackMode !== "selection") return;

    const selectedText = selectionRange.toString().trim();
    if (!selectedText) return;

    try {
      const speed = parseFloat(await getStorage('speed')) || 1;
      const voiceIndex = parseInt(await getStorage('voiceIndex')) || 0;
      const voices = synth.getVoices();
      const utterance = new SpeechSynthesisUtterance(selectedText);
      utterance.rate = speed;
      if (voices[voiceIndex]) utterance.voice = voices[voiceIndex];

      clearSelectionHighlight();
      const fragment = document.createDocumentFragment();
      const span = document.createElement('span');
      span.className = 'selection-highlight';

      const contents = selectionRange.cloneContents();
      const textNodes = [];
      function extractTextNodes(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          textNodes.push(node);
        } else {
          node.childNodes.forEach(extractTextNodes);
        }
      }
      extractTextNodes(contents);

      if (textNodes.length > 0) {
        selectionRange.deleteContents();
        textNodes.forEach(textNode => {
          const newSpan = span.cloneNode(true);
          newSpan.textContent = textNode.textContent;
          fragment.appendChild(newSpan);
        });
        selectionRange.insertNode(fragment);
      } else {
        console.warn("Selection contains no text nodes to highlight.");
      }

      utterance.onend = () => {
        if (!isScriptActive) return;
        playbackMode = "idle";
        clearSelectionHighlight();
        window.getSelection().removeAllRanges();
        selectionRange = null;
        console.log("Selection playback ended. Mode:", playbackMode);
      };

      synth.speak(utterance);
      console.log("Playing selection");
    } catch (error) {
      console.error("Error in readSelection:", error);
    }
  }

  function clearSelectionHighlight() {
    const highlighted = document.querySelectorAll('.selection-highlight');
    highlighted.forEach(span => {
      const parent = span.parentNode;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
    });
  }

  // Hover highlight and read
  let currentHoveredParagraph = null;
  function setupHoverReading() {
    const parser = new DOMParser();
    const articleDoc = parser.parseFromString(articleData.content, 'text/html');
    const paragraphs = articleDoc.querySelectorAll('p');
    const articleContainer = document.createElement('div');
    articleContainer.id = 'reader-article';
    document.body.appendChild(articleContainer);

    paragraphs.forEach((p, index) => {
      const paragraph = document.createElement('p');
      paragraph.className = 'reader-paragraph';
      paragraph.dataset.index = index;
      paragraph.textContent = p.textContent;
      articleContainer.appendChild(paragraph);

      paragraph.addEventListener('mouseover', () => {
        if (!isScriptActive || currentHoveredParagraph === paragraph) return;
        synth.cancel();
        playbackMode = "hover";
        isPaused = false;
        clearSelectionHighlight();
        clearHoverHighlight();
        playPauseButton.textContent = 'Play';
        readerContainer.style.display = 'none';
        const sentenceSpans = readerContainer.querySelectorAll('.reader-sentence');
        sentenceSpans.forEach(span => span.classList.remove('highlighted'));

        currentHoveredParagraph = paragraph;
        paragraph.classList.add('hover-highlight');
        readHoveredParagraph();
      });

      paragraph.addEventListener('mouseout', () => {
        if (!isScriptActive || currentHoveredParagraph !== paragraph) return;
        synth.cancel();
        playbackMode = "idle";
        clearHoverHighlight();
        currentHoveredParagraph = null;
        console.log("Hover playback ended. Mode:", playbackMode);
      });
    });
  }

  async function readHoveredParagraph() {
    if (!isScriptActive || !currentHoveredParagraph || playbackMode !== "hover") return;

    const text = currentHoveredParagraph.textContent.trim();
    if (!text) return;

    try {
      const speed = parseFloat(await getStorage('speed')) || 1;
      const voiceIndex = parseInt(await getStorage('voiceIndex')) || 0;
      const voices = synth.getVoices();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = speed;
      if (voices[voiceIndex]) utterance.voice = voices[voiceIndex];

      utterance.onend = () => {
        if (!isScriptActive) return;
        playbackMode = "idle";
        if (currentHoveredParagraph) {
          currentHoveredParagraph.classList.remove('hover-highlight');
          currentHoveredParagraph = null;
        }
        console.log("Hover playback ended (onend). Mode:", playbackMode);
      };

      synth.speak(utterance);
      console.log("Playing hover paragraph");
    } catch (error) {
      console.error("Error in readHoveredParagraph:", error);
    }
  }

  function clearHoverHighlight() {
    const highlighted = document.querySelectorAll('.hover-highlight');
    highlighted.forEach(p => p.classList.remove('hover-highlight'));
  }

  // Initialize all features
  setupHoverReading();
}

// Run on page load
const articleData = extractArticle();
if (articleData) {
  console.log("Article text:", articleData.textContent);
  const { toolbar, readerContainer } = injectUI();
  setupTTSAndHighlighting(articleData);
}