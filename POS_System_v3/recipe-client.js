(function () {
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
    return data;
  }

  async function getRecipe(inventory, selectedNames) {
    try {
      return await fetchRecipeFromApi(inventory, selectedNames);
    } catch (err) {
      console.warn("[RecipeFeature] fallback recipe:", err && err.message ? err.message : err);
      return FALLBACK_RECIPE;
    }
  }

  window.RecipeFeature = {
    getRecipe,
    inventoryToIngredients,
    filterIngredientsByNames,
    FALLBACK_RECIPE,
  };
})();
