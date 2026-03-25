import httpx
import json

def test_chat():
    url = "http://127.0.0.1:8002/chat"
    payload = {
        "model": "gpt-5",
        "messages": [
            {"role": "user", "content": "Who won the Super Bowl in 2024? Use the web_search tool to find out."}
        ]
    }
    
    print(f"Sending request to {url}...")
    response = httpx.post(url, json=payload, timeout=60.0)
    
    if response.status_code == 200:
        data = response.json()
        print("\n--- Final Response ---")
        print(data["choices"][0]["message"]["content"])
    else:
        print(f"Error: {response.status_code}")
        print(response.text)

if __name__ == "__main__":
    test_chat()