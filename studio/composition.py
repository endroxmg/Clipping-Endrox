"""Source crops and output positions, expressed as fractions of their respective frames."""
import math
import statistics
from pathlib import Path

DEFAULT = {
    "face_crop": [0.015, 0.33, 0.27, 0.31],
    "game_crop": [0.285, 0.0, 0.715, 1.0],
    "face": [0.13, 0.035, 0.74, 0.30],
    "game": [0.0, 0.36, 1.0, 0.43],
    "caption": [0.075, 0.82, 0.85, 0.115],
    "size": 1.0, "shift": 0.0,
}


def clean(value):
    if not isinstance(value, dict):
        raise ValueError("Invalid layer settings.")
    out = {}
    for key, default in DEFAULT.items():
        v = value.get(key, default)
        if isinstance(default, list):
            if not isinstance(v, list) or len(v) != 4:
                raise ValueError("A layer needs a position and size.")
            x, y, w, h = map(float, v)
            if not all(math.isfinite(n) for n in (x,y,w,h)) or min(x,y) < 0 or min(w,h) < .025 or max(x+w,y+h) > 1.0001:
                raise ValueError("Keep each layer inside the frame.")
            out[key] = [x,y,w,h]
        else:
            v = float(v)
            lo, hi = (.45, 1.8) if key == "size" else (-2, 2)
            if not lo <= v <= hi:
                raise ValueError("Caption size or timing is outside the allowed range.")
            out[key] = v
    return out


def gameplay_crop(face):
    x,y,w,h = face
    # Choose the largest unobstructed rectangle which retains the action near centre.
    options = [[x+w,0,1-x-w,1], [0,0,x,1], [0,y+h,1,1-y-h], [0,0,1,y]]
    fits = [b for b in options if b[2] >= .25 and b[3] >= .25 and b[0] <= .55 <= b[0]+b[2] and b[1] <= .52 <= b[1]+b[3]]
    return max(fits or options, key=lambda b:b[2]*b[3])


def detect(path: Path, start, end):
    """Use repeated face detections near the same position to suggest a static inset."""
    import cv2
    cv2.setNumThreads(1)
    models = [cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_" + n + ".xml")
              for n in ("frontalface_default", "profileface")]
    video = cv2.VideoCapture(str(path))
    groups = []
    try:
        for frame in (0.08,.30,.52,.74,.92):
            video.set(cv2.CAP_PROP_POS_MSEC, 1000 * (start + (end-start)*frame))
            ok, img = video.read()
            if not ok: continue
            h,w = img.shape[:2]
            gray = cv2.resize(cv2.cvtColor(img,cv2.COLOR_BGR2GRAY),(800,max(1,round(800*h/w))))
            gh,gw=gray.shape
            seen=set()
            for model, flipped in ((models[0],False),(models[1],False),(models[1],True)):
                for x,y,bh,bv in model.detectMultiScale(cv2.flip(gray,1) if flipped else gray,1.09,4,minSize=(17,17)):
                    cx=(gw-x-bh/2 if flipped else x+bh/2)/gw
                    cy=(y+bv/2)/gh
                    if .32 < cx < .68 and .23 < cy < .77: continue
                    i=next((i for i,g in enumerate(groups) if abs(g[0][0]-cx)<.065 and abs(g[0][1]-cy)<.10),len(groups))
                    if i in seen: continue
                    seen.add(i)
                    if i==len(groups): groups.append([])
                    groups[i].append((cx,cy,bh/gw,bv/gh))
    finally:
        video.release()
    group=max(groups,key=len,default=[])
    settings=clean({})
    if len(group)<2:
        return settings, False
    cx,cy,w,h=map(statistics.median,zip(*group))
    width=min(.44,max(.15,w*2.6))
    height=min(.50,max(.18,h*1.85))
    crop=[max(0,min(1-width,cx-width*.50)),max(0,min(1-height,cy-height*.48)),width,height]
    settings.update(face_crop=crop,game_crop=gameplay_crop(crop))
    return settings, True


def filtergraph(settings, width, height, fps):
    s=clean(settings)
    def panel(key):
        x,y,w,h=s[key+"_crop"]
        ox,oy,ow,oh=s[key]
        dw,dh=max(2,int(ow*width/2)*2),max(2,int(oh*height/2)*2)
        # Contain gameplay so edges of the selected action stay visible. Fill the webcam panel.
        fit=(f"scale={dw}:{dh}:force_original_aspect_ratio=increase,crop={dw}:{dh}" if key=="face" else
             f"scale={dw}:{dh}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad={dw}:{dh}:(ow-iw)/2:(oh-ih)/2:color=0x100d16")
        return f"[{key}src]crop=iw*{w}:ih*{h}:iw*{x}:ih*{y},{fit},setsar=1[{key}];"
    def place(layer):
        x,y,*_=s[layer]
        return f"overlay={int(x*width/2)*2}:{int(y*height/2)*2}:shortest=1"
    return (f"[0:v]fps={fps},split=2[facesrc][gamesrc];"+panel("game")+panel("face")+
            f"color=c=0x100d16:s={width}x{height}:r={fps}[base];[base][game]{place('game')}[back];[back][face]{place('face')}[v0];")
