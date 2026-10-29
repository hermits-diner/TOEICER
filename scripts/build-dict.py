"""Builds public/dict/en-ko.json, the offline English-Korean dictionary.

Source: English entries of the Korean Wiktionary (ko.wiktionary.org), as extracted by
wiktextract and published at https://kaikki.org/dictionary/rawdata.html (ko-extract.jsonl.gz).
Wiktionary content is licensed CC BY-SA 4.0; the generated file is shared under the same licence.

Usage: python scripts/build-dict.py path/to/ko-extract.jsonl.gz
Output format: {"word": [[pos, ipa, [gloss, ...], example], ...], ...}  (ipa/example may be "")
"""

import gzip
import json
import re
import sys
from pathlib import Path

POS_KO = {
    "noun": "명사", "verb": "동사", "adj": "형용사", "adv": "부사", "prep": "전치사", "pron": "대명사",
    "conj": "접속사", "intj": "감탄사", "num": "수사", "phrase": "구", "prefix": "접두사", "suffix": "접미사",
    "proverb": "속담", "name": "고유명사", "det": "한정사", "article": "관사",
}
MAX_SENSES = 6
MAX_GLOSS = 160


def clean(g: str) -> str:
    g = re.sub(r"^\s*\d+\.\s*:?\s*", "", g)  # "1. : ..." numbering
    g = g.replace("㉶", "").strip()
    g = re.sub(r"\s+", " ", g)
    return g if len(g) <= MAX_GLOSS else g[: MAX_GLOSS - 1].rstrip() + "…"


def main(src: str) -> None:
    out: dict[str, list] = {}
    with gzip.open(src, "rt", encoding="utf-8") as f:
        for line in f:
            d = json.loads(line)
            if d.get("lang_code") != "en":
                continue
            word = d["word"].strip()
            if not word or len(word) > 40:
                continue
            glosses, example = [], ""
            for s in d.get("senses", []):
                for g in s.get("glosses", []):
                    g = clean(g)
                    if g and g not in glosses:
                        glosses.append(g)
                if not example:
                    ex = next((e.get("text", "") for e in s.get("examples", []) if e.get("text")), "")
                    example = ex[:200]
            if not glosses:
                continue
            ipa = next((x["ipa"].strip("/ ") for x in d.get("sounds", []) if x.get("ipa")), "")
            pos = POS_KO.get(d.get("pos", ""), "")
            out.setdefault(word.lower(), []).append([pos, ipa, glosses[:MAX_SENSES], example])

    dest = Path(__file__).resolve().parent.parent / "public" / "dict" / "en-ko.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(out)} headwords -> {dest} ({dest.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main(sys.argv[1])
