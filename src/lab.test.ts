import { describe, expect, it } from "vitest";
import * as Option from "@tt/std/option";
import * as Result from "@tt/std/result";

import {
  Shape,
  Tree,
  countdown,
  errorKind,
  paymentLabel,
  baseSize,
  computeBudget,
  computeBudgetFn,
  emailOf,
  firstOkValue,
  flip,
  gradeOf,
  httpClass,
  leftmostLeafDoubled,
  mergeQuota,
  normalizedBudget,
  normalizedBudgetBlock,
  pickEven,
  radiusOrZero,
  receiptLine,
  settle,
  treeSum,
} from "./lab.tt";

describe("제네릭 재귀 variant + 중첩 패턴", () => {
  const tree = Tree.Node(
    Tree.Node(Tree.Leaf(1), Tree.Leaf(2)),
    Tree.Leaf(3),
  );

  it("재귀 match로 합산", () => {
    expect(treeSum(tree)).toBe(6);
  });

  it("중첩 패턴이 제네릭 필드 타입을 따라감", () => {
    expect(leftmostLeafDoubled(Tree.Leaf(5))).toBe(10);
    expect(leftmostLeafDoubled(Tree.Node(Tree.Leaf(4), Tree.Leaf(9)))).toBe(8);
    expect(leftmostLeafDoubled(tree)).toBe(2); // 한 단계 내려가 왼쪽 잎
  });
});

describe("try 값 형태의 표현식 내 사용", () => {
  it("result 블록: try를 const로 뽑은 형태(이슈 #6 우회)", () => {
    expect(computeBudget(10)).toEqual(Result.Ok(6)); // round(5 * 1.1)
    expect(computeBudget(3)).toEqual(Result.Err("홀수"));
  });

  it("일반 함수: 내장 값 형태 try가 정상", () => {
    expect(computeBudgetFn(10)).toEqual(Result.Ok(6));
    expect(computeBudgetFn(3)).toEqual(Result.Err("홀수"));
  });

  it("괄호 친 임의 식 전파: try (cond ? a : b)", () => {
    expect(pickEven(4, 3)).toEqual(Result.Ok(2));
    expect(pickEven(3, 4)).toEqual(Result.Ok(2));
    expect(pickEven(3, 5)).toEqual(Result.Err("홀수"));
  });
});

describe("파이프라인 조합", () => {
  it("try (파이프라인) — 일반 함수", () => {
    expect(normalizedBudget(10)).toEqual(Result.Ok("5.0"));
    expect(normalizedBudget(3)).toEqual(Result.Err("홀수"));
  });

  it("result 블록에서는 두 문장으로 분리한 형태", () => {
    expect(normalizedBudgetBlock(10)).toEqual(Result.Ok("5.0"));
    expect(normalizedBudgetBlock(3)).toEqual(Result.Err("홀수"));
  });

  it("옵셔널 스텝: 끊겨도 다음 스텝은 undefined로 이어짐", () => {
    expect(emailOf({ contact: { email: "a@b.c" } })).toBe("a@b.c");
    expect(emailOf({})).toBe("미등록");
    expect(emailOf(null)).toBe("미등록");
  });

  it("flow 합성 + val 바인딩", () => {
    expect(gradeOf(95)).toBe("A");
    expect(gradeOf(75)).toBe("B");
    expect(gradeOf(120)).toBe("A"); // clamp 후 판정
    expect(gradeOf(-5)).toBe("C");
  });
});

describe("result 블록의 위치별 동작", () => {
  it("함수 인자 + 템플릿 보간 위치 (파이프 헤드는 이슈 #7로 회피)", () => {
    expect(receiptLine("A1", 2)).toBe("A1 × 2 = 2400원");
    expect(receiptLine("Z9", 2)).toBe("Z9 × 2 = 0원");
  });

  it("match arm 블록 안의 result 블록", () => {
    expect(settle(Option.Some("A1"))).toBe(1300);
    expect(settle(Option.Some("Z9"))).toBe(-1);
    expect(settle(Option.None)).toBe(0);
  });
});

describe("튜플 match + 가드", () => {
  it("가드가 참이면 가로채고, 거짓이면 다음 조합 arm으로", () => {
    expect(mergeQuota(Option.Some(9), Option.Some(4))).toBe(9); // 가드 참
    expect(mergeQuota(Option.Some(2), Option.Some(4))).toBe(4); // 가드 거짓
    expect(mergeQuota(Option.Some(7), Option.None)).toBe(7);
    expect(mergeQuota(Option.None, Option.Some(5))).toBe(5);
    expect(mergeQuota(Option.None, Option.None)).toBe(0);
  });
});

describe("리터럴 match", () => {
  it("유한 유니언 완전성 검사 대상 + as const 우회(이슈 #8)", () => {
    expect(flip("on")).toBe("off");
    expect(flip("off")).toBe("on");
  });

  it("리터럴 or-패턴과 가드", () => {
    expect(httpClass(201, false)).toBe("성공");
    expect(httpClass(429, false)).toBe("재시도");
    expect(httpClass(429, true)).toBe("포기");
    expect(httpClass(404, false)).toBe("없음");
    expect(httpClass(500, false)).toBe("그 외");
  });
});

describe("추가 조합: while 조건 match, is or-패턴, kind 유니언", () => {
  it("while 조건의 match가 매 반복 재평가됨", () => {
    expect(countdown(3)).toEqual([3, 2, 1]);
    expect(countdown(0)).toEqual([]);
  });

  it("타입 전용 is or-패턴이 부모 Error보다 먼저 걸림", () => {
    expect(errorKind(new RangeError("r"))).toBe("범위/타입");
    expect(errorKind(new TypeError("t"))).toBe("범위/타입");
    expect(errorKind(new Error("일반 오류"))).toBe("일반 오류");
    expect(errorKind("문자열")).toBe("알 수 없음");
  });

  it("variant 없이 손으로 쓴 kind 유니언에도 match", () => {
    expect(paymentLabel({ kind: "Card", last4: "1234" })).toBe("카드 **1234");
    expect(paymentLabel({ kind: "Cash" })).toBe("현금");
  });
});

describe("바인딩·패턴 조합", () => {
  it("val 바인딩 → val 파라미터 전달", () => {
    expect(baseSize()).toBe(3);
  });

  it("if let + 중첩 패턴", () => {
    expect(firstOkValue(Result.Ok(Option.Some(42)))).toBe(42);
    expect(firstOkValue(Result.Ok(Option.None))).toBe(-1);
    expect(firstOkValue(Result.Err("x"))).toBe(-1);
  });

  it("let-else + or-패턴", () => {
    expect(radiusOrZero(Shape.Circle(3))).toBe(3);
    expect(radiusOrZero(Shape.Square(4))).toBe(4);
    expect(radiusOrZero(Shape.Dot)).toBe(0);
  });
});
