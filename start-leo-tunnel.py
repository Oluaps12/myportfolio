#!/usr/bin/env python3
"""
start-leo-tunnel.py - Automated Cloudflare Tunnel & Dynamic Gist Updater for Leo AI

1. Starts cloudflared tunnel pointing to your backend (port 8765).
2. Captures the generated trycloudflare.com URL automatically.
3. Updates your GitHub Gist with the new WebSocket URL.
4. Keeps the tunnel running so your portfolio (https://devwithpau.onrender.com)
   connects automatically without any manual code edits or commits!
"""

import sys
import os
import re
import json
import subprocess
import urllib.request
import urllib.error

CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tunnel_config.json")

def find_cloudflared():
    # Common Windows install locations
    paths = [
        r"C:\Program Files (x86)\cloudflared\cloudflared.exe",
        r"C:\Program Files\cloudflared\cloudflared.exe",
    ]
    for p in paths:
        if os.path.exists(p):
            return p
    # Fallback to system PATH
    return "cloudflared"

def load_config():
    if not os.path.exists(CONFIG_FILE):
        config = {
            "gist_id": "d6bc7b29d6b1e0ce63aa23408eed9b2c",
            "github_token": "",
            "local_port": 8765
        }
    else:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            config = json.load(f)

    token = config.get("github_token", "").strip()
    if not token or token == "YOUR_GITHUB_TOKEN_HERE":
        print("\n=======================================================")
        print("  🔑 GitHub Personal Access Token Required")
        print("=======================================================")
        print("Paste your GitHub token (starts with ghp_):")
        token = input("> ").strip()
        config["github_token"] = token
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
        print("Token saved to tunnel_config.json!\n")

    return config

def update_gist(gist_id, token, ws_url):
    api_url = f"https://api.github.com/gists/{gist_id}"
    payload = {
        "files": {
            "leo_tunnel.json": {
                "content": json.dumps({"url": ws_url}, indent=2)
            }
        }
    }
    req = urllib.request.Request(
        api_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "Leo-Tunnel-Updater",
            "Content-Type": "application/json"
        },
        method="PATCH"
    )
    with urllib.request.urlopen(req) as resp:
        if resp.status in (200, 201):
            return True
    return False

def main():
    print("=" * 66)
    print("  🚀 LEO AI - DYNAMIC CLOUDFLARE TUNNEL LAUNCHER")
    print("=" * 66)

    config = load_config()
    gist_id = config.get("gist_id", "d6bc7b29d6b1e0ce63aa23408eed9b2c")
    token = config.get("github_token")
    port = config.get("local_port", 8765)
    cloudflared_bin = find_cloudflared()

    print(f"[*] Starting Cloudflare Tunnel for port {port}...")
    cmd = [cloudflared_bin, "tunnel", "--url", f"http://localhost:{port}"]

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            encoding="utf-8",
            errors="replace"
        )
    except FileNotFoundError:
        print(f"[!] Error: cloudflared not found at {cloudflared_bin}.")
        sys.exit(1)

    url_pattern = re.compile(r"https://([a-zA-Z0-9-]+\.trycloudflare\.com)")
    tunnel_url = None

    for line in proc.stdout:
        print("  " + line.strip())
        match = url_pattern.search(line)
        if match and not tunnel_url:
            tunnel_url = match.group(0)
            ws_url = f"wss://{match.group(1)}/ws/voice"
            print("\n" + "=" * 66)
            print(f"  [+] Tunnel Created : {tunnel_url}")
            print(f"  [+] WebSocket URL  : {ws_url}")
            print(f"  [*] Updating GitHub Gist ({gist_id})...")

            try:
                ok = update_gist(gist_id, token, ws_url)
                if ok:
                    print("  [✓] Gist updated successfully!")
                    print("=" * 66)
                    print("  🎉 LEO VOICE AI IS FULLY OPERATIONAL!")
                    print("  Visit your portfolio: https://devwithpau.onrender.com/")
                    print("  Any phone or device will now auto-connect to this tunnel.")
                    print("  Keep this window open. Press Ctrl+C to stop.")
                    print("=" * 66 + "\n")
                else:
                    print("  [!] Warning: Gist update returned non-200 status.")
            except urllib.error.HTTPError as e:
                print(f"  [!] GitHub API Error: HTTP {e.code} - {e.read().decode('utf-8', errors='ignore')}")
                print("      Please verify your token has 'gist' permission in tunnel_config.json")
            except Exception as e:
                print(f"  [!] Failed to update Gist: {e}")

    proc.wait()

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[*] Tunnel stopped by user. Goodbye!")
        sys.exit(0)
