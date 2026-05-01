(function () {
  let quotaBlockedUntilMs = 0;

  const FALLBACK_RECIPE = {
    title: "香煎鮭魚",
    duration: "25 分鐘",
    difficulty: "簡易",
    steps: [
      {
        text: "鮭魚抹上海鹽與黑胡椒，靜置 10 分鐘。",
        tip: "提前回溫口感更佳。",
        img: "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?ixlib=rb-4.0.3&auto=format&fit=crop&w=1280&q=80",
      },
      {
        text: "平底鍋中火熱油，至出現油紋。",
        tip: "約 150 度。",
        img: "https://images.unsplash.com/photo-1590794056226-79ef3a8147e1?ixlib=rb-4.0.3&auto=format&fit=crop&w=1280&q=80",
      },
      {
        text: "魚皮朝下，大火煎 3 分鐘至金黃。",
        tip: "勿急翻面。",
        img: "https://images.unsplash.com/photo-1467003909585-2f8a7270028d?ixlib=rb-4.0.3&auto=format&fit=crop&w=1280&q=80",
      },
      {
        text: "翻面轉中小火，續煎 2 分鐘。",
        tip: "輕壓有彈性即熟。",
        img: "https://images.unsplash.com/photo-1580476262716-6b3693166861?ixlib=rb-4.0.3&auto=format&fit=crop&w=1280&q=80",
      },
      {
        text: "起鍋擺盤，擠上檸檬汁。",
        tip: "趁熱享用。",
        img: "https://images.unsplash.com/photo-1485921325833-c519f76c4927?ixlib=rb-4.0.3&auto=format&fit=crop&w=1280&q=80",
      },
    ],
  };

  function normalizeRecipeSteps(recipe) {
    const stepsRaw = Array.isArray(recipe?.steps) ? recipe.steps : [];
    const steps = stepsRaw
      .map((s) => {
        const text = String(s?.text || s || "").trim();
        if (!text) return null;
        const imagePrompt = String(s?.imagePrompt || text).trim();
        return {
          ...s,
          text,
          imagePrompt,
        };
      })
      .filter(Boolean);
    return {
      ...recipe,
      steps,
    };
  }

  async function fetchStepImage(imagePrompt) {
    const prompt = String(imagePrompt || "").trim();
    if (!prompt) throw new Error("image_prompt_required");
    const response = await fetch("/api/recipes/step-image/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagePrompt: prompt }),
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody?.details || errBody?.error || `step_image_api_error_${response.status}`);
    }
    const data = await response.json().catch(() => ({}));
    const imageUrl = String(data?.imageUrl || "").trim();
    if (!imageUrl) throw new Error("step_image_url_missing");
    return imageUrl;
  }

  function inventoryToIngredients(inventory) {
    if (!Array.isArray(inventory)) return [];
    return inventory
      .map((item) => {
        const raw = item && item.raw ? item.raw : item;
        if (!raw) return null;
        const name = String(raw.name || "").trim();
        const quantity = Number(raw.quantity || 0);
        if (!name || quantity <= 0) return null;
        return { name, quantity };
      })
      .filter(Boolean);
  }

  function filterIngredientsByNames(ingredients, selectedNames) {
    if (!Array.isArray(selectedNames) || selectedNames.length === 0) return ingredients;
    const selectedSet = new Set(selectedNames.map((n) => String(n || "").trim()).filter(Boolean));
    return ingredients.filter((ing) => selectedSet.has(String(ing.name || "").trim()));
  }

  function isQuotaOrRateError(message) {
    const u = String(message || "").toUpperCase();
    return (
      u.includes("429") ||
      u.includes("RESOURCE_EXHAUSTED") ||
      u.includes("RATE LIMIT") ||
      u.includes("RATE_LIMIT") ||
      u.includes("QUOTA")
    );
  }

  function parseRetryAfterMs(message) {
    const raw = String(message || "");
    const retryMatch = raw.match(/PLEASE RETRY IN\s+([\d.]+)S/i);
    if (retryMatch && retryMatch[1]) {
      const seconds = Number(retryMatch[1]);
      if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
    }
    return 15000;
  }

  async function fetchRecipeFromApi(inventory, selectedNames) {
    const allIngredients = inventoryToIngredients(inventory);
    const ingredients = filterIngredientsByNames(allIngredients, selectedNames);
    if (ingredients.length === 0) {
      return { ...FALLBACK_RECIPE, title: "目前庫存不足，先補貨再試" };
    }

    const response = await fetch("/api/recipes/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredients }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const msg = errBody?.details || errBody?.error || `recipe_api_error_${response.status}`;
      throw new Error(msg);
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.steps) || data.steps.length === 0) {
      throw new Error("invalid_recipe_payload");
    }
    return normalizeRecipeSteps(data);
  }

  async function getRecipe(inventory, selectedNames) {
    if (Date.now() < quotaBlockedUntilMs) {
      return normalizeRecipeSteps(FALLBACK_RECIPE);
    }
    try {
      return await fetchRecipeFromApi(inventory, selectedNames);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      if (isQuotaOrRateError(message)) {
        quotaBlockedUntilMs = Date.now() + parseRetryAfterMs(message);
      }
      console.warn("[RecipeFeature] fallback recipe:", message);
      return normalizeRecipeSteps(FALLBACK_RECIPE);
    }
  }

  window.RecipeFeature = {
    getRecipe,
    inventoryToIngredients,
    filterIngredientsByNames,
    fetchStepImage,
    FALLBACK_RECIPE,
  };
})();
