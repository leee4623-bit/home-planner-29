/*
 * DB 마이그레이션 적용: migrations/*.sql 중 아직 적용하지 않은 파일을 순서대로 적용합니다.
 *   DATABASE_URL=… npm run migrate      (Render Shell 또는 내 PC에서, 연결 문자열은 환경변수로만)
 * 이미 적용한 파일은 다시 실행하지 않으며(schema_migrations 표), 기존 데이터는 지우지 않습니다.
 */
'use strict';
const { migratePg } = require('./db');
(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL 환경변수가 없습니다. (연결 문자열을 명령줄·코드에 직접 쓰지 마세요)'); process.exit(1); }
  const client = require('./pg').createClient(url);
  const r = await migratePg(client, (m) => console.log(m));
  console.log('마이그레이션 완료: 새로 적용 ' + r.applied.length + '개 / 전체 ' + r.total + '개');
  client.end(); process.exit(0);
})().catch((e) => { console.error('마이그레이션 실패:', e.message); process.exit(1); });
