"""User-reviewed per-serving nutrition input; no invented estimates."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field


def connection():
    from db import connection as current_connection
    return current_connection()

router = APIRouter(prefix="/api/recipes", tags=["Recipe nutrition"])

class NutritionUpdate(BaseModel):
    calories_per_serving: float | None = Field(default=None, ge=0, le=2500)
    protein_g_per_serving: float | None = Field(default=None, ge=0, le=300)
    carbs_g_per_serving: float | None = Field(default=None, ge=0, le=500)
    fat_g_per_serving: float | None = Field(default=None, ge=0, le=200)

@router.put("/{recipe_id}/nutrition")
def update_recipe_nutrition(recipe_id: int, data: NutritionUpdate):
    with connection() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT id FROM recipes WHERE id=?", (recipe_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Recipe not found")
        values = [data.calories_per_serving, data.protein_g_per_serving,
                  data.carbs_g_per_serving, data.fat_g_per_serving]
        c.execute("""UPDATE recipes SET calories_per_serving=?,
                     protein_g_per_serving=?, carbs_g_per_serving=?,
                     fat_g_per_serving=?, nutrition_source=? WHERE id=?""",
                  (data.calories_per_serving or 0, data.protein_g_per_serving,
                   data.carbs_g_per_serving, data.fat_g_per_serving,
                   "user_entered" if any(v is not None for v in values) else "unknown",
                   recipe_id))
    return {"ok": True, "recipe_id": recipe_id, "nutrition_source":
            "user_entered" if any(v is not None for v in values) else "unknown"}
