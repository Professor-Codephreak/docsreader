"""Reproduce doc-reader.js collect() server-side, then PROVE it matches the browser."""
import re, sys, hashlib, json, urllib.request
from html.parser import HTMLParser

SEL  = {"h1","h2","h3","h4","p","blockquote","li","cite","figcaption","dd","dt","td"}
SKIP_TAGS = {"script","style","nav"}
SKIP_CLASS = {"dv-reader","dv-reader-panel","foot","drift"}

class C(HTMLParser):
    def __init__(s):
        super().__init__(convert_charrefs=True)
        s.stack=[]; s.out=[]; s.skipdepth=0
    def _skip(s, tag, attrs):
        d=dict(attrs)
        if tag in SKIP_TAGS: return True
        if "data-noread" in d: return True
        cls=set((d.get("class") or "").split())
        return bool(cls & SKIP_CLASS)
    def handle_starttag(s, tag, attrs):
        d=dict(attrs)
        node={"tag":tag,"buf":[],"sel":(tag in SEL or "data-read" in d),
              "kid":False,"skip":s._skip(tag,attrs)}
        if node["skip"] or s.skipdepth: s.skipdepth+=1
        # a matching ancestor now has a matching descendant -> it is a container
        if node["sel"]:
            for a in s.stack:
                if a["sel"]: a["kid"]=True
        s.stack.append(node)
    def handle_endtag(s, tag):
        for i in range(len(s.stack)-1,-1,-1):
            if s.stack[i]["tag"]==tag:
                node=s.stack.pop(i)
                for extra in s.stack[i:]: s.stack.remove(extra)
                if node["skip"] or s.skipdepth: s.skipdepth=max(0,s.skipdepth-1)
                if node["sel"] and not node["kid"] and not node["skip"]:
                    txt=re.sub(r"\s+"," ","".join(node["buf"])).strip()
                    txt=re.sub(r"\bLISTEN\b\s*$","",txt).strip()
                    if len(txt)>=2 and re.search(r"[a-z0-9]",txt,re.I):
                        s.out.append({"tag":tag,"text":txt})
                return
    def handle_data(s, data):
        if s.skipdepth: return
        for n in s.stack: n["buf"].append(data)

html=urllib.request.urlopen(sys.argv[1], timeout=30).read().decode("utf-8","replace")
p=C(); p.feed(html)
texts=[b["text"] for b in p.out]
sha=hashlib.sha256("".join(texts).encode()).hexdigest()[:16]
print("  blocks:", len(texts), " sha:", sha)
print("  lens:", [len(t) for t in texts])
print("  tags:", [b["tag"] for b in p.out])
json.dump(p.out, open("/tmp/blocks.json","w"), ensure_ascii=False, indent=1)
