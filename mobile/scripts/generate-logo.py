#!/usr/bin/env python3
"""
Generates every logo asset from one definition.

The mark is a WM monogram drawn as two chevrons — W is a chevron pointing down,
M is the same form inverted — in the app's single accent colour on its canvas
black. Keeping it to two stroked letterforms means it stays legible at 40px on a
home screen, which is the only size that really has to work.

Run: python3 scripts/generate-logo.py
"""
from PIL import Image, ImageDraw

VOID = (10, 10, 11)        # palette.void
LIVE = (214, 255, 63)      # palette.live
WHITE = (255, 255, 255)

SS = 4                      # supersample factor, downsampled at the end


def draw_mark(draw, cx, cy, height, colour, weight):
    """
    Draws "WM" centred on (cx, cy).

    Both letters are polylines rather than glyphs so the mark has no font
    dependency and renders identically everywhere.
    """
    h = height
    w = h * 0.86                      # width of a single letter
    gap = h * 0.17
    total = w * 2 + gap
    left = cx - total / 2
    top = cy - h / 2

    def poly(x0, pts):
        return [(x0 + px * w, top + py * h) for px, py in pts]

    # W: down, up, down, up.  M: the same shape inverted.
    W = [(0.0, 0.0), (0.26, 1.0), (0.5, 0.42), (0.74, 1.0), (1.0, 0.0)]
    M = [(0.0, 1.0), (0.26, 0.0), (0.5, 0.58), (0.74, 0.0), (1.0, 1.0)]

    for pts, x0 in ((W, left), (M, left + w + gap)):
        draw.line(poly(x0, pts), fill=colour, width=int(weight), joint='curve')
        # Round the ends; PIL's line caps are square.
        r = weight / 2
        for x, y in (poly(x0, pts)[0], poly(x0, pts)[-1]):
            draw.ellipse([x - r, y - r, x + r, y + r], fill=colour)


# "WM" is far wider than it is tall, so every size is expressed as the
# fraction of the canvas the mark should *span*. Sizing by height instead is
# how the first attempt ended up bleeding off the edges.
MARK_ASPECT = 1.89   # width of the letter *paths* as a multiple of letter height
STROKE = 0.19        # stroke weight as a multiple of letter height


# `width_frac` is the *inked* width — the ink you can see, round caps included
# — and not the width of the underlying paths. The two differ by one full
# stroke, because a stroke is centred on its path and so hangs half its weight
# off each end. Measuring the paths instead is what clipped the splash mark
# flat against both edges: at width_frac 0.92 the ink came to 101% of the
# canvas and the outer caps were sliced off. Solving for the letter height that
# puts the *ink* on the requested fraction means a caller asking for 0.86 gets
# 0.86, with the remainder left as margin.
def render(size, bg, fg, width_frac=0.66, alpha=False):
    px = size * SS
    img = Image.new('RGBA' if alpha else 'RGB', (px, px), (0, 0, 0, 0) if alpha else bg)
    d = ImageDraw.Draw(img)
    if alpha and bg is not None:
        d.rectangle([0, 0, px, px], fill=bg)
    h = px * width_frac / (MARK_ASPECT + STROKE)
    draw_mark(d, px / 2, px / 2, h, fg, max(2, h * STROKE))
    return img.resize((size, size), Image.LANCZOS)


def save(img, path, keep_alpha):
    if not keep_alpha and img.mode == 'RGBA':
        flat = Image.new('RGB', img.size, VOID)
        flat.paste(img, mask=img.split()[3])
        img = flat
    img.save(path)
    print(f'  {path}  {img.size[0]}x{img.size[1]}  {img.mode}')


print('writing logo assets:')

# iOS app icon. The App Store rejects any alpha channel, so this is flat RGB.
# iOS rounds the corners into a squircle, so the mark keeps a clear margin.
save(render(1024, VOID, LIVE, width_frac=0.68), 'assets/icon.png', keep_alpha=False)

# Android adaptive icon. The launcher masks to roughly the middle 66%, so the
# mark is drawn smaller to survive an aggressive circular crop.
# Launchers mask this to roughly the middle 66% and may crop to a circle, so
# the mark sits well inside that to survive the most aggressive shape.
save(render(1024, None, LIVE, width_frac=0.57, alpha=True),
     'assets/android-icon-foreground.png', keep_alpha=True)
save(render(1024, VOID, VOID, width_frac=0.0), 'assets/android-icon-background.png', keep_alpha=False)

# Themed icons are tinted by the system, so the shape must be a white silhouette.
save(render(1024, None, WHITE, width_frac=0.57, alpha=True),
     'assets/android-icon-monochrome.png', keep_alpha=True)

# Splash: the mark alone on transparency, over the splash background colour.
# expo-splash-screen places this square at a fixed width, so the mark nearly
# fills its canvas — but not to the edge, or the round caps clip flat.
save(render(512, None, LIVE, width_frac=0.86, alpha=True),
     'assets/splash-icon.png', keep_alpha=True)

save(render(64, VOID, LIVE, width_frac=0.75), 'assets/favicon.png', keep_alpha=False)
print('done')
