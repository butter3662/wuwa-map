"""같은 타일(지도 이미지)을 쓰는 세부 지도들을 하나의 묶음(pack)으로 합친다.

입력: site/data/catalog.json, site/data/maps/*.json (build.py 출력)
출력: site/data/packs/<key>.json, site/data/catalog.json(갱신), site/data/maps 삭제
"""
import json, os, re, shutil, collections

SITE = '/home/claude/site/'
cat = json.load(open(SITE + 'data/catalog.json'))

def key_of(src):
    m = re.match(r'tiles/maps/([^/]+)/', src)
    return 'm' + m.group(1)

def union_bounds(bs):
    bs = [b for b in bs if b]
    return {'minX': min(b['minX'] for b in bs), 'minY': min(b['minY'] for b in bs),
            'maxX': max(b['maxX'] for b in bs), 'maxY': max(b['maxY'] for b in bs)}

groups = collections.OrderedDict()
for mid, meta in cat['maps'].items():
    d = json.load(open(SITE + meta['file']))
    groups.setdefault(key_of(d['tiles']['src']), []).append((mid, d))

os.makedirs(SITE + 'data/packs', exist_ok=True)
packs = {}
new_maps = {}
for key, lst in groups.items():
    cats, cat_idx = [], {}
    groups_ = collections.OrderedDict()
    layers, layer_ids = [], set()
    areas, area_seen = [], set()
    descs, desc_idx = [], {}
    markers, seen = [], set()
    defaults = set()
    src_maps = []
    for mid, d in lst:
        ai = len(src_maps)
        src_maps.append(mid)
        for g in d['groups']:
            groups_.setdefault(g['id'], g)
        local_ci = []
        for c in d['cats']:
            if c['id'] not in cat_idx:
                cat_idx[c['id']] = len(cats)
                cats.append(c)
            local_ci.append(cat_idx[c['id']])
        for i in d.get('def', []):
            defaults.add(i)
        for l in d['layers']:
            if l['id'] not in layer_ids:
                layer_ids.add(l['id']); layers.append(l)
        for a in d['areas']:
            k = (a['n'], round(a['b']['minX']), round(a['b']['minY']))
            if k not in area_seen:
                area_seen.add(k); areas.append(a)
        local_di = []
        for de in d['descs']:
            k = json.dumps(de, ensure_ascii=False, sort_keys=True)
            if k not in desc_idx:
                desc_idx[k] = len(descs); descs.append(de)
            local_di.append(desc_idx[k])
        for m in d['markers']:
            if m[0] in seen:
                continue
            seen.add(m[0])
            markers.append([m[0], local_ci[m[1]], m[2], m[3], m[4], local_di[m[5]] if m[5] >= 0 else -1, ai])
    base = lst[0][1]
    pack = {
        'key': key, 'tiles': base['tiles'],
        'bounds': union_bounds([d.get('bounds') for _, d in lst]),
        'groups': list(groups_.values()), 'cats': cats, 'def': sorted(defaults),
        'layers': layers, 'areas': areas, 'descs': descs, 'markers': markers, 'srcMaps': src_maps,
    }
    fn = f'data/packs/{key}.json'
    json.dump(pack, open(SITE + fn, 'w'), ensure_ascii=False, separators=(',', ':'))
    packs[key] = {'file': fn, 'count': len(markers)}
    for ai, (mid, d) in enumerate(lst):
        new_maps[mid] = {'title': d['title'], 'pack': key, 'ai': ai, 'view': d.get('view') or d.get('bounds'),
                         'bounds': d.get('bounds'), 'count': len(d['markers'])}
    print(key, len(lst), 'maps ->', len(markers), 'markers,', len(cats), 'cats,', len(layers), 'layers',
          round(os.path.getsize(SITE + fn) / 1e6, 2), 'MB')

cat['maps'] = new_maps
cat['packs'] = packs
json.dump(cat, open(SITE + 'data/catalog.json', 'w'), ensure_ascii=False, indent=1)
shutil.rmtree(SITE + 'data/maps')
