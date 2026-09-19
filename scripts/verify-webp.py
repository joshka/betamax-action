"""Decode native WebP independently and check colors, animation and final hold."""

import json
import sys
from pathlib import Path

from PIL import Image

filename = Path(sys.argv[1])
durations = json.loads(sys.argv[2])
with Image.open(filename) as image:
    assert image.size == (780, 350), image.size
    assert image.n_frames == len(durations)
    frames = []
    for index in range(image.n_frames):
        image.seek(index)
        frames.append(image.convert("RGBA"))

assert len({frame.tobytes() for frame in frames}) >= 3, "Animation is frozen"
final = frames[-1]
colors = {pixel for pixel in final.getdata() if pixel[3] == 255}
assert len(colors) > 256, f"WebP appears palette-reduced: {len(colors)} colors"
hold = 0
for frame, duration in zip(reversed(frames), reversed(durations)):
    if frame.tobytes() != final.tobytes():
        break
    hold += duration
assert hold >= 400, f"Final frame hold lost: {hold}ms"

# The PNG preview is the final capture. Compare opaque pixels to avoid irrelevant RGB values
# beneath transparent window corners. WebP-only jobs still verify decoded colors and timing.
manifest = json.loads((filename.parent / "manifest.json").read_text())
label = next(item["label"] for item in manifest["media"] if item["name"] == filename.name)
for item in manifest["media"]:
    if item["label"] == label.removesuffix("(webp)") + "(png)":
        with Image.open(filename.parent / item["name"]) as png:
            expected = png.convert("RGBA")
            assert expected.size == final.size
            assert all(
                actual == reference
                for actual, reference in zip(final.getdata(), expected.getdata())
                if reference[3] == 255
            ), "Native WebP colors differ from the final PNG capture"
print(f"Decoded {filename.name}: {len(frames)} frames, {len(colors)} colors, final hold {hold}ms")
