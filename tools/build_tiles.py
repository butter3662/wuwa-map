"""지도 타일을 묶음 파일(pk/*.webp)과 색인(pk/index.json)으로 만든다.

사용법: python tools/build_tiles.py <타일 원본 폴더> [사이트 폴더]
  타일 원본 폴더 안에는 maps/<state>/<x>_<y>.(png|webp), layers/<state>/<층>/<x>_<y>.(png|webp),
  icons/*.webp 가 있어야 한다 (Acceleratorer/wuwa-map 의 crawl-kuro-map.mjs 출력 구조).
- 줌 0 타일은 원본 해상도 그대로(1024px 원본이면 1024px) 고화질 webp로 저장한다.
- 줌 -1~-3 타일(축소용)을 만들어 휴대폰에서 메모리 초과가 나지 않게 한다.
- 기존 지도 데이터(data/maps/*.json)의 타일 격자와 다르면 마커 위치가 어긋나므로 중단한다.
"""
import json, os, sys, glob, shutil, collections
from PIL import Image

SRC = os.path.abspath(sys.argv[1]) + '/'
SITE = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else '.') + '/'
OUT = SITE + 'pk/'
TMP = '/tmp/pyr_build/'
CH = 8
LEVELS = (-1, -2, -3)
Q0, QL = 90, 82

def tiles_in(d):
    out = {}
    for f in os.listdir(d):
        stem, ext = os.path.splitext(f)
        if ext.lower() in ('.png', '.webp'):
            x, y = map(int, stem.split('_'))
            out[(x, y)] = d + '/' + f
    return out

def check_grid():
    """crawl 결과의 격자(열·행 수)가 사이트 데이터와 같은지 확인"""
    ours = {}
    for f in glob.glob(SITE + 'data/maps/*.json'):
        t = json.load(open(f))['tiles']
        ours[t['src']] = (t['columns'], t['rows'])
    theirs = {}
    for f in glob.glob(SRC + 'maps/*.json'):
        t = json.load(open(f)).get('tiles') or {}
        if 'src' in t:
            src = 'tiles/' + t['src'].split('map-packs/private/')[-1].replace('.png', '.webp')
            theirs[src] = (t['columns'], t['rows'])
    bad = [(k, v, theirs[k]) for k, v in ours.items() if k in theirs and theirs[k] != v]
    if bad:
        raise SystemExit('타일 격자가 바뀌어 마커 위치가 어긋납니다. 지도 데이터도 새로 만들어야 합니다: %r' % bad[:3])
    print('격자 확인:', len(theirs), '개 지도 정보 비교, 이상 없음' if theirs else '(crawl 지도 정보 없음, 건너뜀)')

def pyramid(rel):
    z0 = tiles_in(SRC + rel)
    if not z0:
        return {}
    size = Image.open(next(iter(z0.values()))).size[0]
    out = {0: {}}
    d0 = TMP + rel + '/0/'
    os.makedirs(d0, exist_ok=True)
    for (x, y), p in z0.items():
        dst = d0 + f'{x}_{y}.webp'
        Image.open(p).convert('RGBA').save(dst, 'WEBP', quality=Q0, method=5)
        out[0][(x, y)] = dst
    half = size // 2
    for z in LEVELS:
        parents = collections.defaultdict(list)
        for (x, y), p in out[z + 1].items():
            parents[(x // 2, y // 2)].append((x, y, p))
        d = TMP + rel + '/' + str(z) + '/'
        os.makedirs(d, exist_ok=True)
        cur = {}
        for (px, py), kids in parents.items():
            canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
            for x, y, p in kids:
                canvas.paste(Image.open(p).convert('RGBA').resize((half, half), Image.LANCZOS), ((x - px * 2) * half, (y - py * 2) * half))
            dst = d + f'{px}_{py}.webp'
            canvas.save(dst, 'WEBP', quality=QL, method=5)
            cur[(px, py)] = dst
        out[z] = cur
    return out

def check_keys(new_dirs):
    """기존 타일과 새 타일이 같은 자리의 같은 그림인지 표본 비교 (격자가 밀리면 마커가 어긋난다)"""
    import io
    from PIL import ImageStat
    try:
        old = json.load(open(OUT + 'index.json'))['tiles']
    except Exception:
        return
    cache = {}
    def thumb(img):
        return img.convert('L').resize((32, 32), Image.BILINEAR)
    for rel, ent in old.items():
        if rel not in new_dirs or not rel.startswith('maps/'):
            continue
        news = tiles_in(SRC + rel)
        cands = []
        for k, (fname, off, ln) in ent.items():
            if '|' in k:
                continue
            x, y = map(int, k.split(','))
            if (x, y) not in news:
                continue
            if fname not in cache:
                cache[fname] = open(OUT + fname, 'rb').read()
            t_old = thumb(Image.open(io.BytesIO(cache[fname][off:off + ln])))
            sd = ImageStat.Stat(t_old).stddev[0]
            if sd > 12:
                cands.append((sd, (x, y), t_old))
        cands.sort(reverse=True)
        diffs = []
        for sd, xy, t_old in cands[:6]:
            t_new = thumb(Image.open(news[xy]))
            d = sum(abs(p - q) for p, q in zip(t_old.getdata(), t_new.getdata())) / 1024
            diffs.append(d)
        if diffs and sorted(diffs)[len(diffs) // 2] > 20:
            raise SystemExit(f'{rel}: 같은 위치 타일의 그림이 다릅니다(차이 {diffs}) → 격자가 바뀐 것으로 보여 중단합니다.')
    print('타일 위치 확인: 이상 없음')

def main():
    check_grid()
    shutil.rmtree(TMP, ignore_errors=True)
    dirs = sorted(os.path.relpath(d, SRC) for d, _, fs in os.walk(SRC)
                  if any(x.endswith(('.png', '.webp')) for x in fs) and not os.path.relpath(d, SRC).startswith('icons'))
    check_keys(set(dirs))
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    index = {'tiles': {}, 'icons': {}}

    def write_chunk(name, items):
        res, off = {}, 0
        with open(OUT + name, 'wb') as f:
            for key, path in items:
                b = open(path, 'rb').read()
                f.write(b); res[key] = [name, off, len(b)]; off += len(b)
        return res

    layer_groups = collections.defaultdict(list)
    for rel in dirs:
        pyr = pyramid(rel)
        parts = rel.split('/')
        if parts[0] == 'layers':
            for z, tiles in pyr.items():
                for (x, y), p in tiles.items():
                    layer_groups[parts[1]].append((rel, f'{x},{y}' if z == 0 else f'{z}|{x},{y}', p))
            continue
        entries = {}
        for z, tiles in pyr.items():
            groups = collections.defaultdict(list)
            for (x, y), p in tiles.items():
                groups[(x // CH, y // CH)].append((f'{x},{y}' if z == 0 else f'{z}|{x},{y}', p))
            zt = '' if z == 0 else f'z{-z}_'
            for (cx, cy), items in sorted(groups.items()):
                entries.update(write_chunk(f'm{parts[1]}_{zt}{cx}_{cy}.webp', sorted(items)))
        index['tiles'][rel] = entries
        print('지도', rel, {z: len(t) for z, t in pyr.items()})
    for state, items in sorted(layer_groups.items()):
        for rk, v in write_chunk(f'l{state}.webp', [(rel + '#' + k, p) for rel, k, p in sorted(items)]).items():
            rel, k = rk.split('#', 1)
            index['tiles'].setdefault(rel, {})[k] = v

    used = set()
    for f in glob.glob(SITE + 'data/maps/*.json'):
        for c in json.load(open(f))['cats']:
            if c['i']:
                used.add(os.path.basename(c['i']))
    icon_dir = SRC + 'icons/' if os.path.isdir(SRC + 'icons') else None
    have = [(n, icon_dir + n) for n in sorted(used) if icon_dir and os.path.exists(icon_dir + n)]
    if len(have) < len(used):
        print('아이콘 일부 없음:', len(used) - len(have))
    index['icons'] = write_chunk('icons.webp', have)
    json.dump(index, open(OUT + 'index.json', 'w'), separators=(',', ':'))
    print('완료: 묶음 파일', len(os.listdir(OUT)) - 1, '개, 아이콘', len(have), '개')

if __name__ == '__main__':
    main()
