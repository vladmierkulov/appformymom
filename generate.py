import os
import json
import google.generativeai as genai

api_key = os.environ.get('GEMINI_API_KEY')
prompt_text = os.environ.get('PROMPT', 'Update project')

if not api_key:
    raise ValueError("GEMINI_API_KEY secret is missing!")

genai.configure(api_key=api_key)
model = genai.GenerativeModel('gemini-2.5-flash')

# Собираем файлы проекта
context = {}
for root, dirs, files in os.walk('.'):
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
    "You are an expert developer. "
    "Analyze the request and codebase. "
    "Return ONLY a raw JSON object mapping relative file paths to their full updated content. "
    "Do NOT use markdown code blocks like ```json."
)

full_input = f"{system_prompt}\n\nContext:\n{json.dumps(context)}\n\nPrompt:\n{prompt_text}"

response = model.generate_content(full_input)
text = response.text.strip()

# Очистка от возможных markdown-тегов
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
    if os.path.dirname(clean_path):
        os.makedirs(os.path.dirname(clean_path), exist_ok=True)
    with open(clean_path, 'w', encoding='utf-8') as f:
        f.write(new_content)

print("Files successfully updated by Gemini!")
