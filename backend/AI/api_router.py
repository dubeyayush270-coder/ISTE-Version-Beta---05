
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from AI.config import create_user_configuration
from AI.recommend import get_recipe_recommendations

router = APIRouter(prefix="/api/ai", tags=["AI Recipes"])
logger = logging.getLogger(__name__)


class RecommendRequest(BaseModel):
    mode: Literal[
        "kids_tiffin", "fitness", "budget", "everyday"
    ] = "everyday"

    food_type: Literal["vegetarian", "any"] = "vegetarian"
    exclude: list[str] = Field(default_factory=list, max_length=20)
    cooking_time: int | None = Field(default=None, ge=1, le=240)
    max_results: int = Field(default=5, ge=1, le=10)


@router.post("/recommend")
def recommend_recipes(request: RecommendRequest):
    preferences = {
        "food_type": request.food_type,
        "exclude": [
            item.strip()
            for item in request.exclude
            if isinstance(item, str) and item.strip()
        ],
        "cooking_time": request.cooking_time,
    }

    configuration = create_user_configuration(
        request.mode, preferences
    )

    try:
        result = get_recipe_recommendations(configuration)

    except Exception:
        logger.exception("AI recipe recommendation failed")
        raise HTTPException(
            status_code=502,
            detail="Recipe search is temporarily unavailable"
        )

    recipes = result.get("recipes", [])[:request.max_results]

    return {
        "status": "ok" if recipes else "no_eligible_recipes",
        "source": "live_recipe_search",
        "recipes": recipes,
        "count": len(recipes),
        "search_queries": result.get("search_queries", []),
    }
