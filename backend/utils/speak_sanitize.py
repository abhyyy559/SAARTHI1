"""TTS text sanitizer — strips markdown, URLs, emoji, comments for clean speech."""

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