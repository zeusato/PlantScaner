/*
 * Front‑end logic for the Plant Scanner PWA.
 *
 * This script manages the user interface flow for capturing three
 * photographs (whole plant, close‑up of a healthy leaf and close‑up of
 * a problematic part), compressing them, sending them to the backend
 * for identification and disease detection, and optionally calling
 * Gemini for a more detailed analysis. It also handles storing the
 * user's Gemini API key in IndexedDB and exposes basic settings to
 * update or remove the key.
 */

(function () {
  // Grab DOM elements
  const scanButton = document.getElementById('scanButton');
  const instructionsDiv = document.getElementById('instructions');
  const fileInput = document.getElementById('fileInput');
  const resultsDiv = document.getElementById('results');
  const keyModal = document.getElementById('keyModal');
  const settingsModal = document.getElementById('settingsModal');
  const settingsButton = document.getElementById('settingsButton');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const saveKeyButton = document.getElementById('saveKeyButton');
  const changeKeyButton = document.getElementById('changeKeyButton');
  const deleteKeyButton = document.getElementById('deleteKeyButton');
  const closeSettingsButton = document.getElementById('closeSettingsButton');
  const keyStatus = document.getElementById('keyStatus');

  // In‑memory state for the current scanning session
  let capturedImages = [];
  let currentStep = 0;

  /**
   * Compress an image file by drawing it onto a canvas and exporting
   * it as a JPEG data URI. Reduces large camera images to a maximum
   * dimension of 1280px with a quality of 0.7. Returns a promise
   * resolving to the data URI.
   */
  function compressImage(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
          let width = img.width;
          let height = img.height;
          const MAX_DIMENSION = 1280;
          if (width > height) {
            if (width > MAX_DIMENSION) {
              height = Math.round((height * MAX_DIMENSION) / width);
              width = MAX_DIMENSION;
            }
          } else {
            if (height > MAX_DIMENSION) {
              width = Math.round((width * MAX_DIMENSION) / height);
              height = MAX_DIMENSION;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          resolve(dataUrl);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /**
   * Start a new scanning flow. Clears previous images and prompts
   * the user to capture three pictures in order.
   */
  function startScan() {
    capturedImages = [];
    currentStep = 0;
    resultsDiv.classList.add('hidden');
    instructionsDiv.innerHTML = '<p>Ảnh 1: Chụp toàn bộ cây.</p>';
    // Trigger the file input; we wait a tick to allow UI updates
    setTimeout(() => fileInput.click(), 100);
  }

  /**
   * Advance to the next capture step or perform the identification once
   * all three images have been gathered.
   */
  function handleNextCapture(dataUri) {
    capturedImages.push(dataUri);
    currentStep++;
    if (currentStep === 1) {
      instructionsDiv.innerHTML = '<p>Ảnh 2: Chụp cận cảnh lá khỏe mạnh.</p>';
      fileInput.value = '';
      setTimeout(() => fileInput.click(), 100);
    } else if (currentStep === 2) {
      instructionsDiv.innerHTML = '<p>Ảnh 3: Chụp cận cảnh vùng bị bệnh hoặc lá khác.</p>';
      fileInput.value = '';
      setTimeout(() => fileInput.click(), 100);
    } else {
      // Collected 3 images, begin processing
      instructionsDiv.innerHTML = '<p>Đang phân tích hình ảnh...</p>';
      scanButton.disabled = true;
      performIdentification().finally(() => {
        scanButton.disabled = false;
      });
    }
  }

  /**
   * Send images to the backend for identification and optionally call
   * Gemini for additional analysis. Displays the final result in
   * the resultsDiv.
   */
  async function performIdentification() {
    try {
      // Build request payload for the backend
      const organs = ['auto', 'auto', 'auto'];
      const payload = {
        images: capturedImages,
        organs: organs,
        detectDisease: true,
        lang: 'vi'
      };
      const response = await fetch('/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      let result = buildResultFromPlantnet(data);
      const needGemini = shouldUseGemini(data);
      if (needGemini) {
        const gemKey = await getKey();
        if (gemKey) {
          const gemResult = await callGemini(gemKey, capturedImages);
          if (gemResult) {
            result = gemResult;
          }
        }
      }
      displayResult(result);
    } catch (err) {
      resultsDiv.classList.remove('hidden');
      resultsDiv.innerHTML = '<p class="error">Đã xảy ra lỗi: ' + err.message + '</p>';
    }
  }

  /**
   * Determine whether a Gemini call should be attempted. Returns true
   * if the identification results appear insufficient (e.g. no
   * results or very low confidence).
   */
  function shouldUseGemini(data) {
    if (!data || !data.identify || !Array.isArray(data.identify.results) || data.identify.results.length === 0) {
      return true;
    }
    const top = data.identify.results[0];
    if (typeof top.score === 'number' && top.score < 0.35) {
      return true;
    }
    return false;
  }

  /**
   * Build a simplified result object from Pl@ntNet identification and
   * disease responses. Only the most useful fields are extracted.
   */
  function buildResultFromPlantnet(data) {
    const output = {};
    if (data && data.identify && Array.isArray(data.identify.results) && data.identify.results.length > 0) {
      const top = data.identify.results[0];
      output.best_match = {
        scientific_name: top.species && top.species.scientificNameWithoutAuthor ? top.species.scientificNameWithoutAuthor : (data.identify.bestMatch || ''),
        common_name: (top.species && Array.isArray(top.species.commonNames) && top.species.commonNames.length > 0) ? top.species.commonNames[0] : '',
        confidence: top.score
      };
      output.alternatives = data.identify.results.slice(1, 5).map((r) => {
        return {
          scientific_name: r.species && r.species.scientificNameWithoutAuthor ? r.species.scientificNameWithoutAuthor : '',
          confidence: r.score
        };
      });
    }
    if (data && data.diseases && Array.isArray(data.diseases.results) && data.diseases.results.length > 0) {
      output.health_assessment = {
        issues: data.diseases.results.map((r) => {
          return {
            name: r.label || r.name || '',
            likelihood: r.score
          };
        })
      };
    }
    return output;
  }

  /**
   * Call the Gemini API with the user's key to perform multimodal
   * analysis. Images should be data URIs. Returns a parsed object or
   * null on failure. The prompt instructs Gemini to output a JSON
   * document containing detailed plant information.
   */
  async function callGemini(apiKey, images) {
    // Compose a multi‑line prompt using \n sequences
    const prompt =
      'You are a botanist assistant. Identify the plant species shown in the provided images and produce a JSON object with these keys:\n' +
      'best_match (containing scientific_name, common_name, family, genus, confidence);\n' +
      'alternatives (list of up to 5 species with scientific_name and confidence);\n' +
      'habitat_and_habit (preferred_light, water_need, soil, temperature);\n' +
      'care_guide (watering, light, soil, fertilizing, pruning, common_mistakes);\n' +
      'fun_facts (array of interesting facts);\n' +
      'health_assessment (status, possible_issues array with name, likelihood, signs_in_image, checks_to_confirm, safe_actions).\n' +
      'If you cannot identify the plant confidently, include an "unknown" best_match and provide suggestions for what additional photos are needed.\n' +
      'Return only valid JSON and no additional text.';
    // Prepare image parts
    const parts = [ { text: prompt } ];
    images.forEach((uri) => {
      const commaIndex = uri.indexOf(',');
      const mime = uri.substring(5, uri.indexOf(';'));
      const base64 = uri.substring(commaIndex + 1);
      parts.push({ inlineData: { mimeType: mime, data: base64 } });
    });
    const requestBody = {
      contents: [ { parts: parts } ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024
      }
    };
    try {
      const response = await fetch(
        `https://generativeai.googleapis.com/v1beta/models/gemini-1.0-pro-vision:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        }
      );
      const json = await response.json();
      // Extract text from the first candidate
      let text;
      if (json && Array.isArray(json.candidates) && json.candidates.length > 0) {
        const candidate = json.candidates[0];
        if (candidate && candidate.content && Array.isArray(candidate.content.parts) && candidate.content.parts.length > 0) {
          const part = candidate.content.parts[0];
          if (part && part.text) {
            text = part.text.trim();
          }
        }
      }
      if (text) {
        try {
          return JSON.parse(text);
        } catch (e) {
          console.warn('Gemini returned unparseable JSON', e);
        }
      }
    } catch (err) {
      console.error('Gemini API error', err);
    }
    return null;
  }

  /**
   * Display the result object in the resultsDiv as formatted JSON.
   */
  function displayResult(result) {
    resultsDiv.classList.remove('hidden');
    resultsDiv.innerHTML = '';
    if (!result || Object.keys(result).length === 0) {
      resultsDiv.innerHTML = '<p>Không thể xác định loài cây. Hãy thử lại với ảnh khác.</p>';
      return;
    }
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(result, null, 2);
    resultsDiv.appendChild(pre);
  }

  /**
   * Open a connection to IndexedDB and return the database instance.
   */
  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('plantScannerDB', 1);
      request.onupgradeneeded = function (event) {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
      };
      request.onsuccess = function (event) {
        resolve(event.target.result);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  /**
   * Retrieve the stored Gemini API key from IndexedDB.
   */
  async function getKey() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const req = store.get('geminiKey');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Store the Gemini API key in IndexedDB.
   */
  async function saveKey(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const req = store.put(key, 'geminiKey');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Remove the stored Gemini API key from IndexedDB.
   */
  async function deleteKey() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const req = store.delete('geminiKey');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Show a modal element by adding the `show` class.
   */
  function showModal(modal) {
    modal.classList.add('show');
  }

  /**
   * Hide a modal element by removing the `show` class.
   */
  function hideModal(modal) {
    modal.classList.remove('show');
  }

  /**
   * Update the key status text in the settings modal.
   */
  async function updateKeyStatus() {
    const key = await getKey();
    if (key) {
      keyStatus.textContent = 'Đã lưu khóa Gemini.';
    } else {
      keyStatus.textContent = 'Chưa có khóa Gemini.';
    }
  }

  // Event listeners
  window.addEventListener('DOMContentLoaded', async () => {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js').catch((err) => console.error('Service worker registration failed', err));
    }
    // Prompt for key if not stored
    const storedKey = await getKey();
    if (!storedKey) {
      showModal(keyModal);
    }
    updateKeyStatus();
  });

  scanButton.addEventListener('click', () => {
    startScan();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const dataUri = await compressImage(file);
    handleNextCapture(dataUri);
  });

  saveKeyButton.addEventListener('click', async () => {
    const keyVal = apiKeyInput.value.trim();
    if (keyVal) {
      await saveKey(keyVal);
      apiKeyInput.value = '';
      hideModal(keyModal);
      updateKeyStatus();
    }
  });

  settingsButton.addEventListener('click', () => {
    updateKeyStatus();
    showModal(settingsModal);
  });
  closeSettingsButton.addEventListener('click', () => {
    hideModal(settingsModal);
  });
  changeKeyButton.addEventListener('click', () => {
    hideModal(settingsModal);
    showModal(keyModal);
  });
  deleteKeyButton.addEventListener('click', async () => {
    await deleteKey();
    hideModal(settingsModal);
    showModal(keyModal);
  });
})();