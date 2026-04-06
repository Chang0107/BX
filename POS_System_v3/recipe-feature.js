const express = require('express');
const fs = require('fs');
const path = require('path');

const RECIPE_ENV_FILE = path.join(__dirname, '.env.recipes');

function loadRecipeEnv() {
  if (!fs.existsSync(RECIPE_ENV_FILE)) return;
  try {
    const lines = fs.readFileSync(RECIPE_ENV_FILE, 'utf8').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const [k, ...rest] = line.split('=');
      const key = k.trim();
      const value = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
      if (key && value && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch (e) {
    console.warn('[食譜] 讀取 .env.recipes 失敗:', e.message);
  }
}

function isRateOrKeyError(message = '') {
  const u = String(message).toUpperCase();
  return (
    u.includes('429') ||
    u.includes('RESOURCE_EXHAUSTED') ||
    u.includes('QUOTA') ||
    u.includes('RATE') ||
    u.includes('API_KEY_INVALID') ||
    u.includes('REPORTED AS LEAKED') ||
    u.includes('PERMISSION_DENIED') ||
    u.includes('403')
  );
}

function normalizeRecipePayload(payload) {
  const title = String(payload?.title || 'AI 食譜建議');
  const duration = String(payload?.duration || '約 30 分鐘');
  const difficulty = String(payload?.difficulty || '中等');
  const stepsRaw = Array.isArray(payload?.steps) ? payload.steps : [];
  const steps = stepsRaw
    .map((s) => {
      // 相容模型可能回傳 string[] 或 {text}[]
      const text = typeof s === 'string' ? s : s?.text;
      return {
        text: String(text || '').trim(),
        // UI 仍使用 tip/img 欄位，後端固定給空值避免 AI 產圖需求
        tip: '',
        img: '',
      };
    })
    .filter((s) => s.text.length > 0);

  if (steps.length === 0) {
    throw new Error('invalid_recipe_steps');
  }
  return { title, duration, difficulty, steps };
}

function parseModelTextToJson(text) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  try {
    return JSON.parse(clean);
  } catch (_) {
    const matched = clean.match(/```json\s*([\s\S]*?)\s*```/i) || clean.match(/```([\s\S]*?)```/);
    if (matched?.[1]) {
      return JSON.parse(matched[1]);
    }
    return null;
  }
}

async function requestRecipeFromGemini({ ingredients, model, apiKey, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const prompt = `你是智慧廚房助理。請只輸出 JSON，不要任何額外文字。
根據以下食材，產出 1 道可執行的繁體中文食譜。
只需要「菜名」與「步驟」，不要提供圖片、不要提供圖片網址、不要提供 Markdown。
食材清單: ${JSON.stringify(ingredients, null, 2)}

輸出格式（嚴格遵守）:
{
  "title": "菜名",
  "steps": [
    { "text": "步驟1" },
    { "text": "步驟2" }
  ]
}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            topP: 0.9,
            maxOutputTokens: 1024,
          },
        }),
        signal: controller.signal,
      }
    );

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errText = body?.error?.message || `${res.status} ${res.statusText}`;
      throw new Error(errText);
    }

    const modelText = body?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || '';
    const parsed = parseModelTextToJson(modelText);
    if (!parsed) {
      throw new Error('model_output_not_json');
    }
    return normalizeRecipePayload(parsed);
  } finally {
    clearTimeout(timer);
  }
}

function createRecipeRouter({ onRecipeGenerated } = {}) {
  loadRecipeEnv();
  const RECIPE_MODEL = process.env.RECIPE_GEMINI_MODEL || 'gemini-2.0-flash';
  const RECIPE_API_TIMEOUT_MS = Number(process.env.RECIPE_API_TIMEOUT_MS || 60000);
  const RECIPE_API_KEYS = (
    process.env.RECIPE_GEMINI_API_KEYS
      ? process.env.RECIPE_GEMINI_API_KEYS.split(',')
      : (process.env.RECIPE_GEMINI_API_KEY ? [process.env.RECIPE_GEMINI_API_KEY] : [])
  ).map((k) => String(k || '').trim()).filter(Boolean);

  const router = express.Router();

  router.post(['/', ''], async (req, res) => {
    try {
      const input = req.body?.ingredients;
      if (!Array.isArray(input)) {
        return res.status(400).json({ error: 'ingredients 必須是陣列' });
      }

      const ingredients = input
        .map((i) => ({
          name: String(i?.name || '').trim(),
          quantity: Number(i?.quantity || 0),
        }))
        .filter((i) => i.name && i.quantity > 0);

      if (ingredients.length === 0) {
        return res.status(400).json({ error: '請至少提供一項有效食材' });
      }

      if (RECIPE_API_KEYS.length === 0) {
        return res.status(500).json({ error: '未設定 RECIPE_GEMINI_API_KEY(S)' });
      }

      let lastError = 'recipe_generation_failed';
      for (let idx = 0; idx < RECIPE_API_KEYS.length; idx++) {
        try {
          const recipe = await requestRecipeFromGemini({
            ingredients,
            model: RECIPE_MODEL,
            apiKey: RECIPE_API_KEYS[idx],
            timeoutMs: RECIPE_API_TIMEOUT_MS,
          });
          if (typeof onRecipeGenerated === 'function') {
            onRecipeGenerated(ingredients.length);
          }
          return res.json(recipe);
        } catch (e) {
          lastError = e.message || String(e);
          if (!isRateOrKeyError(lastError) && idx < RECIPE_API_KEYS.length - 1) continue;
          if (idx < RECIPE_API_KEYS.length - 1) continue;
        }
      }

      return res.status(502).json({ error: '食譜生成失敗', details: lastError });
    } catch (e) {
      return res.status(500).json({ error: '伺服器錯誤', details: e.message || String(e) });
    }
  });

  return router;
}

module.exports = {
  createRecipeRouter,
};
