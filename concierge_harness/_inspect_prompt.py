import json

wf = json.load(open('lllll.json', encoding='utf-8'))
for node in wf['nodes']:
    if node['name'] == 'Groq · Ultra-Fast AI (70B)':
        js = node['parameters']['jsCode']
        # find the SYSTEM_PROMPT backtick block
        marker = "const SYSTEM_PROMPT = `"
        start = js.find(marker) + len(marker)
        end = js.find("`;", start)
        prompt = js[start:end]
        print("CHARS:", len(prompt))
        print("~TOKENS:", len(prompt) // 4)
        print("=" * 60)
        print(prompt)
