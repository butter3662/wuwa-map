# 명조 지도 (비공식 팬메이드)

명조(Wuthering Waves) 맵의 보물상자·장치·수집품 마커를 조회하고, 획득 여부를 체크하는 정적 사이트다.
Supabase 계정으로 로그인하면 진행도가 계정에 저장되어 여러 기기에서 맞춰진다.

## 1. GitHub Pages 배포
1. 저장소 Settings → Pages → Source: `Deploy from a branch`, Branch: `main` / `(root)` → Save
2. 1~2분 뒤 `https://butter3662.github.io/wuwa-map/` 에서 열린다. 빌드 과정은 없다.

로컬 확인: `python3 -m http.server` 후 http://localhost:8000 (file:// 로 열면 동작하지 않는다)

## 2. 계정 연동(Supabase) 설정
MAGI(butter3662/MAGI)와 **같은 Supabase 프로젝트**를 쓴다(`config.js`에 주소·공개 키가 이미 들어 있다). MAGI 계정으로 그대로 로그인된다.

처음 한 번만 할 일:
1. Supabase 대시보드에서 MAGI 프로젝트(`ictjkqbbcaigdvlysdaw`)를 연다.
2. **SQL Editor** 에 `supabase/schema.sql` 내용을 붙여넣고 Run → `wuwa_progress` 테이블과 행 수준 보안(RLS) 정책이 만들어진다. MAGI의 `magi_sessions` 테이블은 건드리지 않는다.
3. (권장) **Authentication → URL Configuration → Redirect URLs** 에 `https://butter3662.github.io/wuwa-map/` 를 추가한다. 추가하지 않으면 이 사이트에서 가입할 때 받은 확인 메일 링크가 MAGI 주소로 열린다(인증 자체는 정상 처리되니 그 뒤 이 사이트에서 로그인하면 된다).
4. (선택) Google 로그인을 켰다면 `config.js` 에서 `google: true`.

`service_role`/secret 키는 절대 `config.js` 에 넣지 않는다. 지금 들어 있는 publishable 키는 공개용이다.

### 동기화 방식
- 지도 1장당 한 행(`map_id`, 체크한 마커 id 배열 `ids`, 수정 시각 `t`)을 저장한다.
- 체크/해제 후 약 1.5초 뒤 그 지도 행을 저장하고, 페이지를 열거나 다시 화면에 돌아올 때 서버 내용을 받아온다. 같은 지도는 더 나중에 수정한 쪽이 이긴다.
- 어떤 기기에서 처음 로그인할 때는 그 기기에 있던 체크와 계정의 체크를 **합친다**(지우지 않음).

## 3. 지도 고화질로 바꾸기
지금 들어 있는 지도 타일은 공식 원본(1024px PNG)을 768px로 줄인 사본이다. 원본으로 바꾸려면:
1. 저장소 **Actions** 탭 → 왼쪽 **고화질 지도 타일 받기** → **Run workflow**
2. 10~30분 뒤 끝나면 `pk/` 가 새 타일로 교체되어 자동 커밋되고, Pages 에 반영된다.
- 공식 지도 타일 배치(격자)가 바뀌어 마커 위치가 어긋날 상황이면 작업이 스스로 중단되고 기존 타일이 유지된다.

## 구조
- `index.html`, `app.js`, `app.css`, `config.js`
- `data/catalog.json`, `data/maps/*.json` : 지도별 카테고리·마커·설명(한국어)
- `pk/*.webp` + `pk/index.json` : 지도 타일·아이콘을 묶은 파일과 위치 색인
- `tools/build_tiles.py`, `.github/workflows/hires-tiles.yml` : 원본 타일 받기·묶기
- `supabase/schema.sql` : Supabase 테이블(`wuwa_progress`)·보안 정책

## 데이터 출처
- 지도 타일·마커: 쿠로게임즈 공식 인터랙티브 지도를 비상업적으로 미러링한 Acceleratorer/wuwa-map 번들(2026-10-22 수집). `NOTICE-KURO-DATA.md` 참고. 게임 데이터·이미지의 권리는 KURO GAMES 에 있다.
- 한국어 명칭: Arikatsu/WutheringWaves_Data 3.7 게임 텍스트의 중↔한 대응(공식 표기). 일부 지도 메모는 비공식 번역.
