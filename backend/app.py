"""KitchenSync v0.1 demo: household plans, recipe book, inventory and cooking."""
import json
from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from core import audit_meals, inventory_map, scale_ingredients, stock_available
from db import connection, init_db

APP_DIR = Path(__file__).resolve().parent.parent
app = FastAPI(title="KitchenSync API", version="0.2.0")


@app.on_event("startup")
def startup():
    init_db()


def row_dict(row):
    return dict(row)


def stock_list(c):
    return [dict(r) for r in c.execute("SELECT * FROM stock ORDER BY name")]


def recipe_list(c):
    out = []
    for r in c.execute("SELECT * FROM recipes ORDER BY category, name"):
        item = dict(r)
        for k in ('tags','ingredients','steps'):
            item[k] = json.loads(item[k])
        out.append(item)
    return out


def plans(c, start, days=7):
    end = start + timedelta(days=days-1)
    return [dict(r) for r in c.execute("""SELECT m.*, r.name AS recipe_name, r.calories_per_serving,
        r.minutes, r.category FROM meal_plan m JOIN recipes r ON m.recipe_id=r.id
        WHERE m.meal_date BETWEEN ? AND ? ORDER BY meal_date, CASE meal_type
        WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 ELSE 3 END""",(start.isoformat(),end.isoformat()))]


class HouseholdUpdate(BaseModel):
    household_name: str = Field(min_length=1,max_length=80)
    household_size: int = Field(ge=1,le=30)


class StockInput(BaseModel):
    name: str = Field(min_length=1,max_length=80)
    quantity: float = Field(ge=0,le=1_000_000)
    unit: str
    expiry_date: date | None = None
    is_leftover: bool = False
    prepared_at: datetime | None = None
    storage: str | None = None


class MealInput(BaseModel):
    recipe_id: int
    eaters: int = Field(ge=1,le=30)


@app.get('/api/health')
def health():
    return {'status':'ok','version':'0.2.0'}


@app.get('/api/settings')
def settings():
    with connection() as c:
        return row_dict(c.execute('SELECT * FROM settings WHERE id=1').fetchone())


@app.put('/api/settings')
def save_settings(data:HouseholdUpdate):
    with connection() as c:
        c.execute('UPDATE settings SET household_name=?,household_size=? WHERE id=1', (data.household_name.strip(),data.household_size))
    return settings()


@app.get('/api/inventory')
def inventory():
    with connection() as c:
        items = stock_list(c)
    for i in items:
        i['usable'] = stock_available(i)
    return items


def validate_stock(data):
    if data.unit not in ('g','ml','pcs'):
        raise HTTPException(422,'Unit must be g, ml, or pcs. Convert kg to g and L to ml.')
    if data.is_leftover and (data.prepared_at is None or data.storage not in ('refrigerated','room_temperature','frozen')):
        raise HTTPException(422,'Leftovers require a prepared time and storage method.')
    return (data.name.strip(),data.quantity,data.unit,data.expiry_date.isoformat() if data.expiry_date else None,
            int(data.is_leftover),data.prepared_at.isoformat(timespec='seconds') if data.prepared_at else None,data.storage)


@app.post('/api/inventory',status_code=201)
def add_inventory(data:StockInput):
    vals = validate_stock(data)
    with connection() as c:
        if c.execute('SELECT 1 FROM stock WHERE name=?',(vals[0],)).fetchone():
            raise HTTPException(409,'An item with this name already exists. Edit it instead.')
        c.execute('INSERT INTO stock(name,quantity,unit,expiry_date,is_leftover,prepared_at,storage) VALUES(?,?,?,?,?,?,?)',vals)
    return {'ok':True}


@app.put('/api/inventory/{item_id}')
def edit_inventory(item_id:int,data:StockInput):
    vals = validate_stock(data)
    with connection() as c:
        if not c.execute('SELECT 1 FROM stock WHERE id=?',(item_id,)).fetchone():
            raise HTTPException(404,'Ingredient not found')
        if c.execute('SELECT 1 FROM stock WHERE name=? AND id<>?',(vals[0],item_id)).fetchone():
            raise HTTPException(409,'Ingredient name already exists')
        c.execute('UPDATE stock SET name=?,quantity=?,unit=?,expiry_date=?,is_leftover=?,prepared_at=?,storage=? WHERE id=?',(*vals,item_id))
    return {'ok':True}


@app.delete('/api/inventory/{item_id}')
def remove_inventory(item_id:int):
    with connection() as c:
        cur=c.execute('DELETE FROM stock WHERE id=?',(item_id,))
        if not cur.rowcount:
            raise HTTPException(404,'Ingredient not found')
    return {'ok':True}


@app.get('/api/recipes')
def recipes():
    with connection() as c:
        return recipe_list(c)


@app.get('/api/suggestions')
def suggestions(craving:str=''):
    """Offline rules in v0.1; replace with an AI tool adapter in a later milestone."""
    with connection() as c:
        stock = inventory_map(stock_list(c))
        recipes = recipe_list(c)
    words = set(craving.lower().split())
    results=[]
    for recipe in recipes:
        req = scale_ingredients(recipe,2)
        covered = sum(1 for r in req if r['name'].casefold() in stock and stock[r['name'].casefold()]['unit']==r['unit'] and stock[r['name'].casefold()]['quantity']>=r['quantity'])
        match = sum(1 for w in words if w in recipe['name'].lower() or w in recipe['tags'])
        results.append({'recipe':recipe,'covered':covered,'total':len(req),'score':round(covered/max(1,len(req)),2)+match*0.5})
    results.sort(key=lambda r:r['score'],reverse=True)
    return {'mode':'offline-rule-based-demo','results':results[:5]}


@app.get('/api/plan')
def get_plan(start:date|None=None,days:int=Query(7,ge=1,le=31)):
    with connection() as c:
        return plans(c,start or date.today(),days)


@app.put('/api/plan/{meal_date}/{meal_type}')
def set_meal(meal_date:date,meal_type:str,data:MealInput):
    if meal_type not in ('breakfast','lunch','dinner'):
        raise HTTPException(422,'Invalid meal type')
    with connection() as c:
        recipe=c.execute('SELECT 1 FROM recipes WHERE id=?',(data.recipe_id,)).fetchone()
        if not recipe: raise HTTPException(404,'Recipe not found')
        existing=c.execute('SELECT completed_at FROM meal_plan WHERE meal_date=? AND meal_type=?',(meal_date.isoformat(),meal_type)).fetchone()
        if existing and existing['completed_at']:
            raise HTTPException(409,'Completed meals cannot be changed; stock has already been deducted.')
        c.execute('''INSERT INTO meal_plan(meal_date,meal_type,recipe_id,eaters) VALUES(?,?,?,?)
            ON CONFLICT(meal_date,meal_type) DO UPDATE SET recipe_id=excluded.recipe_id,eaters=excluded.eaters''',
            (meal_date.isoformat(),meal_type,data.recipe_id,data.eaters))
    return {'ok':True}


@app.delete('/api/plan/{meal_date}/{meal_type}')
def delete_meal(meal_date:date,meal_type:str):
    with connection() as c:
        item=c.execute('SELECT completed_at FROM meal_plan WHERE meal_date=? AND meal_type=?',(meal_date.isoformat(),meal_type)).fetchone()
        if not item:raise HTTPException(404,'Meal not found')
        if item['completed_at']:raise HTTPException(409,'Cannot delete a completed meal')
        c.execute('DELETE FROM meal_plan WHERE meal_date=? AND meal_type=?',(meal_date.isoformat(),meal_type))
    return {'ok':True}


@app.get('/api/stock-check')
def stock_check(start:date|None=None,days:int=Query(7,ge=1,le=31)):
    start=start or date.today()
    with connection() as c:
        meals=plans(c,start,days)
        stock=stock_list(c)
        rs=recipe_list(c)
    audit=audit_meals(meals,{r['id']:r for r in rs},stock)
    return {'start':start.isoformat(),'days':days,**audit}


@app.post('/api/plan/{meal_date}/{meal_type}/complete')
def complete_meal(meal_date:date,meal_type:str):
    with connection() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute('''SELECT m.*, r.name recipe_name,r.base_servings,r.ingredients FROM meal_plan m
          JOIN recipes r ON r.id=m.recipe_id WHERE m.meal_date=? AND m.meal_type=?''',
          (meal_date.isoformat(),meal_type)).fetchone()
        if not row: raise HTTPException(404,'Planned meal not found')
        if row['completed_at']:raise HTTPException(409,'Already completed. Inventory was deducted previously.')
        recipe={'base_servings':row['base_servings'],'ingredients':json.loads(row['ingredients'])}
        required=scale_ingredients(recipe,row['eaters'])
        stock={x['name'].casefold():x for x in stock_list(c)}
        problems=[]
        for r in required:
            item=stock.get(r['name'].casefold())
            if not item or item['unit']!=r['unit'] or not stock_available(item) or item['quantity']+1e-8<r['quantity']:
                problems.append(f"{r['name']}: need {r['quantity']} {r['unit']}")
        if problems:
            raise HTTPException(409,{'message':'Not enough usable ingredients. Update stock or meal before completing.','missing':problems})
        for r in required:
            c.execute('UPDATE stock SET quantity=MAX(0,quantity-?) WHERE name=?', (r['quantity'],r['name']))
        c.execute('UPDATE meal_plan SET completed_at=? WHERE id=?',(datetime.now().isoformat(timespec='seconds'),row['id']))
    return {'ok':True,'recipe':row['recipe_name'],'deducted':required}


@app.get('/api/dashboard')
def dashboard():
    today=date.today()
    with connection() as c:
        stock=stock_list(c)
        rs=recipe_list(c)
        week=plans(c,today,7)
        today_plan=[m for m in week if m['meal_date']==today.isoformat()]
    audit=audit_meals(week,{r['id']:r for r in rs},stock)
    expired=[i for i in stock if not stock_available(i)]
    expiring=[i for i in stock if i.get('expiry_date') and today<=date.fromisoformat(i['expiry_date'])<=today+timedelta(days=3)]
    return {'household':settings(),'stock_items':len(stock),'planned_meals':len(week),
            'today_meals':today_plan,'missing_alerts':audit['warnings'][:8],
            'expired_or_unsafe':expired,'expiring_soon':expiring,
            'shopping_count':len(audit['shopping'])}


# During development Vite serves the React frontend on http://127.0.0.1:5173.
# If a production build exists, FastAPI can also serve its static assets.
DIST_DIR = APP_DIR / 'frontend' / 'dist'
if DIST_DIR.is_dir():
    app.mount('/assets', StaticFiles(directory=DIST_DIR / 'assets'), name='react-assets')


@app.get('/')
def index():
    built_index = DIST_DIR / 'index.html'
    if built_index.is_file():
        return FileResponse(built_index)
    return JSONResponse({'message':'KitchenSync FastAPI running. Open http://127.0.0.1:5173 for the React UI.',
                         'api_docs':'/docs'})
