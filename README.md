# 명조 지도 (비공식 팬메이드)

명조(Wuthering Waves) 맵의 보물상자·장치·수집품 마커를 조회하고, 획득 여부를 직접 체크하는 정적 사이트다.

## GitHub Pages 배포
1. 이 폴더의 내용을 저장소 루트에 그대로 올린다.
2. Settings → Pages → Branch를 `main` / `(root)`로 지정한다.
3. 빌드 과정은 없다 (순수 HTML/JS).

로컬 확인: `python3 -m http.server` 후 http://localhost:8000 접속 (file:// 로 열면 fetch가 막혀 동작하지 않는다).

## 구조
- `data/catalog.json`, `data/maps/*.json` : 지도별 카테고리·마커·설명(한국어)
- `pk/*.webp` + `pk/index.json` : 지도 타일·아이콘을 묶은 파일과 위치 색인
- 진행도는 브라우저 localStorage(`wuwa-ko:done`)에 저장되며, 설정 탭에서 JSON으로 내보내기/가져오기 할 수 있다.

## 데이터 출처
- 지도 타일·마커: 쿠로게임즈 공식 인터랙티브 지도를 비상업적으로 미러링한 Acceleratorer/wuwa-map 번들 (2026-10-22 수집). NOTICE-KURO-DATA.md 참고. 게임 데이터·이미지의 권리는 KURO GAMES에 있다.
- 한국어 명칭: Dimbreath/WutheringData 게임 텍스트의 중↔한 대응, 일부는 비공식 번역.
