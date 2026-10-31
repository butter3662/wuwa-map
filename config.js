/*
 * Supabase 연결 설정 — MAGI(butter3662/MAGI)와 같은 프로젝트를 쓴다. 같은 계정으로 양쪽에 로그인된다.
 *  - supabaseUrl     : Project URL
 *  - supabaseAnonKey : publishable(공개용) 키. 행 수준 보안(RLS)으로 각자 자기 데이터만 접근 가능
 *  - google          : Authentication → Providers 에서 Google 을 켰다면 true
 * service_role / secret 키는 절대 여기에 넣지 않는다.
 */
window.WUWA_CONFIG = {
  supabaseUrl: 'https://ictjkqbbcaigdvlysdaw.supabase.co',
  supabaseAnonKey: 'sb_publishable_C7jZEKJn_nF2Y3Ngq5f80Q_RA5Wrfux',
  google: false,
};
