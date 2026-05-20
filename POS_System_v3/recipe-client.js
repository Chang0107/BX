(function () {
  let quotaBlockedUntilMs = 0;

  const EMPTY_RECIPE = {
    title: "",
    duration: "",
    difficulty: "",
    steps: [],
  };

  function normalizeRecipeSteps(recipe) {
    const stepsRaw = Array.isArray(recipe?.steps) ? recipe.steps : [];
    const steps = stepsRaw
      .map((s) => {
        const text = String(s?.text || s || "").trim();
        if (!text) return null;
        return {
          text,
          tip: String(s?.tip || "").trim(),
          img: "",
        };
      })
      .filter(Boolean);
    return {
      ...recipe,
      steps,
    };
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
      throw new Error("目前庫存不足，請先到食材頁新增或同步庫存。");
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
      throw new Error("食譜 API 額度暫時用盡，請稍後再試。");
    }
    try {
      return await fetchRecipeFromApi(inventory, selectedNames);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      if (isQuotaOrRateError(message)) {
        quotaBlockedUntilMs = Date.now() + parseRetryAfterMs(message);
      }
      console.warn("[RecipeFeature] getRecipe failed:", message);
      throw err;
    }
  }

  window.RecipeFeature = {
    getRecipe,
    inventoryToIngredients,
    filterIngredientsByNames,
    EMPTY_RECIPE,
  };
})();
