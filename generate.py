import os
import json
import google.generativeai as genai

api_key = os.environ.get('GEMINI_API_KEY')
prompt_text = os.environ.get('PROMPT', 'Minor UI update')

if not api_key:
    raise ValueError("GEMINI_API_KEY secret is missing!")

genai.configure(api_key=api_key)
model = genai.GenerativeModel('gemini-2.5-flash')

TARGET_DIR = './TelegramBookingApp-v1'

# Собираем контекст проекта
context = {}
for root, dirs, files in os.walk(TARGET_DIR):
    if any(ignored in root for ignored in ['.git', 'node_modules', '.github']):
        continue
    for f in files:
        if f.endswith(('.py', '.yml', '.json', '.lock')):
            continue
        path = os.path.join(root, f)
        try:
            with open(path, 'r', encoding='utf-8') as content_file:
                context[path] = content_file.read()
        except Exception:
            pass

# Расширенные скиллы: UI/UX, iOS 26 Design System, Telegram Mini App Engine
system_prompt = (
    "You are a Senior Lead Frontend Architect & UI/UX Specialist for Telegram Mini Apps.\n"
    "YOUR SKILLS & DESIGN RULES:\n"
    "1. **iOS 26/27 Aesthetics**: Always maintain Glassmorphism, CSS `backdrop-filter: blur()`, clean CSS variables, dynamic native themes, subtle micro-interactions, scale transitions (`active: scale(0.96)`), and curved borders (`border-radius: 16px - 24px`).\n"
    "2. **Mobile UX Best Practices**: Ensure touch-friendly tap targets (minimum 44x44px), prevent rubber-band bounce breaking layout (`user-select: none`, `overflow-x: hidden`), and support dynamic dark/light theme detection via CSS variables.\n"
    "3. **Telegram Mini App SDK**: Ensure `<script src=\"https://telegram.org/js/telegram-web-app.js\"></script>` is always in `<head>`. Call `window.Telegram.WebApp.ready()`, `expand()`, and utilize native haptic feedback (`Telegram.WebApp.HapticFeedback.impactOccurred('light')`) on button taps.\n"
    "4. **Code Preservation**: NEVER delete existing functional features, interactive JavaScript logic, calendar components, or CSS variables unless explicitly requested. Always perform surgical code modifications.\n"
    "5. **Clean Output**: Return changes ONLY for files inside '{TARGET_DIR}' in strict, parseable JSON format mapping file paths to complete content. No markdown wrap."
)

full_input = f"{system_prompt}\n\nExisting Code Base:\n{json.dumps(context)}\n\nUser Feature Request:\n{prompt_text}"

response = model.generate_content(full_input)
text = response.text.strip()

if text.startswith('```'):
    lines = text.splitlines()
    if lines[0].startswith('```'):
        lines = lines[1:]
    if lines and lines[-1].startswith('```'):
        lines = lines[:-1]
    text = '\n'.join(lines).strip()

try:
    files_to_update = json.loads(text)
    for file_path, new_content in files_to_update.items():
        clean_path = file_path.lstrip('./')
        
        if not clean_path.startswith('TelegramBookingApp-v1'):
            print(f"Skipping file outside target dir: {clean_path}")
            continue
            
        if os.path.dirname(clean_path):
            os.makedirs(os.path.dirname(clean_path), exist_ok=True)
            
        with open(clean_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
            
    print("AI safely updated the interface and logic!")
except Exception as e:
    print(f"Error parsing AI response: {e}")
