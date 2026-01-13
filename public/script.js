/*
 * Front‑end logic for the Plant Scanner PWA.
 *
 * This script manages the user interface flow for capturing three
 * photographs (whole plant, close‑up of a healthy leaf and close‑up of
 * a problematic part), compressing them, sending them to the backend
 * for identification and disease detection, and calling Gemini for
 * detailed analysis.
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

  // Step labels for the capture flow
  const stepLabels = [
    'Ảnh 1/3: Chụp toàn bộ cây',
    'Ảnh 2/3: Chụp cận cảnh lá khỏe mạnh',
    'Ảnh 3/3: Chụp cận cảnh vùng bị bệnh hoặc lá khác'
  ];

  /**
   * Compress an image file to JPEG with max dimension 1280px
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
   * Update the UI to show capture progress with preview and next button
   */
  function updateCaptureUI() {
    let html = `<p><strong>${stepLabels[currentStep]}</strong></p>`;

    // Show captured images thumbnails
    if (capturedImages.length > 0) {
      html += '<div style="display:flex;gap:8px;margin:10px 0;justify-content:center;">';
      capturedImages.forEach((img, idx) => {
        html += `<img src="${img}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;border:2px solid var(--primary);" alt="Ảnh ${idx + 1}">`;
      });
      html += '</div>';
    }

    html += `<button id="captureBtn" class="capture-btn">📷 Chụp ảnh</button>`;

    instructionsDiv.innerHTML = html;

    // Add event listener to the new button
    document.getElementById('captureBtn').addEventListener('click', () => {
      fileInput.value = '';
      fileInput.click();
    });
  }

  /**
   * Start a new scanning flow
   */
  function startScan() {
    capturedImages = [];
    currentStep = 0;
    resultsDiv.classList.add('hidden');
    scanButton.style.display = 'none';
    updateCaptureUI();
  }

  /**
   * Handle when a photo is captured
   */
  async function handleCapture(file) {
    if (!file) return;

    const dataUri = await compressImage(file);
    capturedImages.push(dataUri);
    currentStep++;

    if (currentStep < 3) {
      // More images needed - show UI for next capture
      updateCaptureUI();
    } else {
      // All 3 images captured, start analysis
      instructionsDiv.innerHTML = '<p>⏳ Đang phân tích hình ảnh...</p>';
      scanButton.style.display = 'none';

      try {
        await performIdentification();
      } finally {
        // Reset UI
        scanButton.style.display = '';
        instructionsDiv.innerHTML = '<p>Nhấn nút <strong>SCAN</strong> để bắt đầu.</p>';
      }
    }
  }

  /**
   * Send images to backend and/or Gemini for analysis
   */
  async function performIdentification() {
    try {
      // First try Pl@ntNet via backend
      const organs = ['auto', 'auto', 'auto'];
      const payload = {
        images: capturedImages,
        organs: organs,
        detectDisease: true,
        lang: 'vi'
      };

      let result = null;

      try {
        const response = await fetch('/identify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await response.json();
        result = buildResultFromPlantnet(data);
      } catch (e) {
        console.log('Pl@ntNet failed, falling back to Gemini');
      }

      // Always try Gemini for better results
      const gemKey = await getKey();
      if (gemKey) {
        const gemResult = await callGemini(gemKey, capturedImages);
        if (gemResult) {
          result = gemResult;
        }
      }

      displayResult(result);
    } catch (err) {
      resultsDiv.classList.remove('hidden');
      resultsDiv.innerHTML = '<p class="error">Đã xảy ra lỗi: ' + err.message + '</p>';
    }
  }

  /**
   * Build result from Pl@ntNet response
   */
  function buildResultFromPlantnet(data) {
    const output = {};
    if (data && data.identify && Array.isArray(data.identify.results) && data.identify.results.length > 0) {
      const top = data.identify.results[0];
      output.best_match = {
        scientific_name: top.species?.scientificNameWithoutAuthor || data.identify.bestMatch || '',
        common_name: top.species?.commonNames?.[0] || '',
        confidence: top.score
      };
      output.alternatives = data.identify.results.slice(1, 5).map((r) => ({
        scientific_name: r.species?.scientificNameWithoutAuthor || '',
        confidence: r.score
      }));
    }
    if (data?.diseases?.results?.length > 0) {
      output.health_assessment = {
        issues: data.diseases.results.map((r) => ({
          name: r.label || r.name || '',
          likelihood: r.score
        }))
      };
    }
    return output;
  }

  /**
   * Call Gemini API with gemini-3-flash-preview model
   */
  async function callGemini(apiKey, images) {
    try {
      // Prepare image parts
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

      const requestBody = {
        contents: [{
          parts: [
            { text: prompt },
            ...imageParts
          ]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048
        }
      };

      // Use gemini-3-flash-preview model as requested
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        }
      );

      const json = await response.json();

      if (json.error) {
        console.error('Gemini API error:', json.error);
        return null;
      }

      // Extract text from response
      let text = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (text) {
        // Clean markdown code blocks if present
        if (text.startsWith('```json')) text = text.slice(7);
        else if (text.startsWith('```')) text = text.slice(3);
        if (text.endsWith('```')) text = text.slice(0, -3);

        try {
          return JSON.parse(text.trim());
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
   * Display results in a nice format
   */
  function displayResult(result) {
    resultsDiv.classList.remove('hidden');
    resultsDiv.innerHTML = '';

    if (!result || Object.keys(result).length === 0) {
      resultsDiv.innerHTML = '<p>Không thể xác định loài cây. Hãy thử lại với ảnh khác.</p>';
      return;
    }

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
      if (result.health_assessment.possible_issues?.length > 0) {
        html += '<ul>';
        result.health_assessment.possible_issues.forEach(issue => {
          html += `<li><strong>${issue.name}</strong>`;
          if (issue.likelihood) html += ` (${Math.round(issue.likelihood * 100)}%)`;
          if (issue.safe_actions) html += `<br><small>💡 ${issue.safe_actions}</small>`;
          html += '</li>';
        });
        html += '</ul>';
      }
    }

    if (result.care_guide) {
      html += `<h3>📚 Hướng dẫn chăm sóc</h3><ul>`;
      if (result.care_guide.watering) html += `<li><strong>Tưới nước:</strong> ${result.care_guide.watering}</li>`;
      if (result.care_guide.light) html += `<li><strong>Ánh sáng:</strong> ${result.care_guide.light}</li>`;
      if (result.care_guide.soil) html += `<li><strong>Đất:</strong> ${result.care_guide.soil}</li>`;
      if (result.care_guide.fertilizing) html += `<li><strong>Bón phân:</strong> ${result.care_guide.fertilizing}</li>`;
      html += '</ul>';
    }

    if (result.fun_facts?.length > 0) {
      html += `<h3>✨ Thông tin thú vị</h3><ul>`;
      result.fun_facts.forEach(fact => html += `<li>${fact}</li>`);
      html += '</ul>';
    }

    resultsDiv.innerHTML = html || `<pre>${JSON.stringify(result, null, 2)}</pre>`;
  }

  // IndexedDB functions
  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('plantScannerDB', 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getKey() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly');
      const req = tx.objectStore('settings').get('geminiKey');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveKey(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      const req = tx.objectStore('settings').put(key, 'geminiKey');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteKey() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      const req = tx.objectStore('settings').delete('geminiKey');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  function showModal(modal) { modal.classList.add('show'); }
  function hideModal(modal) { modal.classList.remove('show'); }

  async function updateKeyStatus() {
    const key = await getKey();
    keyStatus.textContent = key ? 'Đã lưu khóa Gemini.' : 'Chưa có khóa Gemini.';
  }

  // Event listeners
  window.addEventListener('DOMContentLoaded', async () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js').catch(console.error);
    }
    const storedKey = await getKey();
    if (!storedKey) showModal(keyModal);
    updateKeyStatus();
  });

  scanButton.addEventListener('click', startScan);

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleCapture(file);
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

  closeSettingsButton.addEventListener('click', () => hideModal(settingsModal));

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