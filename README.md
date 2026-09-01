# tt-demo

[tt](https://github.com/load28/tt) 언어로 만든 React 투두 앱입니다. tt는 TypeScript에
`variant`, `match`, `|>` 파이프라인, `TOption`/`TResult` 등을 더한 뒤 순수한
TypeScript로 컴파일되는 작은 언어입니다.

## 실행

[Bun](https://bun.sh/)이 필요합니다.

```sh
bun install
bun run dev      # 개발 서버
bun run check    # ttc --check-types src (tt + TypeScript 타입 검사)
bun run build    # 타입 검사 후 vite 프로덕션 빌드
```

## 구조

| 파일 | 내용 |
|------|------|
| `src/todo.tt` | 도메인 로직 — `variant Filter` / `variant TodoError`, `TResult` 기반 입력 검증(`parseTodo`), `match`로 필터링·라벨·요약 |
| `src/App.ttx` | React 컴포넌트(`.ttx` = tt + TSX) — `match`로 결과 분기, `TOption`으로 에러 상태 관리, `val`로 불변 바인딩 |
| `src/main.tsx` | 평범한 TSX 엔트리 — `.ttx` 모듈을 그대로 import |
| `vite.config.ts` | `@openload28/unplugin-tt/vite` 플러그인이 `.tt`/`.ttx`를 번들러에서 직접 읽음 |

## 사용한 tt 문법

- **variant** — `Filter { All, Active, Completed }`, `TodoError { Empty, TooLong(limit), Duplicate(text) }`
- **match** — 태그 패턴(필드 이름 바인딩, 별칭), 리터럴 매치(`0 => "모두 완료!"`), 완전성 검사
- **`|>` 파이프라인** — `raw |> .trim()`
- **`@tt/std`** — `TResult`로 검증 결과, `TOption`으로 에러 표시 상태
- **val** — 변이가 금지된 바인딩 (`val const FILTERS`)
