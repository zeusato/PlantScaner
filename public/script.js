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
  // Review UI
  const reviewContainer = document.getElementById('reviewContainer');
  const reviewImage = document.getElementById('reviewImage');
  const retakeButton = document.getElementById('retakeButton');
  const confirmButton = document.getElementById('confirmButton');

  // Session Key (now used for IDB ID)
  const SESSION_ID = 'current_session';

  // ========== STATE ==========
  let imageCounter = 0; // 0, 1, 2
  let capturedImages = [];
  let currentDraft = null; // Temporary storage for the image being reviewed
  let isProcessingFile = false;

  // Instructions for each step
  const INSTRUCTIONS = [
    'Bước 1/3: Chụp ảnh <strong>toàn cảnh cây</strong>',
    'Bước 2/3: Chụp ảnh <strong>lá khỏe mạnh</strong>',
    'Bước 3/3: Chụp ảnh <strong>vùng bị bệnh hoặc lá khác</strong>'
  ];

  // ========== SHOW CURRENT STEP ==========
  // ========== SHOW CURRENT STEP ==========
  function showCurrentStep() {
    console.log('[UI] Showing step, counter =', imageCounter);

    // Reset UI states
    reviewContainer.classList.add('hidden');
    resultsDiv.classList.add('hidden');

    if (imageCounter >= 3) return;

    // Show instruction for current step
    instructionsDiv.innerHTML = `<p>${INSTRUCTIONS[imageCounter]}</p>`;
    scanButton.textContent = 'SCAN';
    scanButton.style.display = '';
    scanButton.disabled = false;
  }

  // ========== SHOW REVIEW ==========
  function showReview(dataUri) {
    console.log('[UI] Showing review');
    // Hide Scan UI
    instructionsDiv.innerHTML = ''; // Keep layout but empty content or hide? Better to just hide scan button
    scanButton.style.display = 'none';

    // Show Review UI
    reviewImage.src = dataUri;
    reviewContainer.classList.remove('hidden');
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
  // ========== SCAN BUTTON CLICK ==========
  scanButton.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    console.log('[SCAN] Button clicked. Current counter:', imageCounter);

    // If we are in "Done" state (counter >= 3), this button acts as "Start New"
    if (imageCounter >= 3) {
      console.log('[SCAN] Starting new session');
      console.log('[SCAN] Starting new session');
      await clearSession(); // Clear storage
      imageCounter = 0;
      capturedImages = [];
      resultsDiv.classList.add('hidden');
      resultsDiv.innerHTML = '';
      showCurrentStep();
      return;
    }

    // Don't open camera if processing
    if (isProcessingFile) {
      console.log('[SCAN] Blocked - processing');
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
  // ========== FILE INPUT CHANGE ==========
  fileInput.addEventListener('change', async (e) => {
    if (isProcessingFile) return;

    const file = e.target.files && e.target.files[0];
    if (!file) return;

    console.log('[FILE] Got file:', file.name);
    isProcessingFile = true;

    try {
      // Compress and show review
      const dataUri = await compressImage(file);
      currentDraft = dataUri;

      // Clear input so same file can be selected again if needed (though we reset later)
      fileInput.value = '';

      showReview(currentDraft);
    } catch (err) {
      console.error('[FILE] Error:', err);
      alert('Lỗi xử lý ảnh: ' + err.message);
      showCurrentStep(); // Fallback
    } finally {
      isProcessingFile = false;
    }
  });

  // ========== REVIEW BUTTONS ==========
  retakeButton.addEventListener('click', () => {
    console.log('[REVIEW] Retake clicked');
    currentDraft = null;
    showCurrentStep();
  });

  confirmButton.addEventListener('click', async () => {
    console.log('[REVIEW] Confirm clicked');
    if (!currentDraft) return;

    capturedImages.push(currentDraft);
    imageCounter++;
    await saveSession(); // Save progress (async)
    currentDraft = null;

    if (imageCounter >= 3) {
      // Done capturing 3 images
      processImages();
    } else {
      showCurrentStep();
    }
  });

  // ========== PROCESS IMAGES ==========
  // ========== SHOW PROCESSING ==========
  function showProcessing() {
    instructionsDiv.innerHTML = '<p>⏳ Đang phân tích hình ảnh...</p>';
    scanButton.style.display = 'none';
    reviewContainer.classList.add('hidden');
  }

  // ========== PROCESS IMAGES ==========
  async function processImages() {
    console.log('[PROCESS] Starting with', capturedImages.length, 'images');

    // Ensure processing UI is shown
    showProcessing();

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
      // Set state to DONE (4) so Scan button becomes "Start New"
      imageCounter = 4;
      await clearSession(); // Job done, clear session

      scanButton.textContent = 'QUÉT CÂY KHÁC';
      scanButton.style.display = '';
      scanButton.disabled = false;
      instructionsDiv.innerHTML = '<p>Đã hoàn thành phân tích.</p>';
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
      const req = indexedDB.open('plantScannerDB', 2);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
        if (!db.objectStoreNames.contains('session')) {
          db.createObjectStore('session');
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

  // ========== SESSION STORAGE ==========
  // ========== SESSION STORAGE (IndexedDB) ==========
  async function saveSession() {
    try {
      const db = await openDB();
      const data = { imageCounter, capturedImages };
      return new Promise((resolve, reject) => {
        const tx = db.transaction('session', 'readwrite');
        const store = tx.objectStore('session');
        store.put(data, SESSION_ID);
        tx.oncomplete = () => {
          console.log('[SESSION] Saved state:', data.imageCounter);
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.error('[SESSION] Save failed:', e);
    }
  }

  async function loadSession() {
    try {
      const db = await openDB();
      const data = await new Promise((resolve, reject) => {
        const tx = db.transaction('session', 'readonly');
        const req = tx.objectStore('session').get(SESSION_ID);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      // Restore if data exists and is valid
      if (data && typeof data.imageCounter === 'number') {
        imageCounter = data.imageCounter;
        capturedImages = data.capturedImages || [];
        console.log('[SESSION] Restored state:', imageCounter);

        // If we were processing or ready to process (counter >= 3), resume it
        if (imageCounter >= 3) {
          console.log('[SESSION] Resuming processing...');
          processImages();
          return true;
        }

        return true;
      }
    } catch (e) {
      console.error('[SESSION] Load failed:', e);
    }
    return false;
  }

  async function clearSession() {
    try {
      const db = await openDB();
      const tx = db.transaction('session', 'readwrite');
      tx.objectStore('session').delete(SESSION_ID);
      console.log('[SESSION] Cleared');
    } catch (e) {
      console.error('[SESSION] Clear failed', e);
    }
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

    // Try to restore session
    const restored = await loadSession();
    if (!restored) {
      // Only show step 1 if we didn't restore (or if restored state was < 3, loadSession doesn't auto-show step, so we might need to?)
      // Actually loadSession handles processImages for >=3. 
      // We just need to call showCurrentStep for < 3.
      showCurrentStep();
    } else if (imageCounter < 3) {
      showCurrentStep();
    }
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