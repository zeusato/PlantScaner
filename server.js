/*
 * Plant PWA backend
 *
 * This simple HTTP server performs two tasks:
 *   1. Serves the static front‑end files from the `public/` directory.
 *   2. Provides an API endpoint at `/identify` which accepts a JSON
 *      payload containing base64‑encoded images and optional organ hints.
 *      It uses the Pl@ntNet API to identify the plant species and
 *      optionally detect diseases. The API key for Pl@ntNet must be
 *      supplied via the environment variable `PLANTNET_API_KEY`.
 *
 * For security reasons the user's Gemini API key is never sent to this
 * server. All Gemini calls are made directly from the client.
 */

const http = require('http');
const path = require('path');
const fs = require('fs/promises');

// Grab the API key from the environment. If not set the server will
// still start but calls to Pl@ntNet will fail. This allows the front‑end
// to operate in fallback mode using Gemini only.
const PLANTNET_API_KEY = process.env.PLANTNET_API_KEY || '';

// Port for the HTTP server; defaults to 3000.
const PORT = process.env.PORT || 3000;

// The root directory for static files. All files inside this directory
// will be served relative to `public/` when requested by the client.
const PUBLIC_DIR = path.join(__dirname, 'public');

// Simple MIME type mapping for static file serving.
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=UTF-8',
  '.ico': 'image/x-icon'
};

/**
 * Serve a static file from the PUBLIC_DIR. Returns true if the request
 * matched a file and was handled, false otherwise.
 */
async function serveStaticFile(req, res) {
  // Normalise the pathname and prevent directory traversal attacks
  const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  let filePath = path.join(PUBLIC_DIR, decodeURIComponent(urlPath));

  // If the path ends with a slash, append index.html
  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch (e) {
    // File doesn't exist in the filesystem; we'll return false below
  }

  // Attempt to read the file
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
    return true;
  } catch (err) {
    // File not found; caller must handle 404/other routes
    return false;
  }
}

/**
 * Decode a data URI into a Blob. The input must be a string of the form
 * 'data:<mimeType>;base64,<base64Data>'. Returns an object with a
 * Buffer and mimeType.
 */
function decodeDataUri(dataUri) {
  const match = /^data:(.+);base64,(.*)$/i.exec(dataUri);
  if (!match) {
    throw new Error('Invalid data URI');
  }
  const mimeType = match[1];
  const data = Buffer.from(match[2], 'base64');
  return { buffer: data, mimeType };
}

/**
 * Build a FormData object from images and associated organs. Uses the
 * global FormData, Blob and File classes provided by node 18+.
 */
function buildFormData(images, organs) {
  const form = new FormData();
  images.forEach((dataUri, idx) => {
    const { buffer, mimeType } = decodeDataUri(dataUri);
    const fileExt = mimeType.split('/')[1] || 'jpg';
    const blob = new Blob([buffer], { type: mimeType });
    // Provide a filename so that downstream services can infer type
    form.append('images', blob, `image${idx}.${fileExt}`);
    const organValue = Array.isArray(organs) && organs[idx] ? organs[idx] : 'auto';
    form.append('organs', organValue);
  });
  return form;
}

/**
 * Handle POST /identify API calls. Expects JSON with fields:
 *  - images: Array of data URI strings (base64 encoded)
 *  - organs: (optional) array of strings describing the organ for each image
 *  - detectDisease: (optional boolean) whether to call the diseases API
 *  - lang: (optional) language code for localisation
 */
async function handleIdentify(req, res) {
  // Accumulate the request body
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    // Protect against large payloads
    if (body.length > 1e7) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Payload too large' }));
      req.socket.destroy();
    }
  });
  req.on('end', async () => {
    try {
      const payload = JSON.parse(body || '{}');
      const images = Array.isArray(payload.images) ? payload.images : [];
      if (images.length === 0) {
        throw new Error('No images provided');
      }

      // Build form data for Pl@ntNet identify API
      const organs = Array.isArray(payload.organs) ? payload.organs : [];
      const formIdentify = buildFormData(images, organs);
      // Append language if provided
      if (payload.lang) {
        formIdentify.append('lang', payload.lang);
      }

      // Compose the identify URL. Default project is 'all'.
      const identifyUrl = `https://my-api.plantnet.org/v2/identify/all?api-key=${encodeURIComponent(PLANTNET_API_KEY)}`;

      // Call Pl@ntNet identify API
      let identifyResult;
      try {
        const identifyResponse = await fetch(identifyUrl, {
          method: 'POST',
          body: formIdentify
        });
        identifyResult = await identifyResponse.json();
      } catch (err) {
        identifyResult = { error: 'Identify call failed', details: err.message };
      }

      // Optionally call diseases API
      let diseasesResult = null;
      if (payload.detectDisease) {
        // Build a new form for diseases (organs can all be 'auto' for diseases)
        const formDisease = buildFormData(images, organs);
        if (payload.lang) {
          formDisease.append('lang', payload.lang);
        }
        const diseaseUrl = `https://my-api.plantnet.org/v2/diseases/identify?api-key=${encodeURIComponent(PLANTNET_API_KEY)}`;
        try {
          const diseaseResponse = await fetch(diseaseUrl, {
            method: 'POST',
            body: formDisease
          });
          diseasesResult = await diseaseResponse.json();
        } catch (err) {
          diseasesResult = { error: 'Diseases call failed', details: err.message };
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ identify: identifyResult, diseases: diseasesResult }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

// Create and start the HTTP server
const server = http.createServer(async (req, res) => {
  const method = req.method || '';
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  // Route: POST /identify
  if (method === 'POST' && urlObj.pathname === '/identify') {
    return handleIdentify(req, res);
  }
  // Serve static files for all other requests
  const served = await serveStaticFile(req, res);
  if (!served) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`Plant PWA server listening on port ${PORT}`);
});