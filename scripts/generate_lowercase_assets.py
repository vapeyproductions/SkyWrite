"""Generate SkyWrite's lowercase manuscript stroke data and dotted PNGs.

The lowercase filenames use a ``lower_`` prefix so they can safely coexist with
uppercase assets on case-insensitive filesystems.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

Point = tuple[float, float]
ROOT = Path(__file__).resolve().parents[1]
JSON_DIR = ROOT / "public" / "strokes_jsons"
PNG_DIR = ROOT / "public" / "dotted_pngs"


def line(*anchors: Point, spacing: float = 0.04) -> list[Point]:
    points: list[Point] = []
    for start, end in zip(anchors, anchors[1:]):
        distance = math.dist(start, end)
        count = max(1, math.ceil(distance / spacing))
        segment = [
            (
                start[0] + (end[0] - start[0]) * step / count,
                start[1] + (end[1] - start[1]) * step / count,
            )
            for step in range(count + 1)
        ]
        points.extend(segment if not points else segment[1:])
    return points


def cubic(start: Point, control_a: Point, control_b: Point, end: Point, steps: int = 12) -> list[Point]:
    points: list[Point] = []
    for step in range(steps + 1):
        amount = step / steps
        inverse = 1 - amount
        x = inverse**3 * start[0] + 3 * inverse**2 * amount * control_a[0] + 3 * inverse * amount**2 * control_b[0] + amount**3 * end[0]
        y = inverse**3 * start[1] + 3 * inverse**2 * amount * control_a[1] + 3 * inverse * amount**2 * control_b[1] + amount**3 * end[1]
        points.append((x, y))
    return points


def join(*paths: list[Point]) -> list[Point]:
    result: list[Point] = []
    for path in paths:
        result.extend(path if not result or result[-1] != path[0] else path[1:])
    return result


def oval(center_x: float = 0.50, center_y: float = 0.57, radius_x: float = 0.14, radius_y: float = 0.19) -> list[Point]:
    # Begin near two o'clock and travel counter-clockwise, as taught for print handwriting.
    return [
        (
            center_x + radius_x * math.cos(math.radians(-45 - 360 * step / 24)),
            center_y + radius_y * math.sin(math.radians(-45 - 360 * step / 24)),
        )
        for step in range(25)
    ]


LOWERCASE: dict[str, list[tuple[str, list[Point]]]] = {
    "a": [("round", oval()), ("down stroke", line((0.60, 0.43), (0.64, 0.48), (0.64, 0.75)))],
    "b": [
        ("tall down stroke", line((0.38, 0.18), (0.38, 0.75))),
        ("lower bump", join(cubic((0.38, 0.40), (0.53, 0.36), (0.65, 0.44), (0.65, 0.57)), cubic((0.65, 0.57), (0.65, 0.70), (0.52, 0.77), (0.38, 0.72)))),
    ],
    "c": [("curve", join(cubic((0.64, 0.43), (0.57, 0.35), (0.39, 0.37), (0.36, 0.55)), cubic((0.36, 0.55), (0.34, 0.68), (0.47, 0.78), (0.64, 0.69))))],
    "d": [("round", oval()), ("tall down stroke", line((0.64, 0.18), (0.64, 0.75)))],
    "e": [("across and around", join(line((0.37, 0.57), (0.64, 0.57)), cubic((0.64, 0.57), (0.63, 0.43), (0.55, 0.37), (0.46, 0.39)), cubic((0.46, 0.39), (0.35, 0.42), (0.33, 0.58), (0.39, 0.68)), cubic((0.39, 0.68), (0.45, 0.78), (0.58, 0.77), (0.65, 0.69))))],
    "f": [
        ("curved down stroke", join(cubic((0.59, 0.23), (0.54, 0.15), (0.43, 0.18), (0.43, 0.34)), line((0.43, 0.34), (0.43, 0.82)))),
        ("cross", line((0.31, 0.44), (0.61, 0.44))),
    ],
    "g": [
        ("round", oval(center_y=0.56, radius_y=0.18)),
        ("down and hook", join(line((0.60, 0.43), (0.64, 0.48), (0.64, 0.78)), cubic((0.64, 0.78), (0.64, 0.90), (0.48, 0.94), (0.40, 0.84)))),
    ],
    "h": [
        ("tall down stroke", line((0.38, 0.18), (0.38, 0.75))),
        ("hump", join(cubic((0.38, 0.50), (0.44, 0.37), (0.63, 0.39), (0.63, 0.57)), line((0.63, 0.57), (0.63, 0.75)))),
    ],
    "i": [("short down stroke", line((0.50, 0.40), (0.50, 0.75))), ("dot", line((0.50, 0.25), (0.50, 0.30)))],
    "j": [
        ("down and hook", join(line((0.56, 0.40), (0.56, 0.78)), cubic((0.56, 0.78), (0.56, 0.90), (0.41, 0.93), (0.36, 0.83)))),
        ("dot", line((0.56, 0.25), (0.56, 0.30))),
    ],
    "k": [("tall down stroke", line((0.39, 0.18), (0.39, 0.75))), ("in and out", line((0.64, 0.40), (0.39, 0.58), (0.65, 0.75)))],
    "l": [("tall down stroke", join(line((0.46, 0.18), (0.46, 0.69)), cubic((0.46, 0.69), (0.47, 0.76), (0.53, 0.78), (0.59, 0.73))))],
    "m": [
        ("short down stroke", line((0.31, 0.40), (0.31, 0.75))),
        ("first hump", join(cubic((0.31, 0.51), (0.38, 0.36), (0.51, 0.39), (0.51, 0.56)), line((0.51, 0.56), (0.51, 0.75)))),
        ("second hump", join(cubic((0.51, 0.51), (0.58, 0.36), (0.71, 0.39), (0.71, 0.56)), line((0.71, 0.56), (0.71, 0.75)))),
    ],
    "n": [
        ("short down stroke", line((0.37, 0.40), (0.37, 0.75))),
        ("hump", join(cubic((0.37, 0.51), (0.44, 0.36), (0.64, 0.39), (0.64, 0.57)), line((0.64, 0.57), (0.64, 0.75)))),
    ],
    "o": [("round", oval())],
    "p": [
        ("long down stroke", line((0.39, 0.40), (0.39, 0.90))),
        ("upper bump", join(cubic((0.39, 0.40), (0.54, 0.36), (0.67, 0.43), (0.67, 0.55)), cubic((0.67, 0.55), (0.67, 0.66), (0.53, 0.70), (0.39, 0.65)))),
    ],
    "q": [
        ("round", oval()),
        ("down and tail", join(line((0.60, 0.43), (0.64, 0.48), (0.64, 0.87)), cubic((0.64, 0.87), (0.67, 0.87), (0.70, 0.85), (0.73, 0.82)))),
    ],
    "r": [("short down stroke", line((0.40, 0.40), (0.40, 0.75))), ("shoulder", cubic((0.40, 0.55), (0.43, 0.38), (0.58, 0.37), (0.64, 0.49)))],
    "s": [("curve", join(cubic((0.63, 0.43), (0.56, 0.35), (0.39, 0.38), (0.38, 0.50)), cubic((0.38, 0.50), (0.38, 0.59), (0.59, 0.58), (0.62, 0.66)), cubic((0.62, 0.66), (0.66, 0.76), (0.46, 0.80), (0.36, 0.70))))],
    "t": [
        ("down stroke", join(line((0.49, 0.25), (0.49, 0.66)), cubic((0.49, 0.66), (0.49, 0.76), (0.56, 0.78), (0.63, 0.72)))),
        ("cross", line((0.34, 0.44), (0.62, 0.44))),
    ],
    "u": [("down around and up", join(line((0.37, 0.40), (0.37, 0.63)), cubic((0.37, 0.63), (0.37, 0.80), (0.62, 0.80), (0.62, 0.63)), line((0.62, 0.63), (0.62, 0.40), (0.62, 0.75))))],
    "v": [("down and up", line((0.35, 0.40), (0.50, 0.75), (0.65, 0.40)))],
    "w": [("down up down up", line((0.28, 0.40), (0.39, 0.75), (0.50, 0.48), (0.61, 0.75), (0.72, 0.40)))],
    "x": [("first diagonal", line((0.36, 0.40), (0.64, 0.75))), ("second diagonal", line((0.64, 0.40), (0.36, 0.75)))],
    "y": [
        ("first slant", line((0.35, 0.40), (0.50, 0.72))),
        ("down and hook", join(line((0.66, 0.40), (0.50, 0.72), (0.50, 0.80)), cubic((0.50, 0.80), (0.50, 0.90), (0.40, 0.93), (0.35, 0.85)))),
    ],
    "z": [("across down across", line((0.35, 0.40), (0.65, 0.40), (0.35, 0.75), (0.66, 0.75)))],
}


def render_png(strokes: list[tuple[str, list[Point]]], destination: Path) -> None:
    image = Image.new("RGBA", (960, 720), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    radius = 10
    for _, points in strokes:
        for x, y in points:
            pixel_x, pixel_y = round(x * image.width), round(y * image.height)
            draw.ellipse((pixel_x - radius, pixel_y - radius, pixel_x + radius, pixel_y + radius), fill=(0, 0, 0, 255))
    image.save(destination, "PNG", optimize=True)


def main() -> None:
    JSON_DIR.mkdir(parents=True, exist_ok=True)
    PNG_DIR.mkdir(parents=True, exist_ok=True)
    for letter, strokes in LOWERCASE.items():
        asset_name = f"lower_{letter}_dotted"
        payload = {
            "image": f"dotted_pngs/{asset_name}.png",
            "strokes": [
                {
                    "name": name,
                    "points": [[round(x, 4), round(y, 4)] for x, y in points],
                }
                for name, points in strokes
            ],
        }
        (JSON_DIR / f"{asset_name}.strokes.json").write_text(json.dumps(payload, indent=2) + "\n")
        render_png(strokes, PNG_DIR / f"{asset_name}.png")
    print(f"Generated {len(LOWERCASE)} lowercase JSON files and {len(LOWERCASE)} dotted PNGs.")


if __name__ == "__main__":
    main()
