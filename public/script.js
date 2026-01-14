/*
 * Plant Scanner PWA - Front-end Logic
 * Flow: Show instruction -> User clicks SCAN -> Camera -> Confirm -> Repeat x3 -> API
 */

// import { GoogleGenAI } from "@google/generative-ai"; // Switched to dynamic import to prevent init crash

// (function () { // Removed IIFE because module scope is already isolated
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
const loadingOverlay = document.getElementById('loadingOverlay');

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
  window.logDebug ? window.logDebug(`[UI] Step ${imageCounter}`) : console.log(`[UI] Step ${imageCounter}`);
  console.log('[UI] Showing step, counter =', imageCounter);

  // Reset UI states
  reviewContainer.classList.add('hidden');
  // resultsDiv.classList.add('hidden'); // Keep results if we are just restarting? No, hide it
  loadingOverlay.classList.add('hidden');

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
        const MAX = 800; // Reduced from 1280 to save memory/storage
        if (w > h && w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        else if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.5)); // Reduced quality
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
    loadingOverlay.classList.add('hidden');
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
  instructionsDiv.innerHTML = ''; // Clear instructions
  scanButton.style.display = 'none';
  reviewContainer.classList.add('hidden');
  loadingOverlay.classList.remove('hidden');
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

    loadingOverlay.classList.add('hidden'); // Hide loading

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

// ========== CALL GEMINI (gemini-2.0-flash-exp) ==========
// ========== CALL GEMINI (SDK) ==========
async function callGemini(apiKey, images) {
  try {
    // 1. Prepare images for SDK
    // SDK expects: { inlineData: { data: "base64...", mimeType: "image/jpeg" } }
    const imageParts = images.map(uri => {
      // strip "data:image/jpeg;base64," header
      const commaIdx = uri.indexOf(',');
      if (commaIdx === -1) return null;
      const base64Data = uri.substring(commaIdx + 1);
      const mimeType = uri.substring(5, commaIdx).split(';')[0];
      return {
        inlineData: {
          data: base64Data,
          mimeType: mimeType
        }
      };
    }).filter(Boolean);

    // 2. Initialize Gemini Client
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    const prompt = `Bạn là chuyên gia thực vật học. Phân tích ảnh cây và trả về JSON:
{
  "best_match": {"scientific_name": "", "common_name": "", "family": "", "confidence": 0.9},
  "health_assessment": {"status": "", "possible_issues": [{"name": "", "likelihood": 0.7, "safe_actions": ""}]},
  "care_guide": {"watering": "", "light": "", "soil": "", "fertilizing": ""},
  "fun_facts": [""]
}
Trả lời bằng tiếng Việt. Chỉ trả về JSON.`;

    // 3. Generate Content
    const result = await model.generateContent([prompt, ...imageParts]);
    const response = await result.response;
    const text = response.text();

    // 4. Parse JSON
    let cleanText = text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(cleanText);

  } catch (err) {
    console.error('[GEMINI SDK] Failed:', err);
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
  // Debug Log
  const debugDiv = document.createElement('div');
  debugDiv.id = 'debugLog';
  debugDiv.style.cssText = 'position:fixed;top:0;left:0;background:rgba(0,0,0,0.7);color:#fff;font-size:10px;padding:5px;z-index:9999;max-width:200px;pointer-events:none;';
  document.body.appendChild(debugDiv);
  window.logDebug = msg => {
    console.log(msg);
    debugDiv.innerHTML = msg + '<br>' + debugDiv.innerHTML;
  };
  window.logDebug('[INIT] App started. v7 (Fix Class Name)');

  // Helper: Nuke old SW if stuck
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      for (let reg of regs) {
        // Unregister old ones if needed, or just let the new one take over via browser reload
        // reg.unregister(); 
      }
      navigator.serviceWorker.register('service-worker.js').then(reg => {
        reg.onupdatefound = () => {
          const installingWorker = reg.installing;
          installingWorker.onstatechange = () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
              window.logDebug('[SW] New version available. Reloading...');
              window.location.reload();
            }
          };
        };
      });
    });
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
// })(); // End of Module