"""TTS text sanitizer — strips markdown, URLs, emoji, comments for clean speech.

Also expands numbers/units into speakable words (expand_spoken_forms):
Sarvam bulbul mangles bare numerals ("234" read digit-by-digit, "26°C"
garbled), so text is rewritten before the TTS call. Stdlib `re` only.
"""

import re


def sanitize_for_tts(text: str, max_chars: int = 600) -> str:
    """
    Sanitize text for TTS playback.
    
    - Strips markdown (#, *, _, `, ~, >, -, //)
    - Removes URLs
    - Removes emoji blocks
    - Removes "//" comment lines and inline //
    - Collapses whitespace, keeps sentence punctuation
    - Truncates at max_chars on sentence boundary (finds last .!? before limit)
    """
    if not text:
        return ""
    
    original_len = len(text)
    
    # Remove URLs
    text = re.sub(r'https?://\S+', '', text)
    
    # Remove markdown headers
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
    
    # Remove markdown emphasis (*, _, **, __, ***, ___)
    text = re.sub(r'(\*\*|__)(.*?)\1', r'\2', text)
    text = re.sub(r'(\*|_)(.*?)\1', r'\2', text)
    
    # Remove markdown code (`, ```)
    text = re.sub(r'`{1,3}(.*?)`{1,3}', r'\1', text, flags=re.DOTALL)
    
    # Remove markdown strikethrough (~~)
    text = re.sub(r'~~(.*?)~~', r'\1', text)
    
    # Remove markdown blockquotes (>)
    text = re.sub(r'^>\s*', '', text, flags=re.MULTILINE)
    
    # Remove markdown horizontal rules (---, ***, ___)
    text = re.sub(r'^[-*_]{3,}\s*$', '', text, flags=re.MULTILINE)
    
    # Remove markdown links [text](url) -> keep text
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    
    # Remove markdown images ![alt](url)
    text = re.sub(r'!\[([^\]]*)\]\([^)]+\)', '', text)
    
    # Remove comment lines (// ...)
    text = re.sub(r'^//.*$', '', text, flags=re.MULTILINE)
    
    # Remove inline comments (// ...)
    text = re.sub(r'\s//.*$', '', text, flags=re.MULTILINE)
    
    # Remove emoji (Unicode emoji ranges)
    # This covers most common emoji ranges
    emoji_pattern = re.compile(
        "["
        "\U0001F600-\U0001F64F"  # emoticons
        "\U0001F300-\U0001F5FF"  # symbols & pictographs
        "\U0001F680-\U0001F6FF"  # transport & map symbols
        "\U0001F1E0-\U0001F1FF"  # flags (iOS)
        "\U00002500-\U00002BEF"  # various symbols
        "\U00002702-\U000027B0"
        "\U00002702-\U000027B0"
        "\U000024C2-\U0001F251"
        "\U0001f926-\U0001f937"
        "\U00010000-\U0010ffff"
        "]+", flags=re.UNICODE
    )
    text = emoji_pattern.sub('', text)
    
    # Collapse whitespace (multiple spaces, tabs, newlines -> single space)
    text = re.sub(r'\s+', ' ', text)
    
    # Strip leading/trailing whitespace
    text = text.strip()
    
    # Truncate at sentence boundary if over max_chars
    if len(text) > max_chars:
        # Find last sentence ending before max_chars
        truncated = text[:max_chars]
        last_sentence_end = max(
            truncated.rfind('.'),
            truncated.rfind('!'),
            truncated.rfind('?')
        )
        if last_sentence_end > max_chars * 0.5:  # Only truncate at sentence if reasonable
            text = truncated[:last_sentence_end + 1]
        else:
            # Fallback: hard truncate at word boundary
            text = truncated.rsplit(' ', 1)[0] + '...'
    
    # Log reduction if significant (>10%)
    # (Logging will be done by caller to avoid import cycles)
    
    return text


_SENTENCE_END = re.compile(r"(?<=[.!?।])\s+")


def split_sentences(text: str, max_chars: int = 450) -> list:
    """Split text into sentence-aware chunks of at most max_chars.

    Sentences (split on . ! ? and the Hindi danda ।) are packed greedily;
    a single sentence longer than max_chars is hard-split on whitespace,
    mirroring the old frontend 450-char chunker. Used by the streaming TTS
    endpoint so each chunk can be emitted as soon as its own provider call
    returns. Returns [] for empty/blank input.
    """
    text = (text or "").strip()
    if not text:
        return []
    sentences = [s.strip() for s in _SENTENCE_END.split(text) if s.strip()]
    chunks = []
    cur = ""

    def flush():
        nonlocal cur
        if cur:
            chunks.append(cur)
            cur = ""

    for s in sentences:
        while len(s) > max_chars:
            flush()
            cut = s.rfind(" ", 0, max_chars)
            if cut <= 0:
                cut = max_chars
            chunks.append(s[:cut].strip())
            s = s[cut:].strip()
        if cur and len(cur) + 1 + len(s) > max_chars:
            flush()
        cur = f"{cur} {s}".strip() if cur else s
    flush()
    return chunks or [text]


# --- spoken-form expansion -------------------------------------------------
# Sarvam bulbul (and the browser speechSynthesis fallback) mangle bare
# numerals: "234" is read digit-by-digit, "26°C" is skipped or garbled.
# expand_spoken_forms() rewrites numbers and units into speakable words
# BEFORE the TTS call so the provider receives clean text.
#
# Order matters: units first (they consume their digits), then negatives,
# decimals, ordinals, years, and finally plain cardinals. A digit run is
# only touched when standalone — digits inside words ("abc123") or
# hyphenated IDs ("alert-123") are left alone, and sanitize_for_tts()
# already strips URLs before this runs.

_TTS_LOCALES = {"en": "en-IN", "hi": "hi-IN", "te": "te-IN"}


def resolve_tts_language(language: str) -> str:
    """Map a UI language to the Sarvam target_language_code.

    EN/HI/TE ONLY. Anything else — notably "ta" — raises ValueError so an
    unsupported language can never be synthesized by accident. Accepts both
    bare codes ("en") and locales ("en-IN").
    """
    base = (language or "en").split("-")[0].strip().lower()
    try:
        return _TTS_LOCALES[base]
    except KeyError:
        raise ValueError(
            f"unsupported TTS language {language!r}; supported: en, hi, te"
        ) from None


_ONES_EN = ["zero", "one", "two", "three", "four", "five", "six", "seven",
            "eight", "nine", "ten", "eleven", "twelve", "thirteen",
            "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
            "nineteen"]
_TENS_EN = ["", "", "twenty", "thirty", "forty", "fifty", "sixty",
            "seventy", "eighty", "ninety"]
_ORDINAL_SPECIAL_EN = {"one": "first", "two": "second", "three": "third",
                       "five": "fifth", "eight": "eighth", "nine": "ninth",
                       "twelve": "twelfth"}
# Max cardinal converted to words; larger numbers keep their digits.
_MAX_CARDINAL = 999999


def _cardinal_en(n: int) -> str:
    """English words for 0..999999, space-joined, no hyphens, no 'and'."""
    if n < 20:
        return _ONES_EN[n]
    if n < 100:
        tens, ones = divmod(n, 10)
        return _TENS_EN[tens] if ones == 0 else f"{_TENS_EN[tens]} {_ONES_EN[ones]}"
    if n < 1000:
        hundreds, rest = divmod(n, 100)
        return (f"{_ONES_EN[hundreds]} hundred" if rest == 0
                else f"{_ONES_EN[hundreds]} hundred {_cardinal_en(rest)}")
    thousands, rest = divmod(n, 1000)
    return (f"{_cardinal_en(thousands)} thousand" if rest == 0
            else f"{_cardinal_en(thousands)} thousand {_cardinal_en(rest)}")


def _ordinal_en(n: int) -> str:
    """English ordinal words: 21 -> 'twenty first', 100 -> 'one hundredth'."""
    words = _cardinal_en(n).split()
    last = words[-1]
    if last in _ORDINAL_SPECIAL_EN:
        words[-1] = _ORDINAL_SPECIAL_EN[last]
    elif last.endswith("y"):
        words[-1] = last[:-1] + "ieth"
    else:
        words[-1] = last + "th"
    return " ".join(words)


def _year_en(n: int) -> str | None:
    """Paired year words for 1100..2099, else None (caller falls back to
    cardinal). 2026 -> 'twenty twenty six'; 2006 -> 'two thousand six'."""
    if not 1100 <= n <= 2099:
        return None
    if 2000 <= n <= 2009:
        return "two thousand" if n == 2000 else f"two thousand {_cardinal_en(n - 2000)}"
    hi, lo = divmod(n, 100)
    if lo == 0:
        return f"{_cardinal_en(hi)} hundred"
    return f"{_cardinal_en(hi)} {_cardinal_en(lo)}"


def _repl_decimal_en(m: re.Match) -> str:
    int_part = int(m.group(1))
    head = _cardinal_en(int_part) if int_part <= _MAX_CARDINAL else m.group(1)
    frac = " ".join(_ONES_EN[int(d)] for d in m.group(2))
    return f"{head} point {frac}"


def _repl_ordinal_en(m: re.Match) -> str:
    n = int(m.group(1))
    return _ordinal_en(n) if n <= _MAX_CARDINAL else m.group(0)


def _repl_year_or_cardinal_en(m: re.Match) -> str:
    n = int(m.group(1))
    year = _year_en(n)
    if year is not None:
        return year
    return _cardinal_en(n) if n <= _MAX_CARDINAL else m.group(0)


# Standalone digit run: not inside a word, not a hyphenated ID like
# "alert-123" (hyphen must follow a letter to block; "1800-123" still
# expands). Units reuse the same guard via the _NUM prefix.
_NUM_GUARD = r"(?<!\w)(?<![A-Za-z]-)"
_NUM = _NUM_GUARD + r"(\d+(?:\.\d+)?)"


def _expand_en(text: str) -> str:
    # Thousand separators: "1,000" -> "1000" so the cardinal rule sees one number.
    text = re.sub(r"(?<=\d),(?=\d)", "", text)
    # Unit ranges first: "26–30°C" -> "26 to 30 degrees Celsius".
    text = re.sub(_NUM + r"\s*[–—-]\s*(\d+(?:\.\d+)?)\s*°\s*[Cc]\b",
                  r"\1 to \2 degrees Celsius", text)
    text = re.sub(_NUM + r"\s*[–—-]\s*(\d+(?:\.\d+)?)\s*%",
                  r"\1 to \2 percent", text)
    text = re.sub(_NUM + r"\s*°\s*[Cc]\b", r"\1 degrees Celsius", text)
    text = re.sub(_NUM + r"\s*°(?!\s*[Cc])", r"\1 degrees", text)
    text = re.sub(_NUM + r"\s*%", r"\1 percent", text)
    text = re.sub(_NUM + r"\s*km/h\b", r"\1 kilometers per hour", text,
                  flags=re.IGNORECASE)
    text = re.sub(_NUM + r"\s*m/s\b", r"\1 meters per second", text,
                  flags=re.IGNORECASE)
    text = re.sub(_NUM + r"\s*mm\b", r"\1 millimeters", text,
                  flags=re.IGNORECASE)
    text = re.sub(_NUM + r"\s*km\b", r"\1 kilometers", text,
                  flags=re.IGNORECASE)
    # Negatives: "-5" -> "minus 5". Dash bullets ("- 5") are untouched —
    # the minus must touch the digit.
    text = re.sub(r"(?:(?<=^)|(?<=\s))-(?=\d)", "minus ", text)
    # Decimals, ordinals, years, cardinals — in that order.
    text = re.sub(_NUM_GUARD + r"(\d+)\.(\d+)(?!\w)", _repl_decimal_en, text)
    text = re.sub(_NUM_GUARD + r"(\d+)(st|nd|rd|th)\b", _repl_ordinal_en, text,
                  flags=re.IGNORECASE)
    text = re.sub(_NUM_GUARD + r"(\d+)(?!\w)", _repl_year_or_cardinal_en, text)
    return text


_UNITS_HI = {
    "degC": "डिग्री सेल्सियस",
    "pct": "प्रतिशत",
    "kmh": "किलोमीटर प्रति घंटा",
    "mps": "मीटर प्रति सेकंड",
    "mm": "मिलीमीटर",
    "km": "किलोमीटर",
    "range": "से",
}
_UNITS_TE = {
    "degC": "డిగ్రీల సెల్సియస్",
    "pct": "శాతం",
    "kmh": "గంటకు కిలోమీటర్లు",
    "mps": "సెకనుకు మీటర్లు",
    "mm": "మిల్లీమీటర్లు",
    "km": "కిలోమీటర్లు",
    "range": "నుండి",
}


def _expand_units_keep_digits(text: str, units: dict) -> str:
    """HI/TE: swap unit symbols for native words, leave numerals as digits
    for Sarvam's native handling. Idempotent: no unit symbol survives."""
    text = re.sub(_NUM + r"\s*[–—-]\s*(\d+(?:\.\d+)?)\s*°\s*[Cc]\b",
                  rf"\1 {units['range']} \2 {units['degC']}", text)
    text = re.sub(_NUM + r"\s*°\s*[Cc]\b", rf"\1 {units['degC']}", text)
    text = re.sub(_NUM + r"\s*%", rf"\1 {units['pct']}", text)
    text = re.sub(_NUM + r"\s*km/h\b", rf"\1 {units['kmh']}", text,
                  flags=re.IGNORECASE)
    text = re.sub(_NUM + r"\s*m/s\b", rf"\1 {units['mps']}", text,
                  flags=re.IGNORECASE)
    text = re.sub(_NUM + r"\s*mm\b", rf"\1 {units['mm']}", text,
                  flags=re.IGNORECASE)
    text = re.sub(_NUM + r"\s*km\b", rf"\1 {units['km']}", text,
                  flags=re.IGNORECASE)
    return text


def expand_spoken_forms(text: str, language: str = "en") -> str:
    """Rewrite numbers and units into speakable words for TTS.

    EN: full expansion — "26°C" -> "twenty six degrees Celsius",
    "26–30°C" -> "twenty six to thirty degrees Celsius", "234" ->
    "two hundred thirty four", "26.5" -> "twenty six point five",
    "21st" -> "twenty first", "2026" -> "twenty twenty six".
    HI/TE: unit words only ("26°C" -> "26 डिग्री सेल्सियस"); digits are
    left for Sarvam's native handling.
    Anything outside en/hi/te raises ValueError (notably "ta").
    Idempotent: expanding twice == expanding once.
    """
    if not text:
        return ""
    base = (language or "en").split("-")[0].strip().lower()
    if base == "en":
        return _expand_en(text)
    if base == "hi":
        return _expand_units_keep_digits(text, _UNITS_HI)
    if base == "te":
        return _expand_units_keep_digits(text, _UNITS_TE)
    raise ValueError(f"unsupported TTS language {language!r}; supported: en, hi, te")
