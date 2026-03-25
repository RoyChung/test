import os
import httpx
import json

def web_search(query: str) -> dict:
    """
    Calls the internal search API.
    """
    url = "https://space.ai-builders.com/backend/v1/search/"
    api_key = os.getenv("SUPER_MIND_API_KEY")
    if not api_key:
        raise ValueError("SUPER_MIND_API_KEY environment variable is not set")
        
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "keywords": [query],
        "max_results": 3
    }
    
    response = httpx.post(url, json=payload, headers=headers)
    response.raise_for_status()
    return response.json()

# Function schema for the LLM
web_search_schema = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "Search the web for current information, news, or facts.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query string."
                }
            },
            "required": ["query"]
        }
    }
}

if __name__ == "__main__":
    # Test to verify the LLM can output a valid Tool Call
    # We'll use the local proxy or OpenAI API
    
    chat_url = os.getenv("CHAT_COMPLETIONS_URL", "http://127.0.0.1:8002/v1/chat/completions")
    
    payload = {
        "model": "gpt-5", # Or any model supported by your proxy
        "messages": [
            {"role": "user", "content": "Who won the Super Bowl? Please use the web_search tool to find the most recent winner."}
        ],
        "tools": [web_search_schema],
        "tool_choice": "auto"
    }
    
    print(f"Sending request to {chat_url}...")
    try:
        response = httpx.post(chat_url, json=payload, timeout=30.0)
        response.raise_for_status()
        data = response.json()
        
        message = data["choices"][0]["message"]
        
        print("\n--- LLM Response ---")
        if "tool_calls" in message and message["tool_calls"]:
            print("Success! The LLM output a Tool Call:")
            print(json.dumps(message["tool_calls"], indent=2))
        else:
            print("No tool call returned. Message content:")
            print(message.get("content"))
            
    except Exception as e:
        print(f"Error calling LLM: {e}")
