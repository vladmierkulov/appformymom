import os
import json
import requests

api_key = os.environ.get('OPENROUTER_API_KEY')
prompt_text = os.environ.get('PROMPT', 'Minor update')

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
    "You are an expert Senior Lead Frontend Architect for Telegram Mini Apps.\n"
    "CRITICAL RULES:\n"
    "1. Preserve the iOS Liquid Glass / Glassmorphism visual style and responsive calendar layout.\n"
    "2. ALWAYS include Telegram SDK script and call window.Telegram.WebApp.ready().\n"
    "3. NEVER delete working features or reset layout unless asked.\n"
    f"4. Return changes ONLY for files inside '{TARGET_DIR}' in strict, valid JSON mapping file paths to new content.\n"
    "5. Output ONLY raw JSON, without markdown formatting."
)

user_message = f"Existing Code Base:\n{json.dumps(context)}\n\nUser Feature Request:\n{prompt_text}"

# Можно использовать бесплатные модели: 'deepseek/deepseek-r1:free', 'meta-llama/llama-3.3-70b-instruct:free', 'google/gemini-2.0-flash-exp:free'
response = requests.post(
    url="https://openrouter.ai/api/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    },
    data=json.dumps({
        "model": "google/gemini-2.0-flash-exp:free", # Очень умная и бесплатная модель
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ]
    })
)

res_json = response.json()
text = res_json['choices'][0]['message']['content'].strip()

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
            continue
        if os.path.dirname(clean_path):
            os.makedirs(os.path.dirname(clean_path), exist_ok=True)
        with open(clean_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
    print("Code updated successfully via OpenRouter!")
except Exception as e:
    print(f"Error parsing AI response: {e}")
