"""Local highlight selection. Scores are editorial heuristics, not engagement estimates."""
import re

FOCUS = {
    "balanced": "Prefer a self-contained exchange with a clear setup and resolution.",
    "gameplay": "Prefer an encounter with a callout and a resulting reaction. Skip lobby and settings chatter.",
    "insight": "Prefer a specific question or problem followed by a useful explanation or answer.",
    "story": "Prefer a sequence with an initial situation, a change, and a resolved ending.",
}
CUES = {
    "gameplay": r"\b(?:knock\w*|revive\w*|clutch|enemy|squad|headshot|grenade|push|last one|maar diya|knock kiya|bach gaya)\b|नॉक|रिवाइव|दुश्मन|मार दिया|बच गया|ग्रेनेड",
    "insight": r"\b(?:because|reason|instead|trick|tip|actually|means|kyunki|isliye)\b|क्योंकि|इसलिए|मतलब",
    "story": r"\b(?:suddenly|until|finally|realized|turns out|ended up|phir|achanak)\b|अचानक|फिर|आखिर",
}
PATTERNS = {k: re.compile(v, re.I) for k, v in CUES.items()}
PROMO = re.compile(r"subscribe|sponsored by|promo code|like and share|सब्सक्राइब", re.I)
LOBBY = re.compile(r"thumbnail|resolution settings|start the stream|थंबनेल|स्ट्रीम स्टार्ट", re.I)


def diverse(candidates, limit, existing=()):
    chosen = list(existing)
    result = []
    for c in sorted(candidates, key=lambda item: -item["score"]):
        if len(result) >= limit:
            break
        tokens = set(c.get("excerpt", "").casefold().split())
        for old in chosen:
            overlap = min(c["end"], old["end"]) - max(c["start"], old["start"])
            if overlap > .18 * min(c["end"] - c["start"], old["end"] - old["start"]):
                break
            previous = set(old.get("excerpt", "").casefold().split())
            if len(tokens) >= 5 and len(tokens & previous) > .72 * len(tokens | previous):
                break
        else:
            result.append(c)
            chosen.append(c)
    return result


def local_candidates(lines, min_len, max_len, duration, focus, n):
    """Compare sentence sequences. Long pauses, filler and repeated speech cost points."""
    candidates = []
    target = min(max_len, max(min_len, 28))
    for i, first in enumerate(lines):
        parts = []
        speech = 0
        for j in range(i, len(lines)):
            line = lines[j]
            length = line["e"] - first["s"]
            if length > max_len or (j > i and line["s"] - lines[j-1]["e"] > 3.5):
                break
            parts.append(line["text"])
            speech += line["e"] - line["s"]
            if length < min(min_len, duration) - .5:
                continue
            body = " ".join(parts)
            tokens = body.casefold().split()
            if len(tokens) < 6 or PROMO.search(body):
                continue
            matches = {k: len(set(p.findall(body.casefold()))) for k, p in PATTERNS.items()}
            cues = min(3, sum(matches.values()) if focus == "balanced" else matches[focus])
            closure = parts[-1].rstrip().endswith((".", "!", "?", "।", "؟"))
            question = "?" in parts[0] and len(parts) > 1
            score = (32 + 10 * min(1, speech / length) + 12 * len(set(tokens)) / len(tokens)
                     + 6 * any(l.get("motion") for l in lines[i:j+1]) + 8 * cues + 6 * question + 6 * closure + 4 * any(l["loud"] for l in lines[i:j+1])
                     - 9 * abs(length - target) / target - 20 * bool(focus == "gameplay" and LOBBY.search(body)))
            excerpt = " ".join(parts)
            useful = [part for part in parts if len(part.split()) >= 5 and any(p.search(part) for p in PATTERNS.values())]
            title = " ".join(max(useful, key=len).split()[:12]) if useful else ""
            if not title:
                label = {"gameplay":"Gameplay", "insight":"Discussion", "story":"Story"}.get(focus, "Highlight")
                title = f"{label} at {int(first['s']) // 60}:{int(first['s']) % 60:02d}"
            candidates.append(dict(start=first["s"], end=line["e"], score=min(94, round(score)),
                                   title=title, hook="", reason="Ranked locally using speech continuity, pauses and topic cues.",
                                   excerpt=excerpt[:220], category="other"))
    return diverse(candidates, n)


def action_candidates(motion, loud, n, duration, min_len, max_len):
    """Build reviewable ranges around visible activity when no speech was detected."""
    import numpy as np
    if motion is None or len(motion) < 3 or duration < min_len:
        return []
    activity = np.maximum(motion, 0)
    common = min(len(activity), len(loud))
    activity[:common] += .45 * np.clip(loud[:common], 0, 3)
    picks = []
    for peak in np.argsort(-activity):
        if motion[peak] < 1.2:
            continue
        length = min(duration, max_len, max(min_len, 18))
        start = min(max(0, peak - .65 * length), duration - length)
        end = start + length
        if any(start < c["end"] and c["start"] < end for c in picks):
            continue
        picks.append(dict(start=round(start, 2), end=round(end, 2), score=min(80, round(48+6*activity[peak])),
                          category="other", hook="", title=f"Gameplay activity at {int(peak)//60}:{int(peak)%60:02d}",
                          hashtags=[], highlight_words=[], description="", reason="Frame changes peaked here. Review the action and its outcome."))
        if len(picks) >= n:
            break
    return picks
