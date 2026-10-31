/*
 * Supabase 연결 설정 — 비워 두면 계정 로그인 기능이 꺼진다.
 * Supabase 대시보드 → Project Settings → API 에서 복사한다.
 *  - supabaseUrl     : Project URL (예: https://abcd1234.supabase.co)
 *  - supabaseAnonKey : anon public 키 (공개용 키. 행 수준 보안(RLS)으로 각자 자기 데이터만 접근 가능)
 *  - google          : Authentication → Providers 에서 Google 을 켰다면 true
 * service_role 키는 절대 여기에 넣지 않는다.
 */
window.WUWA_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  google: false,
};
