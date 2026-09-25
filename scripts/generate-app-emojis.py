# -*- coding: utf-8 -*-
"""Draws the OmniFM app emojis (#265) into assets/discord-emojis/.

Only needed to redraw them: the PNG/GIF files are committed and the bots
upload them on their own (src/discord/ui/app-emojis.js). After a change,
raise "version" in assets/discord-emojis/manifest.json so every bot replaces
its old emojis.

    pip install pillow
    python scripts/generate-app-emojis.py

The icons are drawn at 4x and scaled down, which gives clean edges. Colours
are the website palette: orange #FF6B00, cyan #00E5FF, red #FF2A5F.
"""
import json
import math
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "discord-emojis"
SIZE = 128
SCALE = 4
S = SIZE * SCALE

ORANGE = (255, 107, 0, 255)
CYAN = (0, 229, 255, 255)
RED = (255, 42, 95, 255)
GREEN = (16, 185, 129, 255)
AMBER = (245, 158, 11, 255)
SLATE = (148, 163, 184, 255)
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)


def font(size):
    for name in ("segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"):
        for folder in (os.environ.get("WINDIR", "C:/Windows") + "/Fonts", "/usr/share/fonts/truetype/dejavu"):
            path = Path(folder) / name
            if path.exists():
                return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def canvas():
    image = Image.new("RGBA", (S, S), CLEAR)
    return image, ImageDraw.Draw(image)


def finish(image):
    return image.resize((SIZE, SIZE), Image.LANCZOS)


def p(value):
    """Position in a 0..128 grid, scaled to the drawing size."""
    return value * SCALE


def circle_glyph(color, glyph, glyph_color=WHITE):
    image, draw = canvas()
    draw.ellipse([p(8), p(8), p(120), p(120)], fill=color)
    face = font(p(80))
    box = draw.textbbox((0, 0), glyph, font=face)
    width, height = box[2] - box[0], box[3] - box[1]
    draw.text(((S - width) / 2 - box[0], (S - height) / 2 - box[1]), glyph, font=face, fill=glyph_color)
    return finish(image)


def play():
    image, draw = canvas()
    draw.polygon([(p(34), p(18)), (p(34), p(110)), (p(110), p(64))], fill=ORANGE)
    return finish(image)


def pause():
    image, draw = canvas()
    draw.rounded_rectangle([p(28), p(20), p(54), p(108)], radius=p(6), fill=ORANGE)
    draw.rounded_rectangle([p(74), p(20), p(100), p(108)], radius=p(6), fill=ORANGE)
    return finish(image)


def stop():
    image, draw = canvas()
    draw.rounded_rectangle([p(24), p(24), p(104), p(104)], radius=p(12), fill=ORANGE)
    return finish(image)


def next_track():
    image, draw = canvas()
    draw.polygon([(p(22), p(22)), (p(22), p(106)), (p(86), p(64))], fill=ORANGE)
    draw.rounded_rectangle([p(88), p(22), p(106), p(106)], radius=p(5), fill=ORANGE)
    return finish(image)


def live():
    image, draw = canvas()
    draw.ellipse([p(8), p(8), p(120), p(120)], outline=(255, 42, 95, 110), width=p(10))
    draw.ellipse([p(34), p(34), p(94), p(94)], fill=RED)
    return finish(image)


def equalizer_frames(count=8):
    frames = []
    phases = [0.0, 1.6, 0.8, 2.4]
    colors = [ORANGE, ORANGE, RED, RED]
    for index in range(count):
        image, draw = canvas()
        for bar, (phase, color) in enumerate(zip(phases, colors)):
            level = 0.5 + 0.5 * math.sin(2 * math.pi * index / count + phase)
            height = 22 + level * 78
            left = 14 + bar * 27
            draw.rounded_rectangle([p(left), p(114 - height), p(left + 20), p(114)], radius=p(5), fill=color)
        frames.append(finish(image))
    return frames


def radio():
    image, draw = canvas()
    draw.line([p(40), p(40), p(92), p(12)], fill=CYAN, width=p(7))
    draw.rounded_rectangle([p(10), p(40), p(118), p(114)], radius=p(14), fill=CYAN)
    draw.ellipse([p(66), p(54), p(106), p(94)], fill=(10, 12, 18, 255))
    draw.ellipse([p(78), p(66), p(94), p(82)], fill=CYAN)
    for row in range(3):
        draw.rounded_rectangle([p(22), p(56 + row * 14), p(56), p(62 + row * 14)], radius=p(3), fill=(10, 12, 18, 255))
    return finish(image)


def listeners():
    image, draw = canvas()
    draw.arc([p(16), p(16), p(112), p(112)], start=180, end=360, fill=CYAN, width=p(11))
    draw.rounded_rectangle([p(12), p(62), p(40), p(112)], radius=p(10), fill=CYAN)
    draw.rounded_rectangle([p(88), p(62), p(116), p(112)], radius=p(10), fill=CYAN)
    return finish(image)


def quality():
    image, draw = canvas()
    for index, knob in enumerate((40, 84, 60)):
        y = 30 + index * 34
        draw.rounded_rectangle([p(14), p(y - 4), p(114), p(y + 4)], radius=p(4), fill=(0, 229, 255, 140))
        draw.ellipse([p(knob - 12), p(y - 12), p(knob + 12), p(y + 12)], fill=CYAN)
    return finish(image)


def save():
    image, draw = canvas()
    draw.polygon([(p(30), p(12)), (p(98), p(12)), (p(98), p(116)), (p(64), p(88)), (p(30), p(116))], fill=ORANGE)
    return finish(image)


def history():
    image, draw = canvas()
    draw.arc([p(14), p(14), p(114), p(114)], start=-60, end=250, fill=CYAN, width=p(11))
    draw.polygon([(p(6), p(46)), (p(34), p(46)), (p(20), p(70))], fill=CYAN)
    draw.line([p(64), p(64), p(64), p(36)], fill=CYAN, width=p(9))
    draw.line([p(64), p(64), p(84), p(76)], fill=CYAN, width=p(9))
    return finish(image)


def settings():
    image, draw = canvas()
    center, outer, inner = p(64), p(54), p(40)
    points = []
    for tooth in range(8):
        base = tooth * math.pi / 4
        for offset, radius in ((-0.28, inner), (-0.16, outer), (0.16, outer), (0.28, inner)):
            angle = base + offset
            points.append((center + radius * math.cos(angle), center + radius * math.sin(angle)))
    draw.polygon(points, fill=SLATE)
    draw.ellipse([center - p(38), center - p(38), center + p(38), center + p(38)], fill=SLATE)
    draw.ellipse([center - p(16), center - p(16), center + p(16), center + p(16)], fill=CLEAR)
    return finish(image)


def premium():
    image, draw = canvas()
    draw.polygon([(p(12), p(40)), (p(38), p(66)), (p(64), p(20)), (p(90), p(66)), (p(116), p(40)), (p(104), p(100)), (p(24), p(100))], fill=ORANGE)
    draw.rounded_rectangle([p(24), p(104), p(104), p(116)], radius=p(4), fill=ORANGE)
    for x, y in ((12, 40), (64, 20), (116, 40)):
        draw.ellipse([p(x - 8), p(y - 8), p(x + 8), p(y + 8)], fill=RED)
    return finish(image)


def dashboard():
    image, draw = canvas()
    draw.rounded_rectangle([p(8), p(16), p(120), p(96)], radius=p(10), fill=CYAN)
    draw.rounded_rectangle([p(16), p(24), p(112), p(88)], radius=p(6), fill=(10, 12, 18, 255))
    for index, height in enumerate((20, 38, 28, 48)):
        left = 26 + index * 22
        draw.rounded_rectangle([p(left), p(80 - height), p(left + 12), p(80)], radius=p(3), fill=CYAN)
    draw.rounded_rectangle([p(44), p(104), p(84), p(114)], radius=p(4), fill=CYAN)
    return finish(image)


def success():
    image, draw = canvas()
    draw.ellipse([p(8), p(8), p(120), p(120)], fill=GREEN)
    draw.line([p(36), p(66), p(56), p(86), p(94), p(44)], fill=WHITE, width=p(13), joint="curve")
    return finish(image)


def warning():
    image, draw = canvas()
    draw.polygon([(p(64), p(10)), (p(122), p(114)), (p(6), p(114))], fill=AMBER)
    draw.rounded_rectangle([p(57), p(42), p(71), p(84)], radius=p(6), fill=(10, 12, 18, 255))
    draw.ellipse([p(56), p(92), p(72), p(108)], fill=(10, 12, 18, 255))
    return finish(image)


def error():
    image, draw = canvas()
    draw.ellipse([p(8), p(8), p(120), p(120)], fill=RED)
    draw.line([p(42), p(42), p(86), p(86)], fill=WHITE, width=p(13))
    draw.line([p(86), p(42), p(42), p(86)], fill=WHITE, width=p(13))
    return finish(image)


def link():
    image, draw = canvas()
    layer, layer_draw = canvas()
    layer_draw.rounded_rectangle([p(10), p(44), p(72), p(84)], radius=p(20), outline=CYAN, width=p(11))
    layer_draw.rounded_rectangle([p(56), p(44), p(118), p(84)], radius=p(20), outline=CYAN, width=p(11))
    image.alpha_composite(layer.rotate(-40, resample=Image.BICUBIC, center=(S / 2, S / 2)))
    return finish(image)


STATIC = {
    "play": play,
    "pause": pause,
    "stop": stop,
    "next": next_track,
    "live": live,
    "radio": radio,
    "listeners": listeners,
    "quality": quality,
    "save": save,
    "history": history,
    "settings": settings,
    "premium": premium,
    "dashboard": dashboard,
    "help": lambda: circle_glyph(CYAN, "?", (10, 12, 18, 255)),
    "info": lambda: circle_glyph(CYAN, "i", (10, 12, 18, 255)),
    "success": success,
    "warning": warning,
    "error": error,
    "link": link,
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / "manifest.json"
    version = 1
    if manifest_path.exists():
        version = json.loads(manifest_path.read_text(encoding="utf-8")).get("version", 1)
    entries = []
    for name, draw in STATIC.items():
        draw().save(OUT / f"{name}.png", optimize=True)
        entries.append({"name": name, "file": f"{name}.png"})
    frames = equalizer_frames()
    frames[0].save(OUT / "equalizer.gif", save_all=True, append_images=frames[1:], duration=110, loop=0,
                   disposal=2, transparency=0, optimize=False)
    entries.append({"name": "equalizer", "file": "equalizer.gif", "animated": True})
    manifest = {"version": version, "prefix": "omnifm", "emojis": sorted(entries, key=lambda entry: entry["name"])}
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"{len(entries)} emojis written to {OUT.relative_to(ROOT)} (version {version})")


if __name__ == "__main__":
    main()
