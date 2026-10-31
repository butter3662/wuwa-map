# 명조 지도 (비공식 팬메이드)

명조(Wuthering Waves) 맵의 보물상자·장치·수집품 마커를 조회하고, 획득 여부를 체크하는 정적 사이트다.
Supabase 계정으로 로그인하면 진행도가 계정에 저장되어 여러 기기에서 맞춰진다.

## 1. GitHub Pages 배포
1. 저장소 Settings → Pages → Source: `Deploy from a branch`, Branch: `main` / `(root)` → Save
2. 1~2분 뒤 `https://butter3662.github.io/wuwa-map/` 에서 열린다. 빌드 과정은 없다.

로컬 확인: `python3 -m http.server` 후 http://localhost:8000 (file:// 로 열면 동작하지 않는다)

## 2. 계정 연동(Supabase) 설정
`config.js` 가 비어 있으면 로그인 기능은 꺼진 채로 동작한다(진행도는 브라우저에만 저장).

1. https://supabase.com 에서 새 프로젝트를 만든다.
2. **SQL Editor** 에 `supabase/schema.sql` 내용을 붙여넣고 Run → `progress` 테이블과 행 수준 보안(RLS) 정책이 만들어진다. 각 사용자는 자기 행만 읽고 쓸 수 있다.
3. **Authentication → URL Configuration**
   - Site URL: `https://butter3662.github.io/wuwa-map/`
   - Redirect URLs 에도 같은 주소를 추가한다.
4. (선택) 테스트 중 가입 확인 메일이 번거로우면 Authentication 의 Email 공급자 설정에서 *Confirm email* 을 끈다. 켜 두면 가입 후 메일의 링크를 눌러야 로그인된다.
5. (선택) Google 로그인: Authentication → Providers → Google 을 켜고 Google Cloud 의 OAuth 클라이언트 ID/보안 비밀을 입력한다(승인된 리디렉션 URI 는 `https://<프로젝트>.supabase.co/auth/v1/callback`). 그 뒤 `config.js` 에서 `google: true`.
6. **Project Settings → API (API Keys)** 에서 Project URL 과 `anon`(public) 키를 복사해 `config.js` 에 넣고 커밋한다.
   - anon 키는 공개되어도 되는 키다(RLS 로 보호). `service_role` 키는 절대 넣지 않는다.

### 동기화 방식
- 지도 1장당 한 행(`map_id`, 체크한 마커 id 배열 `ids`, 수정 시각 `t`)을 저장한다.
- 체크/해제 후 약 1.5초 뒤 그 지도 행을 저장하고, 페이지를 열거나 다시 화면에 돌아올 때 서버 내용을 받아온다. 같은 지도는 더 나중에 수정한 쪽이 이긴다.
- 어떤 기기에서 처음 로그인할 때는 그 기기에 있던 체크와 계정의 체크를 **합친다**(지우지 않음).

## 구조
- `index.html`, `app.js`, `app.css`, `config.js`
- `data/catalog.json`, `data/maps/*.json` : 지도별 카테고리·마커·설명(한국어)
- `pk/*.webp` + `pk/index.json` : 지도 타일·아이콘을 묶은 파일과 위치 색인
- `supabase/schema.sql` : Supabase 테이블·보안 정책

## 데이터 출처
- 지도 타일·마커: 쿠로게임즈 공식 인터랙티브 지도를 비상업적으로 미러링한 Acceleratorer/wuwa-map 번들(2026-10-22 수집). `NOTICE-KURO-DATA.md` 참고. 게임 데이터·이미지의 권리는 KURO GAMES 에 있다.
- 한국어 명칭: Arikatsu/WutheringWaves_Data 3.7 게임 텍스트의 중↔한 대응(공식 표기). 일부 지도 메모는 비공식 번역.
