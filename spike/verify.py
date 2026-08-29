#!/usr/bin/env python3
"""Automated WebMCP spike verification.

Prereqs: Chrome >= 149 installed, `pip install playwright` (no browser download
needed; uses the installed Chrome binary).
Run:  python3 -m http.server 8123 --directory spike   (in one terminal)
      python3 spike/verify.py                          (in another)
Passing output: api=document.modelContext, reg=2 registered, exec mutates the
counter, after_abort=[] and reregister=ok.
"""

import asyncio, json
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            headless=True,
            args=["--enable-features=WebMCP", "--no-first-run"],
        )
        page = await browser.new_page()
        logs = []
        page.on("console", lambda m: logs.append(m.text))
        await page.goto("http://localhost:8123/", wait_until="networkidle")
        await page.wait_for_timeout(500)
        out = {}
        out["api"] = await page.text_content("#api-status")
        out["reg"] = await page.text_content("#reg-status")
        out["tools"] = await page.text_content("#tools-status")
        out["has_doc_mc"] = await page.evaluate("!!document.modelContext")
        out["has_nav_mc"] = await page.evaluate("!!navigator.modelContext")
        # try in-page executeTool
        out["exec"] = await page.evaluate("""
            (async () => {
              const mc = document.modelContext ?? navigator.modelContext;
              if (!mc || typeof mc.getTools !== 'function') return 'no getTools';
              const tools = await mc.getTools();
              const echo = tools.find(t => t.name === 'echo');
              const inc = tools.find(t => t.name === 'increment_counter');
              const r1 = mc.executeTool ? await mc.executeTool(echo, JSON.stringify({message:'hi'})) : 'no executeTool';
              const r2 = mc.executeTool ? await mc.executeTool(inc, JSON.stringify({by: 5})) : 'no executeTool';
              return { echo: r1, inc: r2, counterText: document.getElementById('counter').textContent };
            })()
        """)
        out["after_abort"] = await page.evaluate("""
            (async () => {
              window.__spike.unregister();
              await new Promise(r => setTimeout(r, 100));
              const tools = await (document.modelContext).getTools();
              return tools.map(t => t.name);
            })()
        """)
        # re-register same name after abort should succeed
        out["reregister"] = await page.evaluate("""
            (async () => {
              try {
                await document.modelContext.registerTool({name:'echo', description:'again', execute: async()=>'ok'});
                return 'ok';
              } catch(e) { return e.name + ': ' + e.message; }
            })()
        """)
        out["log"] = await page.text_content("#log")
        print(json.dumps(out, indent=2))
        await browser.close()

asyncio.run(main())
