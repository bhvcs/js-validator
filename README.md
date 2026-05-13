# JSP JavaScript Validator

JSP 내부 `<script>` 코드를 추출해서 ESLint로 문법 오류를 검사하는 로컬 도구입니다.

## 기능

1. JSP 파일에서 JavaScript `<script>` 블록 추출
2. JSP가 참조하는 로컬 외부 `<script src="...">` 의존성까지 함께 로드해서 검사 (기본값)
2. 로컬 서버에서 ESLint 실행 후 문법 오류 반환
3. CLI로 단일 JSP 파일 즉시 검사
4. 오류가 있으면 `.annotated.jsp` 파일에 오류 위치를 주석으로 표시

## 설치

```bash
npm install
```

## 로컬 서버 실행

```bash
npm start
```

서버는 기본적으로 `http://localhost:3000` 에서 실행됩니다.

## API 사용법

기본 접속 확인:

- `GET /` : 서버 상태와 사용 가능한 엔드포인트 목록 반환

### 1) 파일 경로로 검사

`POST /lint/file`

옵션:

- `writeAnnotatedFile: false` 를 보내면 주석 파일 생성을 비활성화
- `withDependencies: false` 를 보내면 외부 script 의존성 로드를 비활성화

요청 예시:

```json
{
  "jspPath": "samples/sample.jsp",
  "withDependencies": true,
  "writeAnnotatedFile": true
}
```

### 2) JSP 본문 문자열로 검사

`POST /lint/content`

옵션:

- `includeAnnotatedContent: true` 를 함께 보내면 응답에 `annotatedContent` 포함

요청 예시:

```json
{
  "jspContent": "<script>const x = ;</script>",
  "includeAnnotatedContent": true
}
```

응답에는 다음이 포함됩니다.

- `scriptCount`: 추출된 script 블록 수
- `ok`: 오류가 없으면 `true`
- `totalIssues`: 총 이슈 개수
- `details[].messages[]`: snippet 위치 및 JSP 원본 라인 기준 위치

## CLI 사용법

샘플 파일 검사:

```bash
npm run check:sample
```

오류가 있으면 샘플 기준으로 `samples/sample.annotated.jsp` 파일이 생성됩니다.

의존성 포함 검사 샘플:

```bash
npm run check:deps-sample
```

의존성 제외 검사 비교:

```bash
npm run check:deps-sample:no-deps
```

직접 파일 지정:

```bash
node src/cli.js path/to/file.jsp
```

의존성 로드 끄기:

```bash
node src/cli.js path/to/file.jsp --no-deps
```

CLI 기본값은 `--with-deps`(의존성 포함)입니다.
