#!/usr/bin/env python3
"""
Generate Cortex Agent dock icon aligned with Grok / xAI visual identity.
Dark background, bold white X-cortex mark, electric cyan neural nodes.
"""

import cairosvg
import os
import subprocess

ICONS_DIR = os.path.join(os.path.dirname(__file__), "../src-tauri/icons")

SVG = """<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024"
     xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Background: near-black with deep navy centre -->
    <radialGradient id="bg" cx="50%" cy="48%" r="65%">
      <stop offset="0%"   stop-color="#111122"/>
      <stop offset="100%" stop-color="#03030A"/>
    </radialGradient>

    <!-- Central soft glow behind X -->
    <radialGradient id="xGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="#00CFFF" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#00CFFF" stop-opacity="0"/>
    </radialGradient>

    <!-- X arm glow filter (soft light bloom) -->
    <filter id="xBloom" x="-25%" y="-25%" width="150%" height="150%">
      <feGaussianBlur stdDeviation="11" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <!-- Node glow -->
    <filter id="nodeGlow" x="-120%" y="-120%" width="340%" height="340%">
      <feGaussianBlur stdDeviation="14" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <!-- Rim inner-shadow glow -->
    <filter id="rimGlow" x="-4%" y="-4%" width="108%" height="108%">
      <feGaussianBlur stdDeviation="16" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <clipPath id="roundedRect">
      <rect width="1024" height="1024" rx="224" ry="224"/>
    </clipPath>
  </defs>

  <g clip-path="url(#roundedRect)">

    <!-- ── Background ── -->
    <rect width="1024" height="1024" fill="url(#bg)"/>

    <!-- Very faint grid (Grok-style depth texture) -->
    <g stroke="#151530" stroke-width="1" opacity="0.7">
      <line x1="0"   y1="256"  x2="1024" y2="256"/>
      <line x1="0"   y1="512"  x2="1024" y2="512"/>
      <line x1="0"   y1="768"  x2="1024" y2="768"/>
      <line x1="256" y1="0"    x2="256"  y2="1024"/>
      <line x1="512" y1="0"    x2="512"  y2="1024"/>
      <line x1="768" y1="0"    x2="768"  y2="1024"/>
    </g>

    <!-- Centre glow halo -->
    <ellipse cx="512" cy="512" rx="360" ry="360" fill="url(#xGlow)"/>

    <!-- ── Thin orbital ring ── -->
    <!-- Cyan ring centred at 512,512 r=310 -->
    <circle cx="512" cy="512" r="302"
            fill="none" stroke="#00CFFF" stroke-width="2.5" opacity="0.35"/>

    <!-- ── X  shape — two diamond-arm polygons ──
         Arm half-width = 80px (perpendicular).
         Tips at 330 / sqrt(2) ≈ 233 px along each axis from centre.
         Tips: NW=(279,279) SE=(745,745) NE=(745,279) SW=(279,745)
         Wide-points at centre (offset = 80/sqrt2 ≈ 56.6):
           right-of-\ : (568.6, 455.4)   left-of-\ : (455.4, 568.6)
           right-of-/ : (568.6, 568.6)   left-of-/ : (455.4, 455.4)       -->

    <!-- Shadow/glow layer — slightly larger, blurred cyan -->
    <g opacity="0.30" filter="url(#xBloom)">
      <polygon points="279,279  576,448  745,745  448,576"
               fill="#00CFFF"/>
      <polygon points="745,279  576,576  279,745  448,448"
               fill="#00CFFF"/>
    </g>

    <!-- Main white X -->
    <g filter="url(#xBloom)" opacity="0.98">
      <!-- backslash arm: NW tip → centre-right → SE tip → centre-left -->
      <polygon points="279,279  568.6,455.4  745,745  455.4,568.6"
               fill="white"/>
      <!-- forward-slash arm: NE tip → centre-bottom → SW tip → centre-top -->
      <polygon points="745,279  568.6,568.6  279,745  455.4,455.4"
               fill="white"/>
    </g>

    <!-- ── Nodes at the four X arm tips ── -->
    <!-- NW -->
    <g filter="url(#nodeGlow)">
      <circle cx="279" cy="279" r="38" fill="#00CFFF" opacity="0.9"/>
      <circle cx="279" cy="279" r="21" fill="white"/>
    </g>
    <!-- NE -->
    <g filter="url(#nodeGlow)">
      <circle cx="745" cy="279" r="38" fill="#00CFFF" opacity="0.9"/>
      <circle cx="745" cy="279" r="21" fill="white"/>
    </g>
    <!-- SE -->
    <g filter="url(#nodeGlow)">
      <circle cx="745" cy="745" r="38" fill="#00CFFF" opacity="0.9"/>
      <circle cx="745" cy="745" r="21" fill="white"/>
    </g>
    <!-- SW -->
    <g filter="url(#nodeGlow)">
      <circle cx="279" cy="745" r="38" fill="#00CFFF" opacity="0.9"/>
      <circle cx="279" cy="745" r="21" fill="white"/>
    </g>

    <!-- Small ring-intercept dots where X arms cross the orbital ring -->
    <!-- Positions: ring r=302, at 45° angles from centre -->
    <!-- 302/sqrt(2) ≈ 213.6 → (512±213.6, 512±213.6) → (298,298),(726,298),(726,726),(298,726) -->
    <g fill="#00CFFF" opacity="0.55">
      <circle cx="298" cy="298" r="7"/>
      <circle cx="726" cy="298" r="7"/>
      <circle cx="726" cy="726" r="7"/>
      <circle cx="298" cy="726" r="7"/>
    </g>

    <!-- ── Inner-border rim glow ── -->
    <rect x="30" y="30" width="964" height="964" rx="206" ry="206"
          fill="none" stroke="#1E1E50" stroke-width="2.5"
          opacity="0.8" filter="url(#rimGlow)"/>

  </g>
</svg>
"""

def main():
    svg_path = os.path.join(ICONS_DIR, "icon_source.svg")
    with open(svg_path, "w") as f:
        f.write(SVG)
    print(f"SVG written → {svg_path}")

    sizes = [16, 32, 64, 128, 256, 512, 1024]
    for s in sizes:
        out = os.path.join(ICONS_DIR, f"{s}x{s}.png" if s != 1024 else "1024x1024.png")
        # icon.png is also 1024
        cairosvg.svg2png(url=svg_path, write_to=out, output_width=s, output_height=s)
        print(f"  {s}x{s} → {out}")

    # icon.png = 1024
    import shutil
    shutil.copy(os.path.join(ICONS_DIR, "1024x1024.png"),
                os.path.join(ICONS_DIR, "icon.png"))
    print("  icon.png ← 1024x1024.png")

    # Build .icns from the PNGs using sips + iconutil
    iconset_dir = os.path.join(ICONS_DIR, "AppIcon.iconset")
    os.makedirs(iconset_dir, exist_ok=True)

    iconset_map = {
        "icon_16x16.png":       (16,  "16x16.png"),
        "icon_16x16@2x.png":    (32,  "32x32.png"),
        "icon_32x32.png":       (32,  "32x32.png"),
        "icon_32x32@2x.png":    (64,  "64x64.png"),
        "icon_128x128.png":     (128, "128x128.png"),
        "icon_128x128@2x.png":  (256, "256x256.png"),
        "icon_256x256.png":     (256, "256x256.png"),
        "icon_256x256@2x.png":  (512, "512x512.png"),
        "icon_512x512.png":     (512, "512x512.png"),
        "icon_512x512@2x.png":  (1024,"1024x1024.png"),
    }
    for dest_name, (_, src_name) in iconset_map.items():
        src = os.path.join(ICONS_DIR, src_name)
        dst = os.path.join(iconset_dir, dest_name)
        shutil.copy(src, dst)

    icns_out = os.path.join(ICONS_DIR, "icon.icns")
    result = subprocess.run(
        ["iconutil", "-c", "icns", iconset_dir, "-o", icns_out],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        print(f"  icon.icns generated → {icns_out}")
    else:
        print(f"  iconutil error: {result.stderr}")

    # Clean up iconset dir
    shutil.rmtree(iconset_dir)
    print("Done.")

if __name__ == "__main__":
    main()
