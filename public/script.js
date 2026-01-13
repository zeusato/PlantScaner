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
  let isCapturing = false; // Flag to prevent double triggers

  // Step labels for the capture flow
  const stepLabels = [
    'Ảnh 1: Chụp toàn bộ cây.',
    'Ảnh 2: Chụp cận cảnh lá khỏe mạnh.',
    'Ảnh 3: Chụp cận cảnh vùng bị bệnh hoặc lá khác.'
  ];

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
    isCapturing = true;
    resultsDiv.classList.add('hidden');
    instructionsDiv.innerHTML = `<p>${stepLabels[currentStep]}</p>`;
    // Trigger the file input; we wait a tick to allow UI updates
    fileInput.value = ''; // Reset input
    setTimeout(() => fileInput.click(), 100);
  }

  /**
   * Advance to the next capture step or perform the identification once
   * all three images have been gathered.
   */
  function handleNextCapture(dataUri) {
    if (!isCapturing) return; // Ignore if not in capture mode

    capturedImages.push(dataUri);
    currentStep++;

    console.log(`Captured image ${currentStep}/3`); // Debug log

    if (currentStep < 3) {
      // More images needed
      instructionsDiv.innerHTML = `<p>${stepLabels[currentStep]}</p>`;
      fileInput.value = ''; // Reset input for next capture
      setTimeout(() => {
        fileInput.click();
      }, 300); // Slightly longer delay for reliability
    } else {
      // Collected 3 images, begin processing
      isCapturing = false;
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
   * Call the Gemini API using Google Generative AI SDK with gemini-3-flash-preview model.
   */
  async function callGemini(apiKey, images) {
    try {
      // Prepare image parts for the API
      const imageParts = images.map((uri) => {
        const commaIndex = uri.indexOf(',');
        const mime = uri.substring(5, uri.indexOf(';'));
        const base64 = uri.substring(commaIndex + 1);
        return {
          inlineData: {
            mimeType: mime,
            data: base64
          }
        };
      });

      // Compose prompt
      const prompt = `Bạn là một chuyên gia thực vật học. Hãy phân tích các hình ảnh cây trồng được cung cấp và trả về một JSON object với các thông tin sau:

{
  "best_match": {
    "scientific_name": "Tên khoa học",
    "common_name": "Tên thông dụng (tiếng Việt)",
    "family": "Họ thực vật",
    "genus": "Chi",
    "confidence": 0.95
  },
  "alternatives": [
    {"scientific_name": "...", "confidence": 0.8}
  ],
  "habitat_and_habit": {
    "preferred_light": "Ánh sáng cần thiết",
    "water_need": "Nhu cầu nước",
    "soil": "Loại đất phù hợp",
    "temperature": "Nhiệt độ thích hợp"
  },
  "care_guide": {
    "watering": "Hướng dẫn tưới nước",
    "light": "Hướng dẫn ánh sáng",
    "soil": "Hướng dẫn đất",
    "fertilizing": "Hướng dẫn bón phân",
    "pruning": "Hướng dẫn cắt tỉa",
    "common_mistakes": ["Lỗi thường gặp"]
  },
  "fun_facts": ["Thông tin thú vị về cây"],
  "health_assessment": {
    "status": "Tình trạng sức khỏe chung",
    "possible_issues": [
      {
        "name": "Tên vấn đề",
        "likelihood": 0.7,
        "signs_in_image": "Dấu hiệu nhận biết trong ảnh",
        "checks_to_confirm": "Cách xác nhận",
        "safe_actions": "Cách xử lý an toàn"
      }
    ]
  }
}

Nếu không thể xác định được cây, hãy đưa ra gợi ý về loại ảnh bổ sung cần chụp.
Chỉ trả về JSON hợp lệ, không có text nào khác.`;

      // Build request using REST API with gemini-3-flash-preview model
      const requestBody = {
        contents: [{
          parts: [
            { text: prompt },
            ...imageParts
          ]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
          responseMimeType: "application/json"
        }
      };

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        }
      );

      const json = await response.json();

      // Check for API errors
      if (json.error) {
        console.error('Gemini API error:', json.error);
        return null;
      }

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
          // Clean up potential markdown code blocks
          let cleanText = text;
          if (cleanText.startsWith('```json')) {
            cleanText = cleanText.slice(7);
          } else if (cleanText.startsWith('```')) {
            cleanText = cleanText.slice(3);
          }
          if (cleanText.endsWith('```')) {
            cleanText = cleanText.slice(0, -3);
          }
          return JSON.parse(cleanText.trim());
        } catch (e) {
          console.warn('Gemini returned unparseable JSON', e, text);
        }
      }
    } catch (err) {
      console.error('Gemini API error', err);
    }
    return null;
  }

  /**
   * Display the result object in the resultsDiv as formatted content.
   */
  function displayResult(result) {
    resultsDiv.classList.remove('hidden');
    resultsDiv.innerHTML = '';

    if (!result || Object.keys(result).length === 0) {
      resultsDiv.innerHTML = '<p>Không thể xác định loài cây. Hãy thử lại với ảnh khác.</p>';
      return;
    }

    // Create a nicely formatted display
    let html = '';

    if (result.best_match) {
      html += `<h3>🌿 ${result.best_match.common_name || result.best_match.scientific_name}</h3>`;
      html += `<p><strong>Tên khoa học:</strong> <em>${result.best_match.scientific_name}</em></p>`;
      if (result.best_match.family) {
        html += `<p><strong>Họ:</strong> ${result.best_match.family}</p>`;
      }
      if (result.best_match.confidence) {
        html += `<p><strong>Độ tin cậy:</strong> ${Math.round(result.best_match.confidence * 100)}%</p>`;
      }
    }

    if (result.health_assessment) {
      html += `<h3>🏥 Tình trạng sức khỏe</h3>`;
      if (result.health_assessment.status) {
        html += `<p>${result.health_assessment.status}</p>`;
      }
      if (result.health_assessment.possible_issues && result.health_assessment.possible_issues.length > 0) {
        html += '<ul>';
        result.health_assessment.possible_issues.forEach(issue => {
          html += `<li><strong>${issue.name}</strong>`;
          if (issue.likelihood) {
            html += ` (${Math.round(issue.likelihood * 100)}%)`;
          }
          if (issue.safe_actions) {
            html += `<br><small>💡 ${issue.safe_actions}</small>`;
          }
          html += '</li>';
        });
        html += '</ul>';
      }
    }

    if (result.care_guide) {
      html += `<h3>📚 Hướng dẫn chăm sóc</h3>`;
      html += '<ul>';
      if (result.care_guide.watering) html += `<li><strong>Tưới nước:</strong> ${result.care_guide.watering}</li>`;
      if (result.care_guide.light) html += `<li><strong>Ánh sáng:</strong> ${result.care_guide.light}</li>`;
      if (result.care_guide.soil) html += `<li><strong>Đất:</strong> ${result.care_guide.soil}</li>`;
      if (result.care_guide.fertilizing) html += `<li><strong>Bón phân:</strong> ${result.care_guide.fertilizing}</li>`;
      html += '</ul>';
    }

    if (result.fun_facts && result.fun_facts.length > 0) {
      html += `<h3>✨ Thông tin thú vị</h3>`;
      html += '<ul>';
      result.fun_facts.forEach(fact => {
        html += `<li>${fact}</li>`;
      });
      html += '</ul>';
    }

    // Fallback to JSON if minimal data
    if (html === '') {
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(result, null, 2);
      resultsDiv.appendChild(pre);
    } else {
      resultsDiv.innerHTML = html;
    }
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

  fileInput.addEventListener('change', async (e) => {
    const file = fileInput.files[0];
    if (!file) {
      console.log('No file selected');
      return;
    }
    console.log('File selected:', file.name);
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