# tt 이슈 노트

`tt-demo` 투두 앱을 만들면서 만난 ttc 이슈 정리.

- **환경**: `@openload28/tt-lang` 1.0.0-dev.20260831.300 (ttc), `@openload28/unplugin-tt` 0.1.0-next.1.0.0.20260831.300, TypeScript 7.1.0-dev.20260826.1, Vite 8.2.2, Bun 1.3.11 (linux-x64)
- **날짜**: 2026-09-01

| # | 증상 | 심각도 | 우회 |
|---|------|--------|------|
| 1 | 문(statement) 위치의 단독 `match` → 컴파일러 패닉(ICE) | 빌드 실패 — 에러가 명확해서 발견은 쉬움 | `return match`로 감싸기 |
| 2 | JSX 컨테이너 안 `match` → 앞 형제 요소가 텍스트로 렌더됨 | **조용한 오컴파일** — 에러 없이 잘못된 화면 | match를 JSX 밖으로 빼기 |

---

## 1. 문 위치의 단독 `match`가 ICE로 크래시

`match`를 값으로 쓰지 않고 표현식 문(expression statement)으로 쓰면
`validate_source_preservation` 계약 위반으로 컴파일러가 패닉한다.

### 재현

```tt
import * as Result from "@tt/std/result";

const f = (x: number) => {
  match (Result.Ok(x)) {
    Ok(value) => { console.log(value); },
    Err(error) => { console.log(error); },
  };
};
```

```sh
bunx ttc --check src/repro1.tt
```

### 실제 출력

```
error: internal compiler error: validate_source_preservation broke the contract
that every non-whitespace source byte outside tt-owned ranges reaches the target (SourceOmitted)
  at source bytes 79..80
  from source bytes 79..91

  at: src/ice.rs:240:9
  ttc 1.0.0-dev.20260831.300

thread 'main' panicked at src/ice.rs:240:9
```

`79..91` 바이트는 스크루티니 `(Result.Ok(x)` 구간. 실제 앱에서는
`match (parseTodo(draft, todos)) { ... };` (이벤트 핸들러에서 부수효과 분기)에서 발생했다.

### 기대 동작

- 문 위치 match가 지원 대상이면: 정상 컴파일 (문서상 match는 owner-scoped 슬롯으로 로워링되며, 표현식 문은 statement owner가 될 수 있어 보임)
- 지원 대상이 아니면: `match-placement` 같은 위치가 찍힌 진단 — ICE 메시지 스스로도 "This is a bug in ttc, not in the code it was given"이라고 말한다

### 우회

같은 코드를 `return`에 태우면 정상 컴파일된다. 값 대입(`const _ = match ...`)도 동작.

```tt
const f = (x: number) => {
  return match (Result.Ok(x)) {
    Ok(value) => { console.log(value); },
    Err(error) => { console.log(error); },
  };
};
```

적용 위치: `src/App.ttx`의 `addTodo`.

---

## 2. JSX 컨테이너 안 `match` — 앞 형제 요소가 일반 텍스트로 방출됨

`.ttx`에서 JSX 자식 expression container(`{ ... }`)에 `match`를 직접 쓰면,
컴파일러가 평가 순서 보존을 위해 **앞에 있는 형제 JSX 요소들**을 `$tt_vN` 상수로
끌어올린 뒤, 원래 자리에 `{$tt_vN}`(표현식)이 아니라 `$tt_vN`(**JSX 텍스트**)로
되돌려 넣는다. 컴파일 에러가 없고 출력도 유효한 TSX라 자가 검증을 통과하며,
브라우저 화면에 문자 그대로 `$tt_v2 $tt_v3 $tt_v4`가 표시된다.

### 재현

```ttx
return (
  <main className="app">
    <h1>tt todo</h1>
    <p className="tagline">...</p>
    <form className="add" onSubmit={addTodo}>...</form>

    {match (error) {
      Some(value: e) => <p className="error">{describeError(e)}</p>,
      None => null,
    }}
  </main>
);
```

### 실제 컴파일 출력 (`ttc -p`)

```tsx
const $tt_v2 = (<h1>tt todo</h1>);
const $tt_v3 = (<p className="tagline">...</p>);
const $tt_v4 = (<form className="add" onSubmit={addTodo}>...</form>);
{
  const $tt_m = error;
  switch ($tt_m.kind) { /* ... $tt_v1 채움 ... */ }
}
return (
  <main className="app">
    $tt_v2
    $tt_v3

    $tt_v4

    {$tt_v1}
    ...
  </main>
);
```

`$tt_v2`~`$tt_v4`가 중괄호 없이 JSX 텍스트로 들어가 있다. 렌더 결과:

```html
<main class="app">$tt_v2 $tt_v3 $tt_v4<div class="filters">...</div>...</main>
```

h1·입력 폼이 전부 사라지고 슬롯 이름이 화면에 찍힌다.

### 기대 동작

끌어올린 형제 요소는 `{$tt_v2}`처럼 expression container로 복원되어야 한다.
공식 가이드도 "JSX 자식과 속성 expression container 안에서 tt 구문을 사용할 수
있습니다"라고 명시하므로 지원 범위 안의 패턴이다.

참고: match **앞에** 형제 요소가 있을 때만 문제가 된다. 이 케이스가 조용히
깨진다는 점(진단 없음, 빌드 성공)이 ICE보다 위험하다.

### 우회

match를 return 이전에 값으로 계산하고 JSX에는 변수만 넣는다.

```ttx
const errorView = match (error) {
  Some(value: e) => <p className="error">{describeError(e)}</p>,
  None => null,
};

return (
  <main className="app">
    ...
    {errorView}
  </main>
);
```

적용 위치: `src/App.ttx`의 `errorView`.

---

## 문제 없었던 것들

같은 세션에서 아래는 전부 문서대로 동작했다: `variant` 선언/생성자,
태그·리터럴 match와 완전성 검사, 필드 이름 바인딩·별칭(`Ok(value: text)`),
`|>` 파이프라인(`raw |> .trim()`), `@tt/std`의 `TResult`/`TOption`,
`val` 바인딩, `.tsx` → `.ttx` import, unplugin의 Vite 통합과
`ttc --check-types`의 tt+TS 통합 검사.
