from PIL import Image
import os

ASSETS = os.path.dirname(os.path.abspath(__file__))

def chroma_key(img, target=(199, 65, 155), tol=40):
    """Make magenta-ish background transparent."""
    img = img.convert("RGBA")
    data = img.getdata()
    new_data = []
    tr, tg, tb = target
    for r, g, b, a in data:
        if abs(r - tr) < tol and abs(g - tg) < tol and abs(b - tb) < tol:
            new_data.append((r, g, b, 0))
        else:
            new_data.append((r, g, b, a))
    img.putdata(new_data)
    return img

def sample_bg_color(img, corner_size=10):
    img = img.convert("RGB")
    w, h = img.size
    px = img.load()
    samples = []
    for x in range(corner_size):
        for y in range(corner_size):
            samples.append(px[x, y])
    r = sum(s[0] for s in samples) // len(samples)
    g = sum(s[1] for s in samples) // len(samples)
    b = sum(s[2] for s in samples) // len(samples)
    return (r, g, b)

def process_single(name_in, name_out, trim=True):
    path = os.path.join(ASSETS, name_in)
    img = Image.open(path)
    bg_color = sample_bg_color(img)
    print(name_in, "bg color sampled:", bg_color)
    img = chroma_key(img, target=bg_color, tol=45)
    if trim:
        bbox = img.getbbox()
        if bbox:
            img = img.crop(bbox)
    out_path = os.path.join(ASSETS, name_out)
    img.save(out_path)
    print("saved", out_path, img.size)

# Process single-character sprites
process_single("enemy_patrol_bot.png", "enemy_patrol_bot_t.png")
process_single("enemy_swamp_critter.png", "enemy_swamp_critter_t.png")
process_single("enemy_drone.png", "enemy_drone_t.png")
process_single("boss_catfish.png", "boss_catfish_t.png")

# Process hero pose sheet - split into 5 poses first (rough equal columns), then chroma key each
img = Image.open(os.path.join(ASSETS, "hero_poses.png")).convert("RGBA")
w, h = img.size
print("hero_poses size", w, h)
col_w = w // 5
bg_color = sample_bg_color(img)
print("hero bg color:", bg_color)

names = ["hero_idle", "hero_run", "hero_jump", "hero_shoot", "hero_whip"]
for i, name in enumerate(names):
    x0 = i * col_w
    x1 = (i + 1) * col_w if i < 4 else w
    crop = img.crop((x0, 0, x1, h))
    crop = chroma_key(crop, target=bg_color, tol=45)
    bbox = crop.getbbox()
    if bbox:
        # pad bbox slightly
        pad = 6
        bbox = (max(0, bbox[0]-pad), max(0, bbox[1]-pad), min(crop.width, bbox[2]+pad), min(crop.height, bbox[3]+pad))
        crop = crop.crop(bbox)
    out_path = os.path.join(ASSETS, f"{name}.png")
    crop.save(out_path)
    print("saved", out_path, crop.size)

print("done")
