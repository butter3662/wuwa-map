import json,glob,re,sys
t=json.load(open('todo_zh.json'))
need=json.load(open('segneed.json'))
segko=json.load(open('segko.json'))
full={}
for f in sorted(glob.glob('tr/*.txt')):
    for l in open(f):
        l=l.rstrip('\n')
        if '|' in l:
            i,k=l.split('|',1); full[t[int(i)]]=k.replace('⏎','\n')
for f in sorted(glob.glob('seg/*.txt')):
    for l in open(f):
        l=l.rstrip('\n')
        if '|' in l:
            i,k=l.split('|',1); segko[need[int(i)]]=k
try:
    for k,v in json.load(open('auto_tr.json')).items(): full.setdefault(k,v)
except Exception: pass
def tr(o):
    if o in full: return full[o]
    out=[]
    for p in o.split('\n'):
        q=p.strip()
        if not q: continue
        if q not in segko: return None
        out.append(segko[q])
    return '\n'.join(out)
dic={}
for o in t:
    k=tr(o)
    if k is not None: dic[o]=k
json.dump(dic,open('desc_ko.json','w'),ensure_ascii=False,indent=0)
print('translated',len(dic),'/',len(t))
if '--apply' in sys.argv:
    left=0;done=0
    for f in glob.glob('/home/claude/site/data/packs/*.json'):
        d=json.load(open(f))
        for i,x in enumerate(d['descs']):
            if 'o' in x:
                k=dic.get(x['o'])
                if k is None: left+=1; continue
                d['descs'][i]={'k':(x['p']+' · ' if x.get('p') else '')+k}; done+=1
        json.dump(d,open(f,'w'),ensure_ascii=False,separators=(',',':'))
    print('applied',done,'left',left)
