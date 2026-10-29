-- Crawl pipeline: per-source settings and per-job extraction state.
ALTER TABLE source ADD COLUMN settings_json TEXT;

ALTER TABLE crawl_job ADD COLUMN title TEXT;
ALTER TABLE crawl_job ADD COLUMN content_hash TEXT;
ALTER TABLE crawl_job ADD COLUMN raw_path TEXT;
ALTER TABLE crawl_job ADD COLUMN source_text TEXT;
ALTER TABLE crawl_job ADD COLUMN draft_json TEXT;
ALTER TABLE crawl_job ADD COLUMN confidence REAL;
ALTER TABLE crawl_job ADD COLUMN issues_json TEXT;
ALTER TABLE crawl_job ADD COLUMN test_id INTEGER REFERENCES test(id) ON DELETE SET NULL;

CREATE INDEX idx_crawl_job_hash ON crawl_job(content_hash);

-- Built-in sources (researched 2026-10-01; robots.txt checked where reachable).
INSERT INTO source (name, adapter, base_url, settings_json) VALUES
 ('IELTS.org 공식 샘플 (Academic)', 'generic', 'https://www.ielts.org',
  '{"startUrl":"https://www.ielts.org/take-a-test/preparation-resources/sample-test-questions/academic-test","linkPattern":"\\.pdf($|\\?)","minIntervalMs":3000,"respectRobots":true,"note":"공식 샘플 PDF. 정답이 PDF 안에 포함된 경우가 많습니다."}'),
 ('IELTS.org 공식 샘플 (General Training)', 'generic', 'https://ielts.org',
  '{"startUrl":"https://ielts.org/take-a-test/preparation-resources/sample-test-questions/general-training-test","linkPattern":"\\.pdf($|\\?)","minIntervalMs":3000,"respectRobots":true,"note":"공식 샘플 PDF."}'),
 ('British Council 무료 연습', 'generic', 'https://takeielts.britishcouncil.org',
  '{"startUrl":"https://takeielts.britishcouncil.org/take-ielts/prepare/free-ielts-english-practice-tests/reading","linkPattern":"free-ielts-english-practice-tests","minIntervalMs":3000,"respectRobots":true,"note":"동적 페이지일 수 있어 일부 문항이 추출되지 않을 수 있습니다."}'),
 ('IDP 연습 시험', 'generic', 'https://ielts.idp.com',
  '{"startUrl":"https://ielts.idp.com/nepal/prepare/ielts-academic-practice-test","linkPattern":"practice-test|\\.pdf($|\\?)","minIntervalMs":3000,"respectRobots":true,"note":"국가별 페이지마다 구성이 다릅니다."}'),
 ('IELTS-up', 'generic', 'https://ielts-up.com',
  '{"startUrl":"https://ielts-up.com/reading/ielts-reading-practice.html","linkPattern":"/(reading|listening)/","minIntervalMs":3000,"respectRobots":true,"note":"서드파티 무료 연습 문제."}'),
 ('IELTS Buddy', 'generic', 'https://www.ieltsbuddy.com',
  '{"startUrl":"https://www.ieltsbuddy.com/ielts-practice-tests.html","linkPattern":"practice","minIntervalMs":30000,"respectRobots":true,"note":"robots.txt가 일부 봇에 30초 간격을 요구하므로 30초 간격을 적용합니다."}');
