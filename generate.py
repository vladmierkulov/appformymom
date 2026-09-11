import os
import json
import requests

api_key = os.environ.get('OPENROUTER_API_KEY')
prompt_text = os.environ.get('PROMPT', 'Standard UI update')

if not api_key:
    raise ValueError("OPENROUTER_API_KEY secret is missing!")

TARGET_DIR = './TelegramBookingApp-v1'

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

system_prompt = (
    "You are a Senior Codex-level AI Developer for Telegram Mini Apps.\n"
    "CRITICAL REQUIREMENTS:\n"
    "1. Preserve existing iOS Glassmorphism styling and Javascript logic.\n"
    "2. Ensure window.Telegram.WebApp.ready() is called in <head> or main script.\n"
    "3. Apply surgical updates only; do NOT clear file content or overwrite existing layout.\n"
    f"4. Output strictly a JSON object mapping relative file paths within '{TARGET_DIR}' to complete updated contents.\n"
    "5. Do NOT output markdown ticks or intro text, return ONLY the raw JSON string."
)

user_message = f"Codebase Context:\n{json.dumps(context)}\n\nUser Change Request:\n{prompt_text}"

# Вызов стандартной модели OpenAI / Codex уровня через OpenRouter
response = requests.post(
    url="https://openrouter.ai/api/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    },
    data=json.dumps({
        "model": "openai/gpt-oss-120b:free", # Стандартная бесплатная кодинг-модель OpenAI
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ]
    })
)

res_json = response.json()

try:
    text = res_json['choices'][0]['message']['content'].strip()
    
    # Очистка от возможных ```json маркдаунов
    if text.startswith('```'):
        lines = text.splitlines()
        if lines[0].startswith('```'):
            lines = lines[1:]
        if lines and lines[-1].startswith('```'):
            lines = lines[:-1]
        text = '\n'.join(lines).strip()

    files_to_update = json.loads(text)
    for file_path, new_content in files_to_update.items():
        clean_path = file_path.lstrip('./')
        if not clean_path.startswith('TelegramBookingApp-v1'):
            continue
        if os.path.dirname(clean_path):
            os.makedirs(os.path.dirname(clean_path), exist_ok=True)
        with open(clean_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
            
    print("Codex-style update finished successfully!")
except Exception as e:
    print(f"Error executing update: {e}")
    print(f"Raw response: {res_json}")
