/*
 * Plant Scanner PWA - Front-end Logic
 * Flow: Show instruction -> User clicks SCAN -> Camera -> Confirm -> Repeat x3 -> API
 */

(function () {
  // DOM Elements
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

  // ========== STATE ==========
  let imageCounter = 0; // 0, 1, 2 (index of current step), 3 means all done
  let capturedImages = [];
  let isProcessingFile = false; // Flag to prevent double processing

  // Instructions for each step
  const INSTRUCTIONS = [
    'Bước 1/3: Chụp ảnh <strong>toàn cảnh cây</strong>',
    'Bước 2/3: Chụp ảnh <strong>lá khỏe mạnh</strong>',
    'Bước 3/3: Chụp ảnh <strong>vùng bị bệnh hoặc lá khác</strong>'
  ];

  // ========== SHOW CURRENT STEP ==========
  function showCurrentStep() {
    console.log('[UI] Showing step, counter =', imageCounter);

    if (imageCounter >= 3) {
      // All done, process images
      instructionsDiv.innerHTML = '<p>⏳ Đang phân tích hình ảnh...</p>';
      scanButton.style.display = 'none';
      processImages();
      return;
    }

    // Show instruction for current step
    instructionsDiv.innerHTML = `<p>${INSTRUCTIONS[imageCounter]}</p>`;
    scanButton.textContent = 'SCAN';
    scanButton.style.display = '';
    scanButton.disabled = false;
    resultsDiv.classList.add('hidden');
  }

  // ========== COMPRESS IMAGE ==========
  function compressImage(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          const MAX = 1280;
          if (w > h && w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
          else if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ========== SCAN BUTTON CLICK ==========
  scanButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    console.log('[SCAN] Button clicked. Current counter:', imageCounter);

    // Don't open camera if already processing or if all images captured
    if (isProcessingFile || imageCounter >= 3) {
      console.log('[SCAN] Blocked - processing or done');
      return;
    }

    // Clear input and open camera
    fileInput.value = '';

    // Use setTimeout to ensure the click happens after value reset
    setTimeout(() => {
      fileInput.click();
    }, 50);
  });

  // ========== FILE INPUT CHANGE ==========
  fileInput.addEventListener('change', async (e) => {
    // Prevent double processing
    if (isProcessingFile) {
      console.log('[FILE] Already processing, ignoring');
      return;
    }

    const file = e.target.files && e.target.files[0];
    if (!file) {
      console.log('[FILE] No file selected, user cancelled');
      return;
    }

    console.log('[FILE] Got file:', file.name, 'for step', imageCounter + 1);

    // Set flag to prevent double processing
    isProcessingFile = true;
    scanButton.disabled = true;

    try {
      // Compress and store image
      const dataUri = await compressImage(file);
      capturedImages.push(dataUri);
      imageCounter++;

      console.log('[FILE] Saved! Counter now:', imageCounter, 'Total images:', capturedImages.length);

      // Clear file input
      fileInput.value = '';

      // Show next step (do NOT auto-open camera)
      showCurrentStep();
    } catch (err) {
      console.error('[FILE] Error:', err);
    } finally {
      isProcessingFile = false;
    }
  });

  // ========== PROCESS IMAGES ==========
  async function processImages() {
    console.log('[PROCESS] Starting with', capturedImages.length, 'images');

    try {
      let result = null;

      // Try Pl@ntNet first
      try {
        const response = await fetch('/identify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            images: capturedImages,
            organs: ['auto', 'auto', 'auto'],
            detectDisease: true,
            lang: 'vi'
          })
        });
        const data = await response.json();
        if (data.identify?.results?.length > 0) {
          result = buildPlantnetResult(data);
        }
      } catch (err) {
        console.log('[PLANTNET] Failed:', err.message);
      }

      // Use Gemini
      const apiKey = await getKey();
      if (apiKey) {
        const geminiResult = await callGemini(apiKey, capturedImages);
        if (geminiResult) {
          result = geminiResult;
        }
      }

      displayResult(result);
    } catch (err) {
      resultsDiv.classList.remove('hidden');
      resultsDiv.innerHTML = `<p class="error">Lỗi: ${err.message}</p>`;
    } finally {
      // Reset state for next scan
      imageCounter = 0;
      capturedImages = [];
      scanButton.style.display = '';
      scanButton.disabled = false;
      instructionsDiv.innerHTML = '<p>Nhấn <strong>SCAN</strong> để quét cây mới.</p>';
    }
  }

  // ========== BUILD PLANTNET RESULT ==========
  function buildPlantnetResult(data) {
    const output = {};
    const top = data.identify?.results?.[0];
    if (top) {
      output.best_match = {
        scientific_name: top.species?.scientificNameWithoutAuthor || '',
        common_name: top.species?.commonNames?.[0] || '',
        confidence: top.score
      };
    }
    if (data.diseases?.results?.length > 0) {
      output.health_assessment = {
        issues: data.diseases.results.map(r => ({
          name: r.label || r.name || '',
          likelihood: r.score
        }))
      };
    }
    return output;
  }

  // ========== CALL GEMINI (gemini-3-flash-preview) ==========
  async function callGemini(apiKey, images) {
    const imageParts = images.map(uri => {
      const match = uri.match(/^data:(.+);base64,(.*)$/i);
      if (!match) return null;
      return { inlineData: { mimeType: match[1], data: match[2] } };
    }).filter(Boolean);

    const prompt = `Bạn là chuyên gia thực vật học. Phân tích ảnh cây và trả về JSON:
{
  "best_match": {"scientific_name": "", "common_name": "", "family": "", "confidence": 0.9},
  "health_assessment": {"status": "", "possible_issues": [{"name": "", "likelihood": 0.7, "safe_actions": ""}]},
  "care_guide": {"watering": "", "light": "", "soil": "", "fertilizing": ""},
  "fun_facts": [""]
}
Trả lời bằng tiếng Việt. Chỉ trả về JSON.`;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, ...imageParts] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
          })
        }
      );

      const json = await res.json();
      if (json.error) {
        console.error('[GEMINI] Error:', json.error);
        return null;
      }

      let text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      text = text.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      return JSON.parse(text);
    } catch (err) {
      console.error('[GEMINI] Failed:', err);
      return null;
    }
  }

  // ========== DISPLAY RESULT ==========
  function displayResult(result) {
    resultsDiv.classList.remove('hidden');

    if (!result || Object.keys(result).length === 0) {
      resultsDiv.innerHTML = '<p>Không xác định được cây. Thử lại với ảnh khác.</p>';
      return;
    }

    let html = '';

    if (result.best_match) {
      html += `<h3>🌿 ${result.best_match.common_name || result.best_match.scientific_name}</h3>`;
      html += `<p><em>${result.best_match.scientific_name}</em></p>`;
      if (result.best_match.family) html += `<p>Họ: ${result.best_match.family}</p>`;
      if (result.best_match.confidence) html += `<p>Độ tin cậy: ${Math.round(result.best_match.confidence * 100)}%</p>`;
    }

    if (result.health_assessment) {
      html += `<h3>🏥 Sức khỏe</h3>`;
      if (result.health_assessment.status) html += `<p>${result.health_assessment.status}</p>`;
      if (result.health_assessment.possible_issues?.length) {
        html += '<ul>';
        result.health_assessment.possible_issues.forEach(i => {
          html += `<li><strong>${i.name}</strong>`;
          if (i.likelihood) html += ` (${Math.round(i.likelihood * 100)}%)`;
          if (i.safe_actions) html += `<br><small>💡 ${i.safe_actions}</small>`;
          html += '</li>';
        });
        html += '</ul>';
      }
    }

    if (result.care_guide) {
      html += `<h3>📚 Chăm sóc</h3><ul>`;
      if (result.care_guide.watering) html += `<li>💧 ${result.care_guide.watering}</li>`;
      if (result.care_guide.light) html += `<li>☀️ ${result.care_guide.light}</li>`;
      if (result.care_guide.soil) html += `<li>🌱 ${result.care_guide.soil}</li>`;
      if (result.care_guide.fertilizing) html += `<li>🧪 ${result.care_guide.fertilizing}</li>`;
      html += '</ul>';
    }

    if (result.fun_facts?.length) {
      html += `<h3>✨ Thú vị</h3><ul>`;
      result.fun_facts.forEach(f => html += `<li>${f}</li>`);
      html += '</ul>';
    }

    resultsDiv.innerHTML = html || `<pre>${JSON.stringify(result, null, 2)}</pre>`;
  }

  // ========== INDEXEDDB ==========
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('plantScannerDB', 1);
      req.onupgradeneeded = e => {
        if (!e.target.result.objectStoreNames.contains('settings')) {
          e.target.result.createObjectStore('settings');
        }
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getKey() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction('settings', 'readonly').objectStore('settings').get('geminiKey');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveKey(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction('settings', 'readwrite').objectStore('settings').put(key, 'geminiKey');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteKey() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction('settings', 'readwrite').objectStore('settings').delete('geminiKey');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ========== MODALS ==========
  const showModal = m => m.classList.add('show');
  const hideModal = m => m.classList.remove('show');

  async function updateKeyStatus() {
    keyStatus.textContent = (await getKey()) ? 'Đã lưu khóa Gemini.' : 'Chưa có khóa Gemini.';
  }

  // ========== INIT ==========
  window.addEventListener('DOMContentLoaded', async () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js').catch(console.error);
    }
    if (!(await getKey())) showModal(keyModal);
    updateKeyStatus();

    // Show first step
    showCurrentStep();
  });

  saveKeyButton.addEventListener('click', async () => {
    const val = apiKeyInput.value.trim();
    if (val) {
      await saveKey(val);
      apiKeyInput.value = '';
      hideModal(keyModal);
      updateKeyStatus();
    }
  });

  settingsButton.addEventListener('click', () => { updateKeyStatus(); showModal(settingsModal); });
  closeSettingsButton.addEventListener('click', () => hideModal(settingsModal));
  changeKeyButton.addEventListener('click', () => { hideModal(settingsModal); showModal(keyModal); });
  deleteKeyButton.addEventListener('click', async () => { await deleteKey(); hideModal(settingsModal); showModal(keyModal); });
})();